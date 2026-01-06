import { cors, handleOptions } from "./_util.js";

export default function handler(req, res) {
  if (handleOptions(req, res)) return;
  cors(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
}
