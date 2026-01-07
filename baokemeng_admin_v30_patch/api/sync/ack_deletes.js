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

    let updated = 0;
    for (const d of trimmed) {
      const { error } = await sb.rpc("ops_deletes_inc_applied_count", {
        p_table_name: d.table_name,
        p_row_id: d.row_id,
        p_source: source,
      });
      if (!error) updated += 1;
    }

    return res.json({ ok: true, updated });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
