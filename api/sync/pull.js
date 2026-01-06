// api/sync/pull.js  (CommonJS - stable on Vercel)

function setCors(req, res) {
  const origin = req.headers.origin;

  // 只允许你的前端域名（最稳，避免缓存/平台奇怪行为）
  const allowOrigin = "https://baokemeng-orcin.vercel.app";

  if (origin === allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  }

  // 关键：告诉缓存按 Origin 区分，避免“有时有头、有时没头”
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-token, Cache-Control, Pragma"
  );

  // 预检直接结束
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

module.exports = async (req, res) => {
  if (setCors(req, res)) return;

  // token 鉴权（你后面会换 token，现在先跑通）
  const expected = process.env.ADMIN_SYNC_TOKEN || "";
  const got = String(req.headers["x-admin-token"] || "");

  if (!expected) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "ADMIN_SYNC_TOKEN missing" }));
    return;
  }

  if (got !== expected) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  // 先返回占位，验证跨域链路通
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, note: "pull ok (cors from function)" }));
};
