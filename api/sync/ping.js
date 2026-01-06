const { applyCors, requireAdminToken, nowIso, sendJson, handleError } = require("./_util");

module.exports = async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    return sendJson(res, 200, { ok: true, ts: nowIso(), note: "ping ok (v21 vercel api debug)" });
  } catch (err) {
    return handleError(res, err);
  }
};
