// api/sync/pull.js
import { applyCors, requireAdmin } from './_util.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;        // 处理 OPTIONS
  if (!requireAdmin(req, res)) return;    // 校验 token

  // 先返回占位，保证链路跑通
  return res.status(200).json({ ok: true, note: 'pull ok (cors from function)' });
}
