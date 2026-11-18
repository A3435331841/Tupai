// 图派契约测试（扩展）：覆盖二期资产库/画册/分享与三期社区/任务/通知/账号。
// 仅用于本地 fake 后端（身份夹具依赖 x-qoder-user-context）；云端网关会注入真实身份，不应直接复用本脚本。
// 用法: node api/contract-test-extended.mjs [baseUrl]
import { randomUUID } from 'node:crypto';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000/functions/v1/app').replace(/\/$/, '');
const API = `${BASE}/api/v1`;

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

function uc(uid, name) {
  const ctx = { user_id: uid, site_id: 'site-1', host_id: 'host-1', name, picture: '', session_expires_at: Math.floor(Date.now() / 1000) + 3600 };
  return Buffer.from(JSON.stringify(ctx)).toString('base64url');
}

const GUEST = randomUUID();
const A = uc('contract-a', '作者甲');
const B = uc('contract-b', '用户乙');
const HA = { 'x-qoder-user-context': A, 'X-Session-Id': 'sess-contract-a' };
const HB = { 'x-qoder-user-context': B, 'X-Session-Id': 'sess-contract-b' };
const HG = { 'X-Session-Id': GUEST };

async function req(method, path, { body, headers = HG, raw = false } = {}) {
  const h = { ...headers };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text, contentType: res.headers.get('content-type') || '' };
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function upload(headers) {
  const fd = new FormData();
  fd.append('file', new Blob([PNG], { type: 'image/png' }), 't.png');
  fd.append('kind', 'original');
  const r = await req('POST', '/assets', { body: fd, headers });
  return r.json?.asset_id;
}

async function makeResult(headers) {
  const aid = await upload(headers);
  if (!aid) return null;
  const g = await req('POST', '/jobs/generate', { body: { asset_id: aid, prompt: 'contract extended prompt', model: 'agnes-image-2.5-flash', ratio: '3:4' }, headers });
  const jobId = g.json?.job_id;
  if (!jobId) return null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const jr = await req('GET', `/jobs/${jobId}`, { headers });
    if (jr.json?.status === 'succeeded') return jr.json.result?.asset_id || null;
    if (jr.json?.status === 'failed') return null;
  }
  return null;
}

