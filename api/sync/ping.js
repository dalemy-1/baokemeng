const { applyCors, requireAdminToken, nowIso } = require("./_util");

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }

  const auth = requireAdminToken(req);
  if (!auth.ok) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 200;
  return res.end(JSON.stringify({ ok: true, ts: nowIso(), note: "ping ok (v21 vercel api)" }));
};
