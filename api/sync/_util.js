import { createClient } from "@supabase/supabase-js";

/**
 * CORS helper: call cors(res) before returning ANY response.
 * handleOptions(req,res) returns true if request was OPTIONS and has ended.
 */
export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-token");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

export function bad(res, msg, code = 400) {
  cors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: msg }));
}

export function serverErr(res, msg, code = 500) {
  cors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: msg }));
}

export function auth(req, res, body = null) {
  // Expected token(s) are stored only on server (Vercel env).
  // Supports rotation:
  // - ADMIN_SYNC_TOKEN="token"
  // - ADMIN_SYNC_TOKEN_LIST="token1,token2" (comma-separated)
  const expectedListRaw = (process.env.ADMIN_SYNC_TOKEN_LIST || "").trim();
  const expectedSingle = (process.env.ADMIN_SYNC_TOKEN || "").trim();
  const expectedList = expectedListRaw
    ? expectedListRaw.split(",").map(s => s.trim()).filter(Boolean)
    : (expectedSingle ? [expectedSingle] : []);

  if (!expectedList.length) {
    bad(res, "server missing ADMIN_SYNC_TOKEN", 500);
    return false;
  }

  const got = getProvidedToken(req, body);
  if (!got) {
    bad(res, "unauthorized", 401);
    return false;
  }

  // Browser headers are ISO-8859-1; query/body may carry unicode.
  // We enforce printable ASCII to avoid "non ISO-8859-1 code point" surprises.
  if (!isPrintableAscii(got)) {
    bad(res, "token must be ASCII", 401);
    return false;
  }

  const ok = expectedList.some(exp => timingSafeEqualStr(exp, got));
  if (!ok) {
    bad(res, "unauthorized", 401);
    return false;
  }

  return true;
}

function getProvidedToken(req, body) {
  // 1) Header: x-admin-token
  const h1 = (req.headers["x-admin-token"] || "").toString().trim();
  if (h1) return h1;

  // 2) Header: Authorization: Bearer <token>
  const authz = (req.headers["authorization"] || "").toString().trim();
  const m = /^Bearer\s+(.+)$/i.exec(authz);
  if (m && m[1]) return m[1].trim();

  // 3) Query string: ?admin_token= / ?token= / ?x_admin_token=
  try {
    const url = new URL(req.url, "http://localhost");
    const q = url.searchParams;
    const qv = (q.get("admin_token") || q.get("token") || q.get("x_admin_token") || "").trim();
    if (qv) return qv;
  } catch (_) {}

  // 4) JSON body: { admin_token: "..."} or { token: "..." }
  if (body && typeof body === "object") {
    const bv = (body.admin_token || body.token || "").toString().trim();
    if (bv) return bv;
  }

  return "";
}

function isPrintableAscii(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c > 0x7E) return false;
  }
  return true;
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    const crypto = require("crypto");
    return crypto.timingSafeEqual(ba, bb);
  } catch (_) {
    return false;
  }
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("SUPABASE_URL missing");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}