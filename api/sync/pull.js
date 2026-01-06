import { cors, assertAdmin, ok, fail } from './_util.js';

export default async function handler(req, res) {
  // ✅ 一定要最先处理 CORS + OPTIONS
  if (cors(req, res)) return;

  // ✅ 再做 token 校验
  if (!assertAdmin(req, res)) return;

  try {
    // ===== 这里放你原本的 pull 逻辑 =====
    // 例如：
    // const data = await loadFromSupabase();
    // return ok(res, { data });

    return ok(res, { note: 'pull ok' });
  } catch (e) {
    return fail(res, 500, 'server_error', {
      detail: String(e?.message || e),
    });
  }
}
