import { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } from "./_util.js";

/**
 * V24: Adds deletes queue propagation via ops_deletes (tombstones),
 * while keeping backward-compatible soft-delete on main tables.
 *
 * Accepts body:
 *  - data / upserts: { accounts: [], activities: [], entries: [] }
 *  - deletes: [{ table_name: 'accounts'|'activities'|'entries', row_id: '...', deleted_at?: '...' }]
 *  - meta: optional
 */

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

const DELETES_TABLE = "ops_deletes";
const MAX_BATCH = 500;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < (arr?.length || 0); i += n) out.push(arr.slice(i, i + n));
  return out;
}

function normalizeDeletes(deletes) {
  const now = nowIso();
  const out = [];
  for (const d of Array.isArray(deletes) ? deletes : []) {
    const table_name = (d?.table_name || d?.table || d?.table_key || "").trim();
    const row_id = String(d?.row_id ?? d?.id ?? "").trim();
    if (!table_name || !row_id) continue;
    if (!TABLE_MAP[table_name]) continue;
    out.push({
      table_name,
      row_id,
      deleted_at: d?.deleted_at ? String(d.deleted_at) : now,
      source: d?.source ? String(d.source) : "admin",
    });
  }
  return out;
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    const sb = supabaseAdmin();

    const body = await readJson(req);
    const upserts = body?.upserts || body?.data || {};
    const deletes = normalizeDeletes(body?.deletes);

    const applied = { upserts: { accounts: 0, activities: 0, entries: 0 }, deletes: 0 };
    const conflicts = [];

    // 1) Upserts (backward compatible)
    for (const key of Object.keys(TABLE_MAP)) {
      const rows = Array.isArray(upserts?.[key]) ? upserts[key] : [];
      if (!rows.length) continue;

      for (const part of chunk(rows, MAX_BATCH)) {
        const { error } = await sb
          .from(TABLE_MAP[key])
          .upsert(part, { onConflict: "id" });

        if (error) {
          return sendJson(res, 500, { ok: false, error: "supabase_error", step: "upsert", table: TABLE_MAP[key], detail: error.message });
        }
        applied.upserts[key] += part.length;
      }
    }

    // 2) Deletes: write tombstones + soft-delete main tables
    if (deletes.length) {
      // 2.1 upsert into ops_deletes (idempotent on (table_name,row_id))
      for (const part of chunk(deletes, MAX_BATCH)) {
        const { error } = await sb
          .from(DELETES_TABLE)
          .upsert(part, { onConflict: "table_name,row_id" });

        if (error) {
          return sendJson(res, 500, { ok: false, error: "supabase_error", step: "deletes_upsert", table: DELETES_TABLE, detail: error.message });
        }
      }

      // 2.2 soft delete in main tables (keeps pull filtering simple)
      for (const d of deletes) {
        const table = TABLE_MAP[d.table_name];
        const { error } = await sb
          .from(table)
          .update({ deleted_at: d.deleted_at, updated_at: nowIso() })
          .eq("id", d.row_id);

        if (error) {
          return sendJson(res, 500, { ok: false, error: "supabase_error", step: "soft_delete", table, detail: error.message });
        }
        applied.deletes += 1;
      }
    }

    return sendJson(res, 200, {
      ok: true,
      server_ts: nowIso(),
      applied,
      conflicts,
      note: "push ok (v24 deletes queue enabled)",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
