// api/sync/ping.js (ESM)

function applyCors(req, res) {
  const allowOrigin = "https://baokemeng-orcin.vercel.app";
  const origin = req.headers.origin;

  // 精确允许前端域名（最稳）
  if (origin === allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-token, Cache-Control, Pragma"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return true;
  }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
    note: "ping ok (cors from function)"
  });
}
