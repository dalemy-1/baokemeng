// api/sync/_util.js
export function applyCors(req, res) {
  const origin = req.headers.origin || '*';

  // 关键：明确回显 Origin，并告知缓存按 Origin 区分
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, x-admin-token, Cache-Control, Pragma'
  );

  // 预检直接结束
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // 表示已处理
  }
  return false;
}

export function requireAdmin(req, res) {
  const expected = process.env.ADMIN_SYNC_TOKEN || '';
  const got = String(req.headers['x-admin-token'] || '');

  if (!expected) {
    res.status(500).json({ ok: false, error: 'ADMIN_SYNC_TOKEN missing' });
    return false;
  }
  if (got !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}
