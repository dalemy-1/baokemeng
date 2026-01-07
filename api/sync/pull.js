import { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } from "./_util.js";

/**
 * V24.1 FIX: pull returns { data, deletes } and will NOT 500.
 * - deletes from ops_deletes uses columns: table_name, row_id, deleted_at, source
 * - supports optional `since` (ISO) from body.since or query ?since=...
 * - main tables return rows where deleted_at IS NULL
 */

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

const DELETES_TABLE = "ops_deletes";

/** Very small system; keep conservative limits to avoid timeouts */
const LIMIT_MAIN = 10000;
const LIMIT_DELETES = 10000;

function parseSince(req, body) {
  const q = req?.query || {};
  const s = (body?.since || q?.since || q?.cursor || "").toString().trim();
  return s || null;
}

async function fetchMain(sb, table, since) {
  // If your tables have updated_at, we can do incremental pull with since; otherwise return full.
  let q = sb.from(table).select("*").is("deleted_at", null).limit(LIMIT_MAIN);
  if (since) {
    // Best-effort: only apply if column exists; if it doesn't, Supabase returns an error and we fallback to full.
    const { data, error } = await q.gt("updated_at", since);
    if (!error) return { data: data || [], error: null };
    // fallback to full if updated_at filter fails
    q = sb.from(table).select("*").is("deleted_at", null).limit(LIMIT_MAIN);
  }
  const { data, error } = await q;
  return { data: data || [], error };
}

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    const sb = supabaseAdmin();
    const body = await readJson(req);
    const since = parseSince(req, body);

    // main data
    const data = {};
    for (const [key, table] of Object.entries(TABLE_MAP)) {
      const r = await fetchMain(sb, table, since);
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

    // deletes queue
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
      note: "pull ok (v24.1 deletes queue enabled)",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
