// api/sync/pull.js (ESM) - 只拉三张表：ops_accounts / ops_activities / ops_activity_entries

import { createClient } from "@supabase/supabase-js";

function applyCors(req, res) {
  // 你全局 vercel.json 也在加 header，这里不冲突
  res.setHeader("Access-Control-Allow-Origin", "*");
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

    // ✅ 你的真实表名
    const T_ACCOUNTS = "ops_accounts";
    const T_ACTIVITIES = "ops_activities";
    const T_ENTRIES = "ops_activity_entries";

    const since = req.query?.since ? String(req.query.since) : null;

    const query = (table) => {
      // 全量（推荐先跑通）
      if (!since) return supabase.from(table).select("*");
      // 增量（可选：要求表里有 updated_at 字段）
      return supabase.from(table).select("*").gte("updated_at", since);
    };

    const [a, b, c] = await Promise.all([
      query(T_ACCOUNTS),
      query(T_ACTIVITIES),
      query(T_ENTRIES),
    ]);

    for (const r of [a, b, c]) {
      if (r.error) throw r.error;
    }

    res.status(200).json({
      ok: true,
      pulled_at: new Date().toISOString(),
      mode: since ? "delta" : "full",
      data: {
        accounts: a.data || [],
        activities: b.data || [],
        entries: c.data || [],
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
