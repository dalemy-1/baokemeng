import { withCors } from './_util.js';

export default async function handler(req, res) {
  if (withCors(req, res)) return;

  res.status(200).json({
    ok: true,
    ts: new Date().toISOString(),
  });
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
import { cors, handleOptions } from "./_util.js";

export default function handler(req, res) {
  if (handleOptions(req, res)) return;
  cors(res);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
}
