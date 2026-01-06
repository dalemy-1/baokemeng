import { applyCors, requireAdminToken, nowIso, sendJson, handleError, readJson } from "./_util.js";

export default async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    // Echo debug: confirm body parsing in Vercel runtime
    let body = {};
    let parse_ok = true;
    try {
      body = await readJson(req);
    } catch (e) {
      parse_ok = false;
    }

    const bodyType = (req.body === undefined) ? "undefined" : (req.body === null ? "null" : typeof req.body);
    const bodyStrPreview = (typeof req.body === "string") ? req.body.slice(0, 500) : undefined;

    return sendJson(res, 200, {
      ok: true,
      ts: nowIso(),
      note: "ping ok (v21 vercel api ESM) + echo",
      body_type: bodyType,
      body_preview: bodyStrPreview,
      parse_ok,
      body_keys: body && typeof body === "object" ? Object.keys(body).slice(0, 50) : [],
      body
    });
  } catch (err) {
    return handleError(res, err);
  }
}
