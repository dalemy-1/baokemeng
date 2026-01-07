import { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } from "./_util.js";

/**
 * V24.3 PUSH FIX:
 * - supabaseAdmin() is async in this repo, so MUST await it (fixes silent failures)
 * - Accepts { upserts, deletes } in body (backward compatible with {data} / {payload})
 * - Writes deletes into ops_deletes with columns: table_name,row_id,deleted_at,source
 * - Keeps legacy soft-delete update to main tables (best-effort) but deletes queue is the source of truth.
 */

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

const DELETES_TABLE = "ops_deletes";

function normalizeBody(body) {
  // Backward compatibility:
  // - some clients send { data: {...} }
  // - some send { upserts: {...} }
  const upserts = body?.upserts || body?.data || body?.payload?.data || body?.payload || {};
  const deletes = body?.deletes || body?.payload?.deletes || [];
  return { upserts, deletes };
}

function pickArray(x) {
  return Array.isArray(x) ? x : [];
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    const body = await readJson(req);
    const { upserts, deletes } = normalizeBody(body);

    // IMPORTANT: async in this project
    const sb = await supabaseAdmin();

    // 1) Upserts (best-effort)
    const upsertReport = {};
    for (const [key, table] of Object.entries(TABLE_MAP)) {
      const rows = pickArray(upserts?.[key]);
      if (!rows.length) {
        upsertReport[key] = 0;
        continue;
      }
      const { error } = await sb.from(table).upsert(rows);
      if (error) {
        return sendJson(res, 500, {
          ok: false,
          error: "supabase_error",
          where: "main_upsert",
          table,
          detail: error.message,
        });
      }
      upsertReport[key] = rows.length;
    }

    // 2) Deletes queue (source of truth for deletion propagation)
    const delRowsRaw = pickArray(deletes);
    const delRows = delRowsRaw
      .map(d => ({
        table_name: d?.table_name || d?.table || d?.tableKey || d?.table_key || d?.tableName,
        row_id: (d?.row_id || d?.id || d?.rowId || "").toString(),
        deleted_at: d?.deleted_at || d?.deletedAt || nowIso(),
        source: d?.source || "admin",
      }))
      .filter(d => d.table_name && d.row_id);

    let deletesQueued = 0;
    if (delRows.length) {
      const { error } = await sb
        .from(DELETES_TABLE)
        .upsert(delRows, { onConflict: "table_name,row_id" });
      if (error) {
        return sendJson(res, 500, {
          ok: false,
          error: "supabase_error",
          where: "deletes_upsert",
          table: DELETES_TABLE,
          detail: error.message,
        });
      }
      deletesQueued = delRows.length;

      // 3) Legacy soft delete on main tables (best-effort; ignore errors)
      // If your main tables don't have deleted_at, this may fail; we intentionally ignore.
      for (const d of delRows) {
        const mainTable = TABLE_MAP[d.table_name];
        if (!mainTable) continue;
        try {
          await sb.from(mainTable).update({ deleted_at: d.deleted_at }).eq("id", d.row_id);
        } catch (_) {}
      }
    }

    return sendJson(res, 200, {
      ok: true,
      server_ts: nowIso(),
      upserts: upsertReport,
      deletes_queued: deletesQueued,
      note: "push ok (v24.3: await supabaseAdmin + ops_deletes queue)",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
