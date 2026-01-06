const { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso, sendJson, handleError } = require("./_util");

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

module.exports = async function handler(req, res) {
  try {
    if (applyCors(req, res)) return;

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });

    const auth = requireAdminToken(req);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    let body = {};
    try {
      body = await readJson(req);
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }

    const sb = supabaseAdmin();
    const applied = { accounts: 0, activities: 0, entries: 0, deletes: 0 };
    const conflicts = [];

    // upserts
    const upserts = body.upserts || {};
    for (const key of Object.keys(TABLE_MAP)) {
      const rows = Array.isArray(upserts[key]) ? upserts[key] : [];
      if (!rows.length) continue;

      const payload = rows.map(r => ({ ...r, updated_at: r.updated_at || nowIso() }));
      const { data, error } = await sb
        .from(TABLE_MAP[key])
        .upsert(payload, { onConflict: "id" })
        .select("id,updated_at");

      if (error) return sendJson(res, 500, { ok: false, error: "supabase_error", table: TABLE_MAP[key], detail: error.message });
      applied[key] += (data || []).length;
    }

    // deletes
    const deletes = Array.isArray(body.deletes) ? body.deletes : [];
    if (deletes.length) {
      for (const d of deletes) {
        const table = d?.table;
        const id = d?.id;
        if (!table || !id) continue;

        const deleted_at = d.deleted_at || nowIso();
        const { error } = await sb
          .from(table)
          .update({ deleted_at, updated_at: nowIso() })
          .eq("id", id);

        if (error) return sendJson(res, 500, { ok: false, error: "supabase_error", table, detail: error.message });
        applied.deletes += 1;
      }
    }

    return sendJson(res, 200, { ok: true, server_ts: nowIso(), applied, conflicts, note: "push ok (v21 vercel api debug)" });
  } catch (err) {
    return handleError(res, err);
  }
};
