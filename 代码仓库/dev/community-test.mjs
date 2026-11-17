// 三期社区全链回归（本地身份夹具：云函数读取网关 x-qoder-user-context；本地用合法 base64url 上下文模拟登录）。
// 运行：node dev/community-test.mjs（默认本地 :8000；BASE 可改）。需后端运行。
const BASE = (process.env.BASE || 'http://127.0.0.1:8000').replace(/\/$/, '');
const B = BASE + '/api/v1';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok ', n); } else { fail++; console.log('FAIL ', n, d); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (r) => ({ s: r.status, b: await r.json().catch(() => null) });
function uc(uid, name) {
  const ctx = { user_id: uid, site_id: 'site-1', host_id: 'host-1', name, picture: '', session_expires_at: Math.floor(Date.now() / 1000) + 3600 };
  return Buffer.from(JSON.stringify(ctx)).toString('base64url');
}
const A = uc('user-a', '作者甲'); const Bu = uc('user-b', '用户乙');
const HA = { 'x-qoder-user-context': A, 'X-Session-Id': 'sess-a' };
const HB = { 'x-qoder-user-context': Bu, 'X-Session-Id': 'sess-b' };
const JA = { ...HA, 'content-type': 'application/json' }; const JB = { ...HB, 'content-type': 'application/json' };
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
async function mkResult(H) {
  const fd = new FormData(); fd.append('file', new File([png], 't.png', { type: 'image/png' })); fd.append('kind', 'original');
  const aid = (await j(await fetch(B + '/assets', { method: 'POST', headers: H, body: fd }))).b.asset_id;
  await fetch(B + '/optimize', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: aid }) });
  const gen = (await j(await fetch(B + '/jobs/generate', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ asset_id: aid, prompt: 'night city', model: 'agnes-image-2.5-flash', ratio: '3:4' }) }))).b;
  for (let i = 0; i < 30; i++) { await sleep(400); const jb = (await j(await fetch(B + '/jobs/' + gen.job_id, { headers: H }))).b; if (jb.status === 'succeeded') return jb.result.asset_id; if (jb.status === 'failed') return null; }
  return null;
}
const publish = (H, rid, title, parent) => fetch(B + '/works', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ result_asset_id: rid, title, skill_snapshot: { prompt: 'night city bright', model: 'agnes-image-2.5-flash', ratio: '3:4' }, allow_fork: true, parent_work_id: parent }) }).then(j);

(async () => {
  const feed0 = await j(await fetch(B + '/feed')); ok('游客可浏览发现页', feed0.s === 200);
  const ridA = await mkResult(HA); ok('A 出图', !!ridA);
  const w1 = await publish(HA, ridA, '夜景一号'); ok('A 发布作品（审核通过）', w1.s === 201 && w1.b.work.status === 'published', JSON.stringify(w1.b));
  const W1 = w1.b.work.id;
  const feed1 = await j(await fetch(B + '/feed')); ok('发现页含作品', feed1.b.works.some((w) => w.id === W1));
  const img = await fetch(B + '/works/' + W1 + '/img'); ok('公开作品图可访问', img.status === 200);
  const like = await j(await fetch(B + '/works/' + W1 + '/like', { method: 'POST', headers: HB })); ok('B 点赞', like.s === 200 && like.b.liked === true);
  const cm = await j(await fetch(B + '/works/' + W1 + '/comments', { method: 'POST', headers: JB, body: JSON.stringify({ body: '好看！' }) })); ok('B 评论', cm.s === 201);
  const cmid = cm.b.comment.id;
  const hide = await j(await fetch(B + '/comments/' + cmid, { method: 'DELETE', headers: HA })); ok('作者隐藏评论', hide.s === 200 && hide.b.hidden === true);
  const cms = await j(await fetch(B + '/works/' + W1 + '/comments')); ok('隐藏后评论列表不含', !cms.b.comments.some((c) => c.id === cmid));
  const fork = await j(await fetch(B + '/works/' + W1 + '/fork', { method: 'POST', headers: HB })); ok('B fork 取配方', fork.s === 200 && fork.b.skill_snapshot.prompt);
  const ridB = await mkResult(HB);
  const w2 = await publish(HB, ridB, '夜景二号', W1); ok('B fork 再发布 depth=1', w2.s === 201 && w2.b.work.depth === 1 && w2.b.work.parent_work_id === W1, JSON.stringify(w2.b));
  const W2 = w2.b.work.id;
  const ntA = await j(await fetch(B + '/notifications', { headers: HA })); ok('A 收到 fork 通知', ntA.b.notifications.some((n) => n.kind === 'fork'));
  const tk = await j(await fetch(B + '/tasks', { method: 'POST', headers: JA, body: JSON.stringify({ theme: '夜景提亮挑战' }) })); ok('A 建共创任务', tk.s === 201);
  const T = tk.b.task.id;
  const sub = await j(await fetch(B + '/tasks/' + T + '/submissions', { method: 'POST', headers: JB, body: JSON.stringify({ work_id: W2 }) })); ok('B 提交任务', sub.s === 201);
  const tg = await j(await fetch(B + '/tasks/' + T)); ok('任务页含提交作品', tg.b.works.some((w) => w.id === W2));
  for (const H of [HA, HB, { 'X-Session-Id': crypto.randomUUID() }]) await fetch(B + '/works/' + W2 + '/report', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ reason: '测试举报' }) });
  const w2g = await j(await fetch(B + '/works/' + W2)); ok('三次举报后下架（游客不可见）', w2g.s === 404);
  const ap = await j(await fetch(B + '/works/' + W2 + '/appeal', { method: 'POST', headers: HB })); ok('B 申诉恢复', ap.s === 200 && ap.b.status === 'published', JSON.stringify(ap.b));
  const wd = await j(await fetch(B + '/works/' + W1 + '/withdraw', { method: 'POST', headers: HA })); ok('A 撤回作品', wd.s === 200);
  const forkAfter = await j(await fetch(B + '/works/' + W1 + '/fork', { method: 'POST', headers: HB })); ok('撤回后不可 fork', forkAfter.s === 400);
  const imgAfter = await fetch(B + '/works/' + W1 + '/img'); ok('撤回后游客图不可见', imgAfter.status === 404);
  const exp = await j(await fetch(B + '/me/export', { headers: HA })); ok('A 数据导出', exp.s === 200 && Array.isArray(exp.b.works));
  const del = await j(await fetch(B + '/me', { method: 'DELETE', headers: HB })); ok('B 注销删除', del.s === 200 && del.b.deleted === true);
  const w2after = await j(await fetch(B + '/works/' + W2)); ok('注销后作品不可见', w2after.s === 404);
  console.log(`\n${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
})();