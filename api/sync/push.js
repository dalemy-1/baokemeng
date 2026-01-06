// api/sync/push.js (ESM)
// 接收本地快照并写入云端（支持 deletes.activities）
// body: { snapshot: { accounts:[], activities:[], entries:[] }, deletes?: { activities?:[] } }
import { cors, handleOptions, auth, getSupabase, bad, serverErr, TABLES, CONFLICT } from "./_util.js";

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
  return JSON.parse(raw);
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "POST") {
    cors(res);
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    if (!auth(req, res)) return;

    const body = await readJsonBody(req);

    const snapshot = body?.snapshot;
    const deletes = body?.deletes || {};
    if (!snapshot) return bad(res, "missing snapshot");

    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const activities = Array.isArray(snapshot.activities) ? snapshot.activities : [];
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];

    const delActivities = Array.isArray(deletes.activities) ? deletes.activities : [];

    const sb = getSupabase();

    // 1) delete activities（先删 entries 更稳）
    if (delActivities.length) {
      const delE = await sb.from(TABLES.entries).delete().in("activity_id", delActivities);
      if (delE.error) throw delE.error;

      const delA = await sb.from(TABLES.activities).delete().in("id", delActivities);
      if (delA.error) throw delA.error;
    }

    // 2) upsert activities
    if (activities.length) {
      const r = await sb.from(TABLES.activities).upsert(activities, { onConflict: CONFLICT.activities });
      if (r.error) throw r.error;
    }

    // 3) upsert accounts
    if (accounts.length) {
      const r = await sb.from(TABLES.accounts).upsert(accounts, { onConflict: CONFLICT.accounts });
      if (r.error) throw r.error;
    }

    // 4) upsert entries
    if (entries.length) {
      const r = await sb.from(TABLES.entries).upsert(entries, { onConflict: CONFLICT.entries });
      if (r.error) throw r.error;
    }

    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: true,
        received: { accounts: accounts.length, activities: activities.length, entries: entries.length },
        deleted: { activities: delActivities.length },
        server_time: new Date().toISOString(),
      })
    );
  } catch (e) {
    serverErr(res, e?.message || String(e));
  }
}
