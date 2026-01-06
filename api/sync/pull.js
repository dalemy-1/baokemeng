const { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso } = require("./_util");

const TABLES = [
  { key: "accounts", name: "ops_accounts" },
  { key: "activities", name: "ops_activities" },
  { key: "entries", name: "ops_activity_entries" },
];

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }

  const auth = requireAdminToken(req);
  if (!auth.ok) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  let body = {};
  try {
    body = await readJson(req);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
  }

  const since = body.since ? new Date(body.since) : null;
  if (since && Number.isNaN(since.getTime())) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "invalid_since" }));
  }

  const limit = Math.min(Math.max(Number(body.limit || 2000), 1), 5000);

  const sb = supabaseAdmin();
  const out = { accounts: [], activities: [], entries: [] };

  for (const t of TABLES) {
    let q = sb.from(t.name).select("*").order("updated_at", { ascending: true }).limit(limit);
    if (since) q = q.gt("updated_at", since.toISOString());

    const { data, error } = await q;
    if (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "supabase_error", table: t.name, detail: error.message }));
    }
    out[t.key] = data || [];
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify({
    ok: true,
    server_ts: nowIso(),
    since: body.since || null,
    limit,
    data: out
  }));
};
