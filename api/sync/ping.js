import { cors, assertAdmin, ok } from './_util.js';

export default function handler(req, res) {
  if (cors(req, res)) return;
  if (!assertAdmin(req, res)) return;

  ok(res, { ts: new Date().toISOString() });
}
