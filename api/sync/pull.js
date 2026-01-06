// api/sync/pull.js
import { cors, assertAdmin, ok, fail } from './_util.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!assertAdmin(req, res)) return;

  try {
    // ===== 在这里放你原本的 pull 逻辑 =====
    // 例如：
    // const data = await loadFromSupabase();
    // ok(res, { data });

    return ok(res, { note: 'pull ok (placeholder)' });
  } catch (e) {
    return fail(res, 500, 'server_error', {
      detail: String(e?.message || e),
    });
  }
}
