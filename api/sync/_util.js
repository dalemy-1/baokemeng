// api/sync/_util.js (ESM)
// 统一：CORS / OPTIONS / 鉴权 / Supabase client
import { createClient } from "@supabase/supabase-js";

export function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-admin-token, Cache-Control, Pragma"
  );
}

export function handleOptions(req, res) {
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return true;
  }
  return false;
}

export function auth(req, res) {
  const expected = process.env.ADMIN_SYNC_TOKEN || "";
  const got = String(req.headers["x-admin-token"] || "");

  if (!expected) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "ADMIN_SYNC_TOKEN missing" }));
    return false;
  }
  if (got !== expected) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return false;
  }
  return true;
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function bad(res, message) {
  cors(res);
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: message || "bad_request" }));
}

export function serverErr(res, message) {
  cors(res);
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: false, error: message || "server_error" }));
}

// 你的真实表名（已按截图确认）
export const TABLES = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

// upsert 冲突键（已按截图主键/联合键配置）
export const CONFLICT = {
  accounts: "account",
  activities: "id",
  entries: "activity_id,account",
};
