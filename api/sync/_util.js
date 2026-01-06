export function withCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  // 预检请求直接返回
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

import { createClient } from "@supabase/supabase-js";

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type,x-admin-token");
}

function deny(res, code, msg) {
  cors(res);
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: msg }));
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function auth(req, res) {
  const token = req.headers["x-admin-token"];
  const expect = process.env.ADMIN_SYNC_TOKEN;
  if (!expect) throw new Error("Missing ADMIN_SYNC_TOKEN");
  if (!token || token !== expect) {
    deny(res, 401, "unauthorized");
    return false;
  }
  return true;
}

export function handleOptions(req, res) {
  if (req.method === "OPTIONS") {
    cors(res);
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
}

export function bad(res, msg) { deny(res, 400, msg); }
export function serverErr(res, msg) { deny(res, 500, msg); }
