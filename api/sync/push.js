import { cors, assertAdmin } from './_util.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!assertAdmin(req, res)) return;

  // 下面保持你原有 pull/push 逻辑不变
}

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
}

export default async function handler(req, res) {
  withCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ...你原来的逻辑
}
import { cors, handleOptions, auth, getSupabase, bad, serverErr } from "./_util.js";

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

    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf-8") || "{}";
    const body = JSON.parse(raw);

    const snapshot = body?.snapshot;
    const deletes = body?.deletes || {};
    if (!snapshot) return bad(res, "missing snapshot");

    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const activities = Array.isArray(snapshot.activities) ? snapshot.activities : [];
    const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];

    const delActivities = Array.isArray(deletes.activities) ? deletes.activities : [];

    const sb = getSupabase();

    // 1) delete activities (cascade deletes entries)
    if (delActivities.length) {
      const { error } = await sb.from("ops_activities").delete().in("id", delActivities);
      if (error) throw error;
    }

    // 2) upsert activities
    if (activities.length) {
      const { error } = await sb.from("ops_activities").upsert(activities, { onConflict: "id" });
      if (error) throw error;
    }

    // 3) upsert accounts
    if (accounts.length) {
      const { error } = await sb.from("ops_accounts").upsert(accounts, { onConflict: "account" });
      if (error) throw error;
    }

    // 4) upsert entries
    if (entries.length) {
      const { error } = await sb.from("ops_activity_entries").upsert(entries, { onConflict: "activity_id,account" });
      if (error) throw error;
    }

    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      received: { accounts: accounts.length, activities: activities.length, entries: entries.length },
      deleted: { activities: delActivities.length },
      server_time: new Date().toISOString(),
    }));
  } catch (e) {
    serverErr(res, e?.message || String(e));
  }
}
