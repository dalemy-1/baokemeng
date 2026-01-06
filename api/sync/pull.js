// api/sync/pull.js (ESM)

function applyCors(req, res) {
  const allowOrigin = "https://baokemeng-orcin.vercel.app";
  const origin = req.headers.origin;

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

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_SYNC_TOKEN || "";
  const got = String(req.headers["x-admin-token"] || "");

  if (!expected) {
    res.status(500).json({ ok: false, error: "ADMIN_SYNC_TOKEN missing" });
    return false;
  }
  if (got !== expected) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  // 先占位，验证链路
  res.status(200).json({ ok: true, note: "pull ok (cors from function)" });
}
