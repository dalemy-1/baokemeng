// api/sync/pull.js (ESM)

import { createClient } from '@supabase/supabase-js';

function applyCors(req, res) {
  // 现在你全局 vercel.json 也会给 acao:*，这里保留不冲突
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

function getSupabase() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("SUPABASE env missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  try {
    const supabase = getSupabase();

    // ======= 按你 Supabase 的真实表名 =======
const T_ACCOUNTS = "ops_accounts";
const T_CAMPAIGNS = "ops_activities";
const T_WINS = "ops_activity_entries";
// 你目前没有 deletes 表，先关掉
const T_DELETES = null;
// =======================================


    // 可选：支持 ?since=ISO 拉增量。你先不用增量也行，先全量覆盖跑通。
    const since = req.query?.since ? String(req.query.since) : null;

    const sel = since
      ? (table) => supabase.from(table).select("*").gte("updated_at", since)
      : (table) => supabase.from(table).select("*");

    const [a, c, w, d] = await Promise.all([
      sel(T_ACCOUNTS),
      sel(T_CAMPAIGNS),
      sel(T_WINS),
      sel(T_DELETES),
    ]);

    // 任意一个查询失败都抛错
    for (const r of [a, c, w, d]) {
      if (r.error) throw r.error;
    }

    res.status(200).json({
  ok: true,
  pulled_at: new Date().toISOString(),
  mode: since ? "delta" : "full",
  data: {
    accounts: a.data || [],
    activities: c.data || [],
    entries: w.data || [],
  },
});

  } catch (e) {
    res.status(500).json({
      ok: false,
      error: String(e?.message || e),
    });
  }
}
