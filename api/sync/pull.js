import { cors, handleOptions, auth, getSupabase, bad, serverErr, readJsonBody } from "./_util.js";

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  // Allow GET and POST (admin.html currently uses GET in some builds)
  if (req.method !== "GET" && req.method !== "POST") {
    cors(res);
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  try {
    const body = (req.method === "POST") ? await readJsonBody(req) : {};

    if (!auth(req, res, body)) return;

    // Optional: support "mode" from POST body in future
    if (req.method === "POST") {
      try { await readJsonBody(req); } catch (_) { /* ignore */ }
    }

    const sb = getSupabase();

    const { data: accounts, error: e1 } = await sb.from("ops_accounts").select("*");
    if (e1) throw e1;

    const { data: activities, error: e2 } = await sb.from("ops_activities").select("*");
    if (e2) throw e2;

    const { data: entries, error: e3 } = await sb.from("ops_activity_entries").select("*");
    if (e3) throw e3;

    cors(res);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      ok: true,
      pulled_at: new Date().toISOString(),
      mode: "full",
      data: {
        accounts: accounts || [],
        activities: activities || [],
        entries: entries || [],
      }
    }));
  } catch (e) {
    serverErr(res, e?.message || String(e));
  }
}