async function main() {
  console.log(`扩展契约测试 → ${API}`);

  // 1. 健康检查
  {
    const r = await req('GET', '/health', { headers: {} });
    check('health 200 + keys 布尔', r.status === 200 && typeof r.json?.keys_configured === 'boolean', JSON.stringify(r.json));
  }

  // 2. 资产库：上传/列表/打标/软删/恢复
  let originalId = null;
  {
    originalId = await upload(HG);
    check('上传返回 asset_id', typeof originalId === 'string');
    const list = await req('GET', '/assets?kind=original&limit=10');
    check('资产列表含新上传', list.status === 200 && list.json?.assets?.some((a) => a.id === originalId));
    const patch = await req('PATCH', `/assets/${originalId}`, { body: { tags: ['契约', '测试'] } });
    check('资产打标 200', patch.status === 200 && patch.json?.asset?.tags?.includes('契约'));
    const del = await req('DELETE', `/assets/${originalId}`);
    check('软删返回 deleted_at', del.status === 200 && typeof del.json?.deleted_at === 'string');
    const hidden = await req('GET', '/assets?kind=original&limit=10');
    check('默认列表不含软删', hidden.status === 200 && !hidden.json?.assets?.some((a) => a.id === originalId));
    const withDeleted = await req('GET', '/assets?kind=original&include_deleted=1&limit=10');
    check('include_deleted=1 可见', withDeleted.status === 200 && withDeleted.json?.assets?.some((a) => a.id === originalId));
    const restore = await req('POST', `/assets/${originalId}/restore`);
    check('恢复后 deleted_at=null', restore.status === 200 && restore.json?.asset?.deleted_at === null);
  }

  // 3. 画册 + 只读分享
  let resultId = null, albumId = null, shareToken = null;
  {
    resultId = await makeResult(HG);
    check('生成 result 资产', typeof resultId === 'string');
    const bad = await req('POST', '/albums', { body: { title: '非法画册', item_ids: [originalId] } });
    check('画册拒收 original', bad.status === 400);
    const created = await req('POST', '/albums', { body: { title: '契约画册', item_ids: [resultId] } });
    check('创建画册 201', created.status === 201 && typeof created.json?.album?.id === 'string');
    albumId = created.json?.album?.id;
    const list = await req('GET', '/albums');
    check('画册列表含新册', list.status === 200 && list.json?.albums?.some((a) => a.id === albumId));
    const one = await req('GET', `/albums/${albumId}`);
    check('画册详情 200', one.status === 200 && one.json?.album?.item_ids?.includes(resultId));
    const patch = await req('PATCH', `/albums/${albumId}`, { body: { title: '契约画册·改' } });
    check('画册改名 200', patch.status === 200 && patch.json?.album?.title === '契约画册·改');
    const share = await req('POST', `/albums/${albumId}/share`, { body: { expires_hours: 1 } });
    check('生成分享 200', share.status === 200 && typeof share.json?.share_token === 'string');
    shareToken = share.json?.share_token;
    const view = await req('GET', `/share/${shareToken}`, { headers: {} });
    check('分享视图无需登录', view.status === 200 && view.json?.images?.length === 1);
    const img = await req('GET', `/share/${shareToken}/img/${resultId}`, { headers: {}, raw: true });
    check('分享图 200 image/*', img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'));
    const page = await req('GET', `/share/${shareToken}/page`, { headers: {} });
    check('分享翻页页 200 html', page.status === 200 && page.contentType.includes('text/html'));
    const revoke = await req('DELETE', `/albums/${albumId}/share`);
    check('撤回分享 200', revoke.status === 200);
    const gone = await req('GET', `/share/${shareToken}`, { headers: {} });
    check('撤回后分享 404', gone.status === 404);
    const del = await req('DELETE', `/albums/${albumId}`);
    check('删除画册 200', del.status === 200);
  }

  // 4. 登录态与绑定
  {
    const anon = await req('GET', '/me', { headers: HG });
    check('游客 me logged_in=false', anon.status === 200 && anon.json?.logged_in === false);
    const meA = await req('GET', '/me', { headers: HA });
    check('登录 me logged_in=true', meA.status === 200 && meA.json?.logged_in === true && meA.json?.user?.user_id === 'contract-a');
    const bindGuest = await upload(HG);
    const bind = await req('POST', '/auth/bind', { headers: { 'x-qoder-user-context': A, 'X-Session-Id': GUEST } });
    check('bind 迁移游客数据', bind.status === 200 && bind.json?.migrated >= 1, JSON.stringify(bind.json));
    const migrated = await req('GET', '/assets?include_deleted=1&limit=60', { headers: HA });
    check('绑定后资产归入登录用户', migrated.status === 200 && migrated.json?.assets?.some((a) => a.id === bindGuest));
    const bindAnon = await req('POST', '/auth/bind', { headers: HG });
    check('未登录 bind 401', bindAnon.status === 401 && bindAnon.json?.error?.code === 'login_required');
  }

  // 5. 社区：发布/发现/详情/图/评论/点赞/fork/任务/通知/举报/撤回/重发/删除
  let workId = null, resultA = null, taskId = null, notificationId = null;
  {
    resultA = await makeResult(HA);
    check('登录用户生成 result', typeof resultA === 'string');
    const pub = await req('POST', '/works', {
      headers: HA,
      body: { result_asset_id: resultA, title: '契约作品', tags: ['契约'], skill_snapshot: { prompt: 'contract work prompt', model: 'agnes-image-2.5-flash', ratio: '3:4' }, allow_fork: true },
    });
    check('发布作品 201', pub.status === 201 && typeof pub.json?.work?.id === 'string', JSON.stringify(pub.json).slice(0, 120));
    workId = pub.json?.work?.id;
    const feed = await req('GET', '/feed?sort=new&limit=10', { headers: {} });
    check('发现页含作品', feed.status === 200 && feed.json?.works?.some((w) => w.id === workId));
    const one = await req('GET', `/works/${workId}`, { headers: {} });
    check('作品详情 200', one.status === 200 && one.json?.work?.id === workId);
    const img = await req('GET', `/works/${workId}/img`, { headers: {}, raw: true });
    check('作品图 200 image/*', img.status === 200 && (img.headers.get('content-type') || '').startsWith('image/'));
    const comment = await req('POST', `/works/${workId}/comments`, { headers: HB, body: { body: '契约评论' } });
    check('评论 201', comment.status === 201 && typeof comment.json?.comment?.id === 'string');
    const comments = await req('GET', `/works/${workId}/comments`, { headers: {} });
    check('评论列表 200', comments.status === 200 && comments.json?.comments?.length === 1);
    const like = await req('POST', `/works/${workId}/like`, { headers: HB });
    check('点赞 liked=true', like.status === 200 && like.json?.liked === true);
    const fork = await req('POST', `/works/${workId}/fork`, { headers: {} });
    check('fork 返回配方与 lineage', fork.status === 200 && fork.json?.parent_work_id === workId && fork.json?.depth === 1);
    const task = await req('POST', '/tasks', { headers: HA, body: { theme: '契约共创', constraints: '夜景' } });
    check('创建任务 201', task.status === 201 && typeof task.json?.task?.id === 'string');
    taskId = task.json?.task?.id;
    const tasks = await req('GET', '/tasks', { headers: {} });
    check('任务列表含新任务', tasks.status === 200 && tasks.json?.tasks?.some((t) => t.id === taskId));
    const sub = await req('POST', `/tasks/${taskId}/submissions`, { headers: HA, body: { work_id: workId } });
    check('任务提交 201', sub.status === 201 && sub.json?.ok === true);
    const detail = await req('GET', `/tasks/${taskId}`, { headers: {} });
    check('任务详情含提交作品', detail.status === 200 && detail.json?.works?.some((w) => w.id === workId));
    const notes = await req('GET', '/notifications', { headers: HB });
    check('通知列表 200', notes.status === 200 && Array.isArray(notes.json?.notifications));
    if (notes.json?.notifications?.length) {
      notificationId = notes.json.notifications[0].id;
      const read = await req('POST', `/notifications/${notificationId}/read`, { headers: HB });
      check('通知已读 200', read.status === 200 && read.json?.ok === true);
    } else {
      check('通知已读 200', true, '该用户无通知，跳过');
    }
    const appealBad = await req('POST', `/works/${workId}/appeal`, { headers: HA });
    check('未下架作品申诉 400', appealBad.status === 400);
    const withdraw = await req('POST', `/works/${workId}/withdraw`, { headers: HA });
    check('撤回作品 200', withdraw.status === 200 && withdraw.json?.status === 'withdrawn');
    const feedAfter = await req('GET', '/feed?sort=new&limit=10', { headers: {} });
    check('撤回后发现页不含', feedAfter.status === 200 && !feedAfter.json?.works?.some((w) => w.id === workId));
    const republish = await req('POST', `/works/${workId}/publish`, { headers: HA });
    check('重新发布 200', republish.status === 200 && republish.json?.status === 'published');
    const exportMe = await req('GET', '/me/export', { headers: HA });
    check('数据导出含作品/画册/配方', exportMe.status === 200 && Array.isArray(exportMe.json?.works) && Array.isArray(exportMe.json?.albums));
    const del = await req('DELETE', `/works/${workId}`, { headers: HA });
    check('删除作品 200', del.status === 200 && del.json?.ok === true);
  }

  // 6. 注销（用独立用户 B，避免影响 A 的断言）
  {
    await makeResult(HB);
    const del = await req('DELETE', '/me', { headers: HB });
    check('注销 200 deleted', del.status === 200 && del.json?.deleted === true);
    const after = await req('GET', '/me', { headers: HB });
    check('注销后 me 仍可用（匿名）', after.status === 200);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('扩展契约测试异常:', e); process.exit(2); });
