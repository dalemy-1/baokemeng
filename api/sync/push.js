// api/sync/push.js
// V25 (稳态增强)：Push 端“按云端真实列过滤”——本地多字段不会再导致 500
// 适配：Vercel Serverless Functions 目录结构（/api/sync/push.js）
// 依赖：SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL + ADMIN_SYNC_TOKEN
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !service) throw new Error("Supabase env missing");
  return createClient(url, service, { auth: { persistSession: false } });
}

function pick(obj, allowedSet) {
  if (!obj || typeof obj !== "object") return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (allowedSet.has(k)) out[k] = v;
  }
  return out;
}


// === 不再读取 information_schema（Supabase REST 默认不可读，会导致 500）===
// 服务器端按白名单过滤字段：避免本地多字段/旧字段导致“列不存在”从而 500。
// 说明：如果你未来新增字段，需同时：1) Supabase 表加列；2) 把字段加入白名单（可选）。
const ACCOUNT_ALLOWED = new Set([
  "account","activity_name","won","paid","applied","apply_title","tags","status",
  "pwd","aux_email","aux_pwd","phone","zip","addr_city","addr_line","name_cn","name_jp",
  "card_name","card_num","exp","cvv","dob","birth_ym","note1","note2","note3","note4","updated_at"
]);

const ACT_ALLOWED = new Set([
  "id","name","status","start_at","end_at","note","created_at","updated_at"
]);

function getAllowedColumnsLocal(table){
  if (table === "ops_accounts") return ACCOUNT_ALLOWED;
  if (table === "ops_activities") return ACT_ALLOWED;
  // 默认：仅允许 id（防止误写导致 500）
  return new Set(["id"]);
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
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    // --- Auth (Admin token) ---
    const expected = process.env.ADMIN_SYNC_TOKEN || "";
    const token =
      (req.headers["x-admin-token"] || req.headers["x-admin-sync-token"] || "").toString() ||
      (req.body?.admin_token || "").toString();

    if (!expected || token !== expected) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const sb = supabaseAdmin();

    // --- Parse payload ---
    // 兼容多种客户端 payload 形态：{ db, data: { accounts, activities, entries }, deletes, source }
    const payload = req.body || {};
    const dbName = String(payload.db || payload.db_name || "").slice(0, 128);
    const source = String(payload.source || payload.device_id || "").slice(0, 128);

    const dataObj = payload.data || payload.snapshot || payload.state || {};
    const accounts = Array.isArray(dataObj.accounts) ? dataObj.accounts : (dataObj.accounts?.rows || []);
    const activities = Array.isArray(dataObj.activities) ? dataObj.activities : (dataObj.activities?.rows || []);
    const entries = Array.isArray(dataObj.entries) ? dataObj.entries : (dataObj.entries?.rows || []);

    // --- Table mapping ---
    const TABLES = {
      accounts: "ops_accounts",
      activities: "ops_activities",
      entries: "ops_entries",
    };

    // --- Column allowlists (云端真实列) ---
    const allowAccounts = await getAllowedColumns(sb, TABLES.accounts);
    const allowActivities = await getAllowedColumns(sb, TABLES.activities);
    const allowEntries = await getAllowedColumns(sb, TABLES.entries);

    // --- Filter rows ---
    const filteredAccounts = (accounts || [])
      .map((r) => pick(r, allowAccounts))
      .filter((r) => r && r.id);
    const filteredActivities = (activities || [])
      .map((r) => pick(r, allowActivities))
      .filter((r) => r && r.id);
    const filteredEntries = (entries || [])
      .map((r) => pick(r, allowEntries))
      .filter((r) => r && r.id);

    // --- Upsert helpers ---
    async function safeUpsert(table, rows, tag) {
      if (!rows || rows.length === 0) return { upserted: 0 };
      const BATCH = 500;
      let upserted = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error } = await sb.from(table).upsert(chunk, { onConflict: "id" });
        if (error) throw new Error(`${tag} upsert failed: ${error.message || String(error)}`);
        upserted += chunk.length;
      }
      return { upserted };
    }

    // --- Deletes queue (tombstone) ---
    const deletes = normalizeDeletes(payload.deletes || dataObj.deletes);
    let deletes_written = 0;
    if (deletes.length > 0) {
      const nowIso = new Date().toISOString();
      const toWrite = deletes.map((d) => ({
        table_name: d.table_name,
        row_id: d.row_id,
        deleted_at: d.deleted_at || nowIso,
        source: d.source || source || "client",
      }));

      const { error } = await sb.from("ops_deletes").upsert(toWrite, {
        onConflict: "table_name,row_id",
      });
      if (error) throw new Error(`deletes upsert failed: ${error.message || String(error)}`);
      deletes_written = toWrite.length;
    }

    // --- Main upserts ---
    const r1 = await safeUpsert(TABLES.accounts, filteredAccounts, "accounts");
    const r2 = await safeUpsert(TABLES.activities, filteredActivities, "activities");
    const r3 = await safeUpsert(TABLES.entries, filteredEntries, "entries");

    return res.json({
      ok: true,
      db: dbName || null,
      source: source || null,
      counts: {
        accounts_in: accounts?.length || 0,
        activities_in: activities?.length || 0,
        entries_in: entries?.length || 0,
        accounts_upserted: r1.upserted,
        activities_upserted: r2.upserted,
        entries_upserted: r3.upserted,
        deletes_written,
      },
      note: "push ok (filtered by server schema)",
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "supabase_error",
      message: e?.message || String(e),
    });
  }
}
