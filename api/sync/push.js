// api/sync/push.js
// V25.1（永久稳态版）：Push 端“自适应剔除未知列”，不再依赖 information_schema（避免 500 / schema cache missing column）
//
// 关键点：
// 1) 客户端可能带本地新增字段（addr_city / aux_email / birth_ym 等），云端表未必有。
// 2) PostgREST/Supabase 会因为“未知列”直接 500：Could not find the '<col>' column of '<table>' in the schema cache
// 3) 本实现：遇到未知列报错 -> 解析出列名 -> 从 payload 全量剔除该列 -> 自动重试（最多 20 次）
//    => 无论客户端带多少新字段，都不会把 push 打崩。

import { createClient } from "@supabase/supabase-js";

function getEnv(name, fallback = "") {
  return process.env[name] || fallback;
}

function supabaseAdmin() {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY") || getEnv("SUPABASE_SERVICE_ROLE_KEY".toUpperCase()); // 兼容
  if (!url || !service) throw new Error("Supabase env missing");
  return createClient(url, service, { auth: { persistSession: false } });
}

function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(obj));
}

function requireAdmin(req) {
  const headerToken = (req.headers["x-admin-token"] || "").toString();
  const bodyToken = (req.body && req.body.admin_token) ? String(req.body.admin_token) : "";
  const token = headerToken || bodyToken;

  const expected =
    getEnv("ADMIN_SYNC_TOKEN") ||
    getEnv("ADMIN_TOKEN") ||
    getEnv("ADMIN_SYNC_SECRET") ||
    ""; // 你当前项目里用 ADMIN_SYNC_TOKEN

  if (!expected) return { ok: false, error: "server_admin_token_missing" };
  if (!token || token !== expected) return { ok: false, error: "unauthorized" };
  return { ok: true };
}

function parseMissingColumn(message) {
  // 典型：Could not find the 'addr_city' column of 'ops_accounts' in the schema cache
  const m = String(message || "").match(/Could not find the '([^']+)' column of '([^']+)'/i);
  if (m) return { column: m[1], table: m[2] };
  return null;
}

function stripColumnFromRows(rows, col) {
  if (!Array.isArray(rows)) return rows;
  let changed = 0;
  const out = rows.map((r) => {
    if (!r || typeof r !== "object") return r;
    if (Object.prototype.hasOwnProperty.call(r, col)) {
      const copy = { ...r };
      delete copy[col];
      changed += 1;
      return copy;
    }
    return r;
  });
  return { rows: out, changed };
}

async function upsertWithAdaptiveStrip(sb, table, rows, opts = {}) {
  const chunkSize = opts.chunkSize || 500;
  const maxRetries = opts.maxRetries || 20;

  let working = Array.isArray(rows) ? rows : [];
  let stripped = [];
  let attempts = 0;

  // 先做一次“轻清洗”：确保 id 存在且是字符串（避免 keyPath/类型问题）
  working = working
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const out = { ...r };
      if (out.id != null) out.id = String(out.id);
      return out;
    });

  while (attempts <= maxRetries) {
    attempts += 1;

    try {
      let total = 0;
      for (let i = 0; i < working.length; i += chunkSize) {
        const batch = working.slice(i, i + chunkSize);
        if (!batch.length) continue;

        const { error } = await sb.from(table).upsert(batch, { onConflict: "id" });
        if (error) throw error;
        total += batch.length;
      }

      return { ok: true, table, upserted: working.length, stripped, attempts };

    } catch (e) {
      const info = parseMissingColumn(e?.message || e);
      if (!info || info.table !== table) {
        return { ok: false, table, error: "supabase_error", message: String(e?.message || e), stripped, attempts };
      }

      // 剔除该列并重试
      const col = info.column;
      const res = stripColumnFromRows(working, col);
      working = res.rows;
      stripped.push({ column: col, removed_from_rows: res.changed });

      // 如果一轮下来没有任何行包含该列，避免死循环：直接返回报错
      if (res.changed === 0) {
        return { ok: false, table, error: "schema_mismatch_unresolved", message: String(e?.message || e), stripped, attempts };
      }
    }
  }

  return { ok: false, table, error: "too_many_retries", stripped, attempts };
}

function normalizeDeletes(deletes) {
  const arr = Array.isArray(deletes) ? deletes : [];
  return arr
    .map((d) => ({
      table_name: String(d?.table_name || "").slice(0, 64),
      row_id: String(d?.row_id || "").slice(0, 128),
      deleted_at: d?.deleted_at ? String(d.deleted_at) : null,
      source: d?.source ? String(d.source).slice(0, 128) : null,
    }))
    .filter((d) => d.table_name && d.row_id)
    .slice(0, 2000);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

  // 让 Vercel 先把 body 解析好（如果你没用 bodyParser，这里也能跑；你的项目目前可用）
  const body = req.body || {};
  const auth = requireAdmin(req);
  if (!auth.ok) return json(res, 401, { ok: false, error: auth.error });

  try {
    const sb = supabaseAdmin();

    const db = String(body.db || "");
    const data = body.data || {};
    const source = String(body.source || body.device_id || "").slice(0, 128) || null;

    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    const activities = Array.isArray(data.activities) ? data.activities : [];
    const entries = Array.isArray(data.entries) ? data.entries : [];

    // 1) 主表 upsert（自适应剔除未知列）
    const r1 = await upsertWithAdaptiveStrip(sb, "ops_accounts", accounts);
    if (!r1.ok) return json(res, 500, { ok: false, error: r1.error, where: "ops_accounts", message: r1.message, debug: r1 });

    const r2 = await upsertWithAdaptiveStrip(sb, "ops_activities", activities);
    if (!r2.ok) return json(res, 500, { ok: false, error: r2.error, where: "ops_activities", message: r2.message, debug: r2 });

    // entries 可选：你目前 entries 为空/不做也行
    let r3 = { ok: true, table: "ops_entries", upserted: 0, stripped: [], attempts: 0 };
    if (entries.length) {
      r3 = await upsertWithAdaptiveStrip(sb, "ops_entries", entries);
      if (!r3.ok) return json(res, 500, { ok: false, error: r3.error, where: "ops_entries", message: r3.message, debug: r3 });
    }

    // 2) deletes 队列写入（幂等）
    const deletes = normalizeDeletes(body.deletes);
    let deletesInserted = 0;
    if (deletes.length) {
      const rows = deletes.map((d) => ({
        table_name: d.table_name,
        row_id: d.row_id,
        deleted_at: d.deleted_at || new Date().toISOString(),
        source: d.source || source,
      }));
      const { error } = await sb.from("ops_deletes").upsert(rows, { onConflict: "table_name,row_id" });
      if (error) return json(res, 500, { ok: false, error: "supabase_error", where: "ops_deletes", message: error.message });
      deletesInserted = rows.length;
    }

    return json(res, 200, {
      ok: true,
      db,
      upsert: {
        accounts: r1.upserted,
        activities: r2.upserted,
        entries: r3.upserted,
      },
      stripped: {
        ops_accounts: r1.stripped,
        ops_activities: r2.stripped,
        ops_entries: r3.stripped,
      },
      deletesInserted,
      note: "push ok (adaptive strip unknown columns; no information_schema)",
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) });
  }
}
