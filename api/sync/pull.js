const { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } = require("./_util");

const TABLES = [
  { key: "accounts", name: "ops_accounts" },
  { key: "activities", name: "ops_activities" },
  { key: "entries", name: "ops_activity_entries" },
];

module.exports = async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    let body = {};
    try {
      body = await readJson(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }

    const since = body.since ? new Date(body.since) : null;
    if (since && Number.isNaN(since.getTime())) return sendJson(res, 400, { ok: false, error: "invalid_since" });

    const limit = Math.min(Math.max(Number(body.limit || 2000), 1), 5000);

    const sb = supabaseAdmin();
    const out = { accounts: [], activities: [], entries: [] };

    for (const t of TABLES) {
      let q = sb.from(t.name).select("*").order("updated_at", { ascending: true }).limit(limit);
      if (since) q = q.gt("updated_at", since.toISOString());

      const { data, error } = await q;
      if (error) return sendJson(res, 500, { ok: false, error: "supabase_error", table: t.name, detail: error.message });
      out[t.key] = data || [];
    }

    return sendJson(res, 200, { ok: true, server_ts: nowIso(), since: body.since || null, limit, data: out });
  } catch (err) {
    return handleError(res, err);
  }
};
