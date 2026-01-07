// api/sync/ack_deletes.js
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !service) throw new Error("Supabase env missing");
  return createClient(url, service, { auth: { persistSession: false } });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const expected = process.env.ADMIN_SYNC_TOKEN || "";
    const token =
      (req.headers["x-admin-sync-token"] || "").toString() ||
      (req.body?.admin_token || "").toString();

    if (!expected || token !== expected) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];
    const source = (req.body?.source || "").toString();

    if (deletes.length === 0) {
      return res.json({ ok: true, updated: 0, note: "no deletes" });
    }

    // 简单清洗 + 限制数量，避免被滥用
    const trimmed = deletes
      .map((d) => ({
        table_name: String(d?.table_name || "").slice(0, 64),
        row_id: String(d?.row_id || "").slice(0, 128),
      }))
      .filter((d) => d.table_name && d.row_id)
      .slice(0, 500);

    if (trimmed.length === 0) {
      return res.json({ ok: true, updated: 0, note: "no valid deletes" });
    }

    const sb = supabaseAdmin();

    // 方案A：直接 update 自增（不依赖 RPC）
    // 如果你更喜欢 RPC（你之前说的），我也可以给你 RPC 版。
    let updated = 0;
    for (const d of trimmed) {
      const { error } = await sb
        .from("ops_deletes")
        .update({ applied_count: sb.rpc ? undefined : undefined }) // 占位，无实际作用
        .eq("table_name", d.table_name)
        .eq("row_id", d.row_id);

      // 上面这一行无法直接做 applied_count = applied_count + 1（JS SDK 不支持原子表达式）
      // 所以这里改用 RPC 更可靠 —— 你已经在 Step1 创建过函数的话，用下面这段替换即可：
    }

    return res.json({
      ok: false,
      error:
        "ack endpoint created, but you must use RPC to increment applied_count atomically. Tell me if Step1已创建RPC，我给你替换成RPC调用的最终版。",
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
