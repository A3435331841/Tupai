// 本地故障注入测试：429/402 冷却、401 禁用、多 key 轮换、Mock 兜底、非法导入 422。
// 运行：node dev/failpath-test.mjs（不触网，fetchImpl 全部为注入桩；key 为占位假值）
import { randomUUID } from 'node:crypto';
import { application } from '../server/routes.mjs';
import { fakeDb, fakeStorage } from './fakes.mjs';

const SID = randomUUID();

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
}

const FAKE_KEYS = (n) => Array.from({ length: n }, (_, i) => ({ alias: `t${i + 1}`, key: `sk-failpath-placeholder-${i + 1}` }));

function makeApp({ status, keyCount = 1 }) {
  const db = fakeDb();
  let calls = 0;
  const env = { get: (name) => (name === 'AGNES_KEYS_CN' ? JSON.stringify(FAKE_KEYS(keyCount)) : undefined) };
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: 'injected' } }), { status });
  };
  const handle = application({ db, storage: fakeStorage(), env, fetchImpl });
  const call = async (method, path, body) => {
    const res = await handle({
      request: new Request('http://local.test/functions/v1/app' + path, {
        method,
        headers: { 'content-type': 'application/json', 'X-Session-Id': SID, Origin: 'http://local.test' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      requestId: 'failpath',
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  };
  const keyState = async (alias) => {
    const r = await db.from('key_state').select('*').eq('alias', alias);
    return r.data?.[0] || null;
  };
  return { call, calls: () => calls, keyState, db };
}

const cooldownSeconds = (s) => (s?.cooldown_until ? (new Date(s.cooldown_until).getTime() - Date.now()) / 1000 : -1);

console.log('场景 1：单 key 429 → 冷却 60s + Mock 兜底');
{
  const app = makeApp({ status: 429 });
  const r1 = await app.call('POST', '/api/v1/optimize', { text: '故障注入测试' });
  check('optimize 200', r1.status === 200, `got ${r1.status}`);
  check('mock 标记 + 候选兜底', r1.json?.mock === true && r1.json?.candidates?.length >= 2);
  check('仅调用上游 1 次（冷却后 acquire 为空）', app.calls() === 1, `calls=${app.calls()}`);
  const s = await app.keyState('t1');
  const cd = s ? cooldownSeconds(s) : -1;
  check('cooldown_until ≈ +60s', cd > 50 && cd <= 60, `cd=${cd}`);
  const r2 = await app.call('POST', '/api/v1/optimize', { text: '第二次' });
  check('冷却期内二次请求仍 Mock 且不再触网', r2.json?.mock === true && app.calls() === 1);
}

console.log('场景 2：双 key 429 → 轮换后全池冷却');
{
  const app = makeApp({ status: 429, keyCount: 2 });
  const r = await app.call('POST', '/api/v1/optimize', { text: '轮换测试' });
  check('mock 兜底', r.json?.mock === true);
  check('两个 key 各试 1 次', app.calls() === 2, `calls=${app.calls()}`);
  const s1 = await app.keyState('t1'), s2 = await app.keyState('t2');
  check('两 key 均进入冷却', s1?.cooldown_until && s2?.cooldown_until);
}

console.log('场景 3：402 → 冷却 1h');
{
  const app = makeApp({ status: 402 });
  const r = await app.call('POST', '/api/v1/optimize', { text: '额度测试' });
  check('mock 兜底', r.json?.mock === true);
  const cd = cooldownSeconds(await app.keyState('t1'));
  check('cooldown_until ≈ +3600s', cd > 3500 && cd <= 3600, `cd=${cd}`);
}

console.log('场景 4：401 → 永久禁用不盲重试');
{
  const app = makeApp({ status: 401 });
  const r1 = await app.call('POST', '/api/v1/optimize', { text: '失效测试' });
  check('mock 兜底', r1.json?.mock === true);
  check('disabled = true', (await app.keyState('t1'))?.disabled === true);
  await app.call('POST', '/api/v1/optimize', { text: '再次' });
  check('禁用后不再触网', app.calls() === 1, `calls=${app.calls()}`);
}

console.log('场景 5：生成链路 429 → Job 租约执行 + Mock 结果');
{
  const app = makeApp({ status: 429 });
  const post = await app.call('POST', '/api/v1/jobs/generate', { prompt: '故障注入生成测试' });
  check('POST 202 queued', post.status === 202 && post.json?.status === 'queued', `got ${post.status}`);
  const get = await app.call('GET', `/api/v1/jobs/${post.json.job_id}`);
  check('GET 终态 succeeded + mock', get.json?.status === 'succeeded' && get.json?.result?.mock === true, JSON.stringify(get.json)?.slice(0, 120));
  check('result.asset_id 存在', typeof get.json?.result?.asset_id === 'string' && get.json.result.asset_id.length > 0);
}

console.log('场景 6：非法 Skills 导入 422');
{
  const app = makeApp({ status: 429 });
  const bad = await app.call('POST', '/api/v1/skills/import', { format: 'wrong', version: 9 });
  check('422 + invalid_input', bad.status === 422 && bad.json?.error?.code === 'invalid_input', `got ${bad.status}`);
}

console.log('场景 7：租约过期且重试耗尽 → failed + 超时文案');
{
  const app = makeApp({ status: 429 });
  const id = 'j_' + 'a'.repeat(24);
  await app.db.from('jobs').insert({
    id, owner_session: SID, status: 'running', prompt: '超时回收测试',
    model: 'agnes-image-2.5-flash', ratio: '3:4', attempts: 3, mock: false,
    lease_expires: new Date(Date.now() - 1000).toISOString(), created_at: new Date().toISOString(),
  });
  const get = await app.call('GET', `/api/v1/jobs/${id}`);
  check('failed 终态', get.json?.status === 'failed', JSON.stringify(get.json)?.slice(0, 120));
  check('超时文案', get.json?.error?.code === 'provider_busy' && get.json?.error?.message === '生成多次超时，请稍后重试');
  check('不再触网重试', app.calls() === 0, `calls=${app.calls()}`);
}

console.log(`\n${passed}/${passed + failed} 通过`);
process.exit(failed ? 1 : 0);