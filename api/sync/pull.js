import { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } from "./_util.js";

/**
 * V24: pull returns { data, deletes }.
 * Supports optional `since` (ISO) in body or query. If provided, deletes are filtered by deleted_at > since.
 * Main tables return rows where deleted_at IS NULL.
 */

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

const DELETES_TABLE = "ops_deletes";
const MAX_BATCH = 500;

function parseSince(req, body) {
  const q = req?.query || {};
  const s = (body?.since || q?.since || q?.cursor || "").toString().trim();
  return s || null;
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

    const data = { accounts: [], activities: [], entries: [] };

    // main data: exclude soft-deleted rows
    for (const key of Object.keys(TABLE_MAP)) {
      let q = sb.from(TABLE_MAP[key]).select("*").is("deleted_at", null).limit(10000);
      // keep option open: if you later add updated_at cursor, you can extend here
      const { data: rows, error } = await q;
      if (error) return sendJson(res, 500, { ok: false, error: "supabase_error", step: "select", table: TABLE_MAP[key], detail: error.message });
      data[key] = rows || [];
    }

    // deletes queue
    let dq = sb.from(DELETES_TABLE).select("table_name,row_id,deleted_at,source").limit(10000);
    if (since) dq = dq.gt("deleted_at", since);
    const { data: deletes, error: dErr } = await dq;
    if (dErr) return sendJson(res, 500, { ok: false, error: "supabase_error", step: "deletes_select", table: DELETES_TABLE, detail: dErr.message });

    return sendJson(res, 200, {
      ok: true,
      server_ts: nowIso(),
      since: since || null,
      data,
      deletes: deletes || [],
      note: "pull ok (v24 deletes queue enabled)",
    });
  } catch (err) {
    return handleError(res, err);
  }
}
