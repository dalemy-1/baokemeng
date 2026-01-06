// api/sync/pull.js (ESM)
// 返回云端快照：ops_accounts / ops_activities / ops_activity_entries
import { cors, handleOptions, auth, getSupabase, serverErr, TABLES } from "./_util.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  if (req.method !== "POST" && req.method !== "GET") {
    cors(res);
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    if (!auth(req, res)) return;

    const sb = getSupabase();

    const [a, b, c] = await Promise.all([
      sb.from(TABLES.accounts).select("*"),
      sb.from(TABLES.activities).select("*"),
      sb.from(TABLES.entries).select("*"),
    ]);

    if (a.error) throw a.error;
    if (b.error) throw b.error;
    if (c.error) throw c.error;

    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: true,
        server_time: new Date().toISOString(),
        snapshot: {
          accounts: a.data || [],
          activities: b.data || [],
          entries: c.data || [],
        },
      })
    );
  } catch (e) {
    serverErr(res, e?.message || String(e));
  }
}
