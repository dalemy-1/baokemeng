const { applyCors, requireAdminToken, supabaseAdmin, readJson, nowIso } = require("./_util");

const TABLE_MAP = {
  accounts: "ops_accounts",
  activities: "ops_activities",
  entries: "ops_activity_entries",
};

module.exports = async function handler(req, res) {
  if (applyCors(req, res)) return;

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
  }

  const auth = requireAdminToken(req);
  if (!auth.ok) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: auth.error }));
  }

  let body = {};
  try {
    body = await readJson(req);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
  }

  const sb = supabaseAdmin();
  const applied = { accounts: 0, activities: 0, entries: 0, deletes: 0 };
  const conflicts = []; // v21 简版先不做严格冲突返回

  // 1) upserts
  const upserts = body.upserts || {};
  for (const key of Object.keys(TABLE_MAP)) {
    const rows = Array.isArray(upserts[key]) ? upserts[key] : [];
    if (!rows.length) continue;

    const payload = rows.map(r => ({ ...r, updated_at: r.updated_at || nowIso() }));

    const { data, error } = await sb
      .from(TABLE_MAP[key])
      .upsert(payload, { onConflict: "id" })
      .select("id,updated_at");

    if (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.end(JSON.stringify({ ok: false, error: "supabase_error", table: TABLE_MAP[key], detail: error.message }));
    }
    applied[key] += (data || []).length;
  }

  // 2) deletes（软删除：写 deleted_at）
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

      if (error) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.end(JSON.stringify({ ok: false, error: "supabase_error", table, detail: error.message }));
      }
      applied.deletes += 1;
    }
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.end(JSON.stringify({
    ok: true,
    server_ts: nowIso(),
    applied,
    conflicts,
    note: "push ok (v21 vercel api: upserts + soft deletes)"
  }));
};
