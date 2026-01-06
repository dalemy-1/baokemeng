// api/sync/pull.js

export default async function handler(req, res) {
  // ===== 强制写 CORS（第一行就执行）=====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-admin-token'
  );

  // ===== 必须立刻处理 OPTIONS =====
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ===== token 校验 =====
  const expected = process.env.ADMIN_SYNC_TOKEN || '';
  const got = (req.headers['x-admin-token'] || '').toString();

  if (!expected) {
    return res
      .status(500)
      .json({ ok: false, error: 'ADMIN_SYNC_TOKEN missing' });
  }

  if (got !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  // ===== 业务逻辑（先给占位成功）=====
  return res.status(200).json({
    ok: true,
    note: 'pull ok (cors fixed)',
  });
}
