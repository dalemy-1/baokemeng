import { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } from "./_util.js";

/**
 * V24.3 STABLE FIX:
 * - supabaseAdmin() is async in this repo, so we MUST await it. (Fixes "sb.from is not a function")
 * - main tables: select("*") only (schema-agnostic)
 * - deletes queue: ops_deletes(table_name,row_id,deleted_at,source)
 * - since applies only to deletes by deleted_at (optional)
 */

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

const DELETES_TABLE = "ops_deletes";

const LIMIT_MAIN = 10000;
const LIMIT_DELETES = 10000;

function parseSince(req, body) {
  const q = req?.query || {};
  const s = (body?.since || q?.since || q?.cursor || "").toString().trim();
  return s || null;
}

async function fetchAll(sb, table) {
  const { data, error } = await sb.from(table).select("*").limit(LIMIT_MAIN);
  return { data: data || [], error };
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    const body = await readJson(req);
    const since = parseSince(req, body);

    // IMPORTANT: supabaseAdmin is async in this project.
    const sb = await supabaseAdmin();

    // 1) Main data (full)
    const data = {};
    for (const [key, table] of Object.entries(TABLE_MAP)) {
      const r = await fetchAll(sb, table);
      if (r.error) {
        return sendJson(res, 500, {
          ok: false,
          error: "supabase_error",
          where: "main_select",
          table,
          detail: r.error.message,
        });
      }
      data[key] = r.data;
    }

    // 2) Deletes queue (since applies here only)
    let dq = sb.from(DELETES_TABLE).select("table_name,row_id,deleted_at,source").limit(LIMIT_DELETES);
    if (since) dq = dq.gt("deleted_at", since);
    const { data: deletes, error: dErr } = await dq;
    if (dErr) {
      return sendJson(res, 500, {
        ok: false,
        error: "supabase_error",
        where: "deletes_select",
        table: DELETES_TABLE,
        detail: dErr.message,
      });
    }

    return sendJson(res, 200, {
      ok: true,
      server_ts: nowIso(),
      since: since || null,
      data,
      deletes: deletes || [],
      note: "pull ok (v24.3 stable: await supabaseAdmin + deletes queue)",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
