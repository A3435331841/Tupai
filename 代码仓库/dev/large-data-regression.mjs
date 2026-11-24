import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { application } from '../server/routes.mjs';
import { fakeDb, fakeStorage } from './fakes.mjs';

const OWNER = 'u:large-user';
const MAIN_WORK = 'wk_' + '1'.repeat(24);
const TASK = 'tk_' + '2'.repeat(24);
const COUNT = 1205;
const hex = (n) => n.toString(16).padStart(24, '0');
const now = new Date().toISOString();
const db = fakeDb();
const storage = fakeStorage();
const env = { get: (key) => key === 'MAINTENANCE_TOKEN' ? 'large-data-token' : undefined };
const handle = application({ db, storage, env, fetchImpl: fetch });
const context = Buffer.from(JSON.stringify({
  user_id: 'large-user', site_id: 'site-1', host_id: 'host-1', name: '大数据用户',
  picture: '', session_expires_at: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64url');
const auth = { 'x-qoder-user-context': context, 'X-Session-Id': randomUUID() };

const assets = Array.from({ length: COUNT }, (_, i) => ({
  id: 'a_' + hex(i), owner_session: OWNER, kind: 'original', storage_key: `assets/a_${hex(i)}`,
  visibility: 'private', content_type: 'image/png', bytes: 1, width: 1, height: 1,
  tags: [], source: 'large-data-test', created_at: now,
}));
const works = Array.from({ length: COUNT }, (_, i) => ({
  id: i === 0 ? MAIN_WORK : 'wk_' + hex(i + 10), owner_session: OWNER,
  result_asset_id: assets[i].id, skill_snapshot: { prompt: 'test', model: 'agnes-image-2.5-flash', ratio: '1:1' },
  title: i === 0 ? '主作品' : `作品 ${i}`, tags: [], status: 'published', allow_fork: true,
  depth: 0, created_at: i === 0 ? now : new Date(Date.now() - COUNT - i).toISOString(),
}));
async function insertRows(table, items) {
  for (const item of items) assert.equal((await db.from(table).insert(item)).error, null);
}
await insertRows('assets', assets);
await insertRows('works', works);
await insertRows('likes', [
  ...Array.from({ length: COUNT }, (_, i) => ({
    id: 'lk_' + hex(i), work_id: works[i].id, owner_session: OWNER, created_at: now,
  })),
  ...Array.from({ length: COUNT - 1 }, (_, i) => ({
    id: 'lk_' + hex(i + COUNT), work_id: MAIN_WORK, owner_session: `u:liker-${i}`, created_at: now,
  })),
]);
await insertRows('comments', Array.from({ length: COUNT }, (_, i) => ({
  id: 'cm_' + hex(i), work_id: MAIN_WORK, owner_session: OWNER, body: `评论 ${i}`,
  hidden_by_author: false, created_at: now,
})));
await insertRows('notifications', Array.from({ length: COUNT }, (_, i) => ({
  id: 'nt_' + hex(i), owner_session: OWNER, kind: 'test', work_id: MAIN_WORK, read: false, created_at: now,
})));
await db.from('tasks').insert({ id: TASK, owner_session: OWNER, theme: '大数据任务', status: 'open', created_at: now });
await insertRows('submissions', Array.from({ length: COUNT }, (_, i) => ({
  id: 'sb_' + hex(i), task_id: TASK, work_id: works[i].id, owner_session: OWNER, created_at: now,
})));

async function request(path, { method = 'GET', headers = {} } = {}) {
  const response = await handle({
    request: new Request(`http://local/functions/v1/app${path}`, { method, headers }), requestId: randomUUID(),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

const inspiration = await request('/api/v1/inspiration/skills');
assert.equal(inspiration.status, 200, JSON.stringify(inspiration.body));
assert.equal(inspiration.body.skills.length, 266);
const skillDetail = await request('/api/v1/showcase/skills/anime-angel-garden');
assert.equal(skillDetail.status, 200, JSON.stringify(skillDetail.body));
assert.equal(skillDetail.body.pairs.length, 0);
const skillTemplate = await request('/api/v1/templates/anime-angel-garden');
assert.equal(skillTemplate.status, 200, JSON.stringify(skillTemplate.body));
assert.equal(skillTemplate.body.template.id, 'anime-angel-garden');
console.log('  ok  官方技能与模板自动幂等补齐');

const exported = await request('/api/v1/me/export', { headers: auth });
assert.equal(exported.status, 200, JSON.stringify(exported.body));
assert.equal(exported.body.assets.length, COUNT);
assert.equal(exported.body.works.length, COUNT);
assert.equal(exported.body.likes.length, COUNT);
assert.equal(exported.body.comments.length, COUNT);
assert.equal(exported.body.submissions.length, COUNT);
assert.equal(exported.body.notifications.length, COUNT);
console.log('  ok  千行数据导出完整返回');

const feed = await request('/api/v1/feed?sort=new&limit=1');
assert.equal(feed.status, 200, JSON.stringify(feed.body));
assert.equal(feed.body.works[0].id, MAIN_WORK);
assert.equal(feed.body.works[0].like_count, COUNT);
assert.equal(feed.body.works[0].comment_count, COUNT);
console.log('  ok  社区批量统计超过 1000 行');

const tasks = await request('/api/v1/tasks');
assert.equal(tasks.status, 200, JSON.stringify(tasks.body));
assert.equal(tasks.body.tasks.find((t) => t.id === TASK)?.submission_count, COUNT);
console.log('  ok  任务投稿统计超过 1000 行');

const recomputed = await request('/api/v1/maintenance/recompute-hot', {
  method: 'POST', headers: { 'x-maintenance-token': 'large-data-token' },
});
assert.equal(recomputed.status, 200, JSON.stringify(recomputed.body));
assert.equal(recomputed.body.computed, 200);
const hot = await request('/api/v1/hot?period=7d&limit=5');
assert.equal(hot.status, 200, JSON.stringify(hot.body));
assert.equal(hot.body.works[0]?.id, MAIN_WORK);
console.log('  ok  热榜重算超过 1000 行');

const removed = await request('/api/v1/me', { method: 'DELETE', headers: auth });
assert.equal(removed.status, 200, JSON.stringify(removed.body));
assert.equal(removed.body.deleted, true);
console.log('  ok  千行资产注销清理');
console.log('\n大数据与技能种子回归 8/8 通过');
