import { withCors } from './_util.js';

export default async function handler(req, res) {
  if (withCors(req, res)) return;

  // 原有 pull 逻辑保持不变
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
import { cors, handleOptions, auth, getSupabase, serverErr } from "./_util.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== "GET") {
    cors(res);
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }
  try {
    if (!auth(req, res)) return;
    const sb = getSupabase();

    const [acc, act, ent] = await Promise.all([
      sb.from("ops_accounts").select("*"),
      sb.from("ops_activities").select("*"),
      sb.from("ops_activity_entries").select("*"),
    ]);

    if (acc.error) throw acc.error;
    if (act.error) throw act.error;
    if (ent.error) throw ent.error;

    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      server_time: new Date().toISOString(),
      accounts: acc.data || [],
      activities: act.data || [],
      entries: ent.data || [],
    }));
  } catch (e) {
    serverErr(res, e?.message || String(e));
  }
}
