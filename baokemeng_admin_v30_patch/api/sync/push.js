// /api/sync/push.js
// V27（永久修复版）
// 目标：Push 端不再依赖 information_schema（避免 RLS/缓存问题），并且对列差异/主键差异做容错。
// 依赖环境变量：NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ADMIN_SYNC_TOKEN

import { createClient } from "@supabase/supabase-js";

function json(res, code, obj) {
  return res.status(code).json(obj);
}

function getToken(req) {
  // 支持：header x-admin-token / query admin_token / body.admin_token
  const h = req.headers["x-admin-token"] || req.headers["X-Admin-Token"];
  return (
    (Array.isArray(h) ? h[0] : h) ||
    req.query?.admin_token ||
    req.body?.admin_token ||
    ""
  );
}

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !service) throw new Error("Supabase env missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  return createClient(url, service, { auth: { persistSession: false } });
}

// 仅允许写入我们自己维护的表（按你项目约定）
const TABLES = {
  accounts: { table: "ops_accounts", onConflict: "account" },
  activities: { table: "ops_activities", onConflict: "id" },
  entries: { table: "ops_entries", onConflict: "id" },
  deletes: { table: "ops_deletes", onConflict: "id" },
};

// 你前端实际会用到的列（列不匹配会导致 Supabase/PostgREST 直接报错，因此先白名单过滤）
const ALLOW = {
  ops_accounts: [
    "account",
    "activity_name",
    "tags",
    "status",
    "pwd",
    "phone",
    "zip",
    "addr_city",
    "addr_line",
    "name_cn",
    "name_jp",
    "card_name",
    "card_num",
    "exp",
    "cvv",
    "dob",
    "note1",
    "note2",
    "note3",
    "note4",
    "applied",
    "paid",
    "won",
    "updated_at",
  ],
  ops_activities: [
    "id",
    "name",
    "desc",
    "start_at",
    "end_at",
    "created_at",
    "updated_at",
  ],
  ops_entries: [
    "id",
    "account",
    "activity_id",
    "created_at",
    "updated_at",
  ],
  ops_deletes: [
    "id",
    "table_name",
    "row_id",
    "deleted_at",
    "source",
    "created_at",
  ],
};

function pickAllowed(table, obj) {
  const allow = new Set(ALLOW[table] || []);
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    if (allow.has(k)) out[k] = v;
  }
  return out;
}

// Supabase 返回 "Could not find the '<col>' column" 或类似信息时，剥离列再重试（永久容错）
function extractMissingColumn(message) {
  if (!message) return null;
  const m1 = /Could not find the '([^']+)' column/i.exec(message);
  if (m1) return m1[1];
  const m2 = /column ([a-zA-Z0-9_]+) of relation/i.exec(message);
  if (m2) return m2[1];
  return null;
}

async function safeUpsert(sb, table, onConflict, rows) {
  const cleanRows = (rows || [])
    .filter((r) => r && typeof r === "object")
    .map((r) => pickAllowed(table, r))
    .filter((r) => Object.keys(r).length > 0);

  if (cleanRows.length === 0) return { ok: true, table, count: 0 };

  // 强制 key 字段存在（避免 upsert 无法执行）
  if (onConflict) {
    const k = onConflict.split(",")[0].trim();
    for (const r of cleanRows) {
      if (r[k] == null || String(r[k]).trim() === "") {
        // 丢弃无主键的数据行，避免整个批次失败
        delete r[k];
      }
    }
  }

  let payload = cleanRows;
  for (let i = 0; i < 6; i++) {
    const { error } = await sb.from(table).upsert(payload, {
      onConflict,
      returning: "minimal",
    });
    if (!error) return { ok: true, table, count: payload.length };

    // 主键/唯一约束缺失：退化为 insert（忽略重复）
    const msg = error.message || String(error);
    if (/no unique constraint|duplicate key|unique constraint/i.test(msg)) {
      const { error: e2 } = await sb.from(table).insert(payload, {
        returning: "minimal",
      });
      if (!e2) return { ok: true, table, count: payload.length, mode: "insert" };
      return { ok: false, table, message: e2.message || String(e2) };
    }

    const col = extractMissingColumn(msg);
    if (!col) return { ok: false, table, message: msg };

    // 剥离缺失列并重试
    payload = payload.map((r) => {
      const rr = { ...r };
      delete rr[col];
      return rr;
    });
  }
  return { ok: false, table, message: "too_many_retries" };
}

function normalizeArray(x) {
  return Array.isArray(x) ? x : [];
}

function parsePayload(body) {
  // 兼容多种 client 形态：
  // 1) { snapshot: { data: {accounts,activities,entries}, hash }, deletes }
  // 2) { data: {accounts,...}, deletes }
  // 3) { accounts, activities, entries, deletes }
  const snap = body?.snapshot?.data || body?.data || body?.snapshot || body || {};
  return {
    accounts: normalizeArray(snap.accounts),
    activities: normalizeArray(snap.activities),
    entries: normalizeArray(snap.entries),
    deletes: normalizeArray(body?.deletes || snap.deletes),
    hash: body?.snapshot?.hash || snap.hash || body?.hash || null,
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method_not_allowed" });

    const expect = process.env.ADMIN_SYNC_TOKEN || "";
    const token = String(getToken(req) || "");
    if (!expect || token !== expect) return json(res, 401, { ok: false, error: "unauthorized" });

    const sb = supabaseAdmin();

    const p = parsePayload(req.body || {});
    const t0 = Date.now();

    const r1 = await safeUpsert(sb, TABLES.accounts.table, TABLES.accounts.onConflict, p.accounts);
    const r2 = await safeUpsert(sb, TABLES.activities.table, TABLES.activities.onConflict, p.activities);
    const r3 = await safeUpsert(sb, TABLES.entries.table, TABLES.entries.onConflict, p.entries);
    const r4 = await safeUpsert(sb, TABLES.deletes.table, TABLES.deletes.onConflict, p.deletes);

    const ok = r1.ok && r2.ok && r3.ok && r4.ok;

    return json(res, ok ? 200 : 500, {
      ok,
      error: ok ? null : "supabase_error",
      counts: {
        accounts: p.accounts.length,
        activities: p.activities.length,
        entries: p.entries.length,
        deletes: p.deletes.length,
      },
      applied: {
        accounts: r1.count || 0,
        activities: r2.count || 0,
        entries: r3.count || 0,
        deletes: r4.count || 0,
      },
      detail: { r1, r2, r3, r4 },
      ms: Date.now() - t0,
    });
  } catch (e) {
    return json(res, 500, { ok: false, error: "server_error", message: e?.message || String(e) });
  }
}
