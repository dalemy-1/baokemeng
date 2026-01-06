// api/sync/ping.js (CommonJS - stable on Vercel)

function setCors(req, res) {
  const origin = req.headers.origin;
  const allowOrigin = "https://baokemeng-orcin.vercel.app";

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
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, ts: new Date().toISOString(), note: "ping ok (cors from function)" }));
};
