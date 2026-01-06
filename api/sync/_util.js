// api/sync/_util.js

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export function assertAdmin(req, res) {
  const expected = process.env.ADMIN_SYNC_TOKEN || '';
  const got = (req.headers['x-admin-token'] || '').toString();

  // 如果没配置环境变量，直接给出明确错误，避免“静默 500”
  if (!expected) {
    res.status(500).json({ ok: false, error: 'ADMIN_SYNC_TOKEN missing in server env' });
    return false;
  }

  if (got !== expected) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return false;
  }
  return true;
}

export function ok(res, data = {}) {
  res.status(200).json({ ok: true, ...data });
}

export function fail(res, status, message, extra = {}) {
  res.status(status).json({ ok: false, error: message, ...extra });
}
