// 用法：node dev/cloud-acceptance.mjs [BASE]
// 默认打云端公网；须在 Secret 同步 + 正式版发布后运行（health.keys_configured=true 为前提）。
// 断言：真实 optimize（无 mock）→ 真实生成（result.mock=false + 私密 content 真图）→ 5 模板封面懒生成回填 → 跨会话隐私 404。
import { randomUUID } from 'node:crypto';

const BASE = (process.argv[2] || process.env.BASE || 'https://tupai-moo3r9zpvox.qoder.zone').replace(/\/$/, '');
const API = `${BASE}/functions/v1/app/api/v1`;
const SID = randomUUID();
const OTHER = randomUUID();
let pass = 0, fail = 0;
const t0 = Date.now();

function ok(cond, name, extra = '') {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra}`); }
}
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);

async function req(method, path, { body, sid = SID, timeout = 60000 } = {}) {
  const headers = { Origin: BASE, 'X-Session-Id': sid };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(API + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return res;
}
const json = (res) => res.json();

console.log(`云端真实出图验收 BASE=${BASE}`);

// 1 health：Key 池已配置
const health = await json(await req('GET', '/health'));
ok(health.ok === true && health.keys_configured === true, 'health keys_configured=true', JSON.stringify(health));
if (!health.keys_configured) {
  console.log('Secret 未同步或正式版未发布，终止。');
  process.exit(1);
}

// 2 optimize：真实候选（无 mock 标记）
const optRes = await req('POST', '/optimize', { body: { text: '夜晚聚餐合影，人脸偏暗发糊，想要温暖日系胶片感', count: 3 } });
const opt = await json(optRes);
ok(optRes.status === 200, 'optimize 200', `status=${optRes.status}`);
ok(opt.mock !== true, 'optimize 非 Mock（真实 Agnes）', JSON.stringify(opt).slice(0, 200));
ok(Array.isArray(opt.candidates) && opt.candidates.length >= 2 && opt.candidates.length <= 4, '候选 2–4 条');
ok(opt.candidates?.every((c) => typeof c.prompt === 'string' && c.prompt.length > 20), '候选 prompt 完整');
ok(opt.mode === 'txt2img', 'mode=txt2img');
console.log(`  … optimize 完成 ${secs()}s`);

// 3 generate：租约执行 → 真实结果图
const genRes = await req('POST', '/jobs/generate', {
  body: {
    prompt: opt.candidates[0].prompt,
    negative_prompt: opt.candidates[0].negative_prompt || '',
    model: 'agnes-image-2.5-flash', ratio: '3:4',
  },
});
const gen = await json(genRes);
ok(genRes.status === 202 && !!gen.job_id, 'generate 202 + job_id', `status=${genRes.status}`);
let job = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  job = await json(await req('GET', `/jobs/${gen.job_id}`, { timeout: 90000 }));
  if (job.status === 'succeeded' || job.status === 'failed') break;
}
ok(job?.status === 'succeeded', 'job succeeded', JSON.stringify(job?.error || job?.status));
ok(job?.result && job.result.mock === false, 'result.mock=false（真实出图）', JSON.stringify(job?.result || null));
const resultUrl = job?.result?.url || '';
const abs = resultUrl.startsWith('http') ? resultUrl : BASE + '/functions/v1/app' + resultUrl;
const imgRes = await fetch(abs, { headers: { 'X-Session-Id': SID, Origin: BASE }, signal: AbortSignal.timeout(60000) });
const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
const mime = imgRes.headers.get('content-type') || '';
ok(imgRes.status === 200 && /^image\/(png|jpeg|webp)/.test(mime) && imgBytes.length > 20000, '结果 content 真图 >20KB', `status=${imgRes.status} mime=${mime} bytes=${imgBytes.length}`);
console.log(`  … generate 完成 ${secs()}s`);

// 4 隐私：跨会话取结果 404
const cross = await fetch(abs, { headers: { 'X-Session-Id': OTHER, Origin: BASE }, signal: AbortSignal.timeout(30000) });
ok(cross.status === 404, '跨会话取结果 404', `status=${cross.status}`);

// 5 封面懒生成：5 模板逐个触发并确认回填
const tpl0 = await json(await req('GET', '/templates'));
const ids = tpl0.templates.map((t) => t.id);
ok(ids.length >= 5, '模板至少 5 个（seed-showcase 会追加技能模板）', `n=${ids.length}`) ;
for (const id of ids.slice(0, 5)) {
  let coverMime = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = await req('GET', `/templates/${id}/cover`, { sid: OTHER, timeout: 90000 });
    coverMime = c.headers.get('content-type') || '';
    await c.arrayBuffer();
    if (!coverMime.includes('svg')) break;
    await new Promise((r) => setTimeout(r, 15000));
  }
  ok(!coverMime.includes('svg'), `封面 ${id} 真实图`, `mime=${coverMime}`);
  const tpl = await json(await req('GET', '/templates'));
  const row = tpl.templates.find((t) => t.id === id);
  // 封面契约（2026-11-24 修订）：cover_url 恒为公开代理 /api/v1/templates/{id}/cover，
  // 回填 cover_asset_id 的可观测结果是匿名（无会话，等价页面 <img src>）也能取到真实图。
  const coverPath = row?.cover_url || `/api/v1/templates/${id}/cover`;
  ok(row?.cover_url === `/api/v1/templates/${id}/cover`, `封面 ${id} cover_url 为公开代理`, row?.cover_url);
  const anonCover = await fetch(`${BASE}/functions/v1/app${coverPath}`, { signal: AbortSignal.timeout(90000) });
  const anonMime = anonCover.headers.get('content-type') || '';
  await anonCover.arrayBuffer();
  ok(anonCover.status === 200 && /^image\//.test(anonMime) && !anonMime.includes('svg'),
    `封面 ${id} 已回填且匿名可读`, `status=${anonCover.status} mime=${anonMime}`);
  console.log(`  … cover ${id} ${secs()}s`);
}

console.log(`\n${pass}/${pass + fail} 通过（${secs()}s）`);
process.exit(fail ? 1 : 0);