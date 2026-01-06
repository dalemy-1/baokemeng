const { createClient } = require("@supabase/supabase-js");

function nowIso() { return new Date().toISOString(); }

function parseAllowOrigins() {
  return (process.env.SYNC_ALLOW_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function getOrigin(req) {
  const o = req.headers?.origin;
  return Array.isArray(o) ? o[0] : o;
}

function applyCors(req, res) {
  const origin = getOrigin(req);
  const allowOrigins = parseAllowOrigins();
  const allowAll = allowOrigins.includes("*");

  if (origin) {
    const ok = allowAll || allowOrigins.includes(origin);
    if (ok) {
      res.setHeader("Access-Control-Allow-Origin", allowAll ? "*" : origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type,x-admin-token");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

function requireAdminToken(req) {
  const expected = process.env.ADMIN_SYNC_TOKEN || "";
  if (!expected) return { ok: false, error: "server_missing_admin_token" };

  const token = (req.headers?.["x-admin-token"] || "").toString();
  if (!token) return { ok: false, error: "missing_token" };
  if (token !== expected) return { ok: false, error: "unauthorized" };
  return { ok: true };
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url) throw new Error("Missing env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("invalid_json"); }
}

module.exports = {
  nowIso,
  applyCors,
  requireAdminToken,
  supabaseAdmin,
  readJson
};
