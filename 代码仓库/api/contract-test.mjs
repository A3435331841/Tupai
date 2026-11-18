// 图派契约测试（一期）：按 api/openapi.yaml 断言一期端点结构与枚举。
// 二三期端点由 api/contract-test-extended.mjs（本地身份夹具）覆盖。
// 用法: node api/contract-test.mjs [baseUrl]
// 默认打本地 Deno: http://127.0.0.1:8000/functions/v1/app
import { randomUUID } from 'node:crypto';

const BASE = (process.argv[2] || 'http://127.0.0.1:8000/functions/v1/app').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const SID = randomUUID();
const OTHER_SID = randomUUID();
const MODELS = ['agnes-image-2.5-flash', 'agnes-image-2.1-flash'];

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`FAIL  ${name} ${detail}`); }
}

async function req(method, path, { body, session = SID, headers = {}, raw = false } = {}) {
  const h = { 'X-Session-Id': session, Origin: new URL(BASE).origin, ...headers };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${API}${path}`, { method, headers: h, body: payload });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function main() {
  console.log(`契约测试 → ${API}\n会话 ${SID}`);

  // 1. GET /templates
  {
    const r = await req('GET', '/templates');
    check('templates 200', r.status === 200, `got ${r.status}`);
    const list = r.json?.templates;
    check('templates ≥5', Array.isArray(list) && list.length >= 5);
    const t = list?.[0];
    check('template 结构', t && typeof t.id === 'string' && typeof t.title === 'string'
      && typeof t.prompt === 'string' && typeof t.cover_url === 'string' && Array.isArray(t.tags));
    const night = list?.find((x) => x.id === 'night-bright');
    check('template 文生图/变体字段', night && typeof night.sample_prompt === 'string' && Array.isArray(night.variants)
      && night.variants.some((v) => v.id === 'rain-neon' && typeof v.prompt === 'string'));
  }

  // 2. GET /models
  {
    const r = await req('GET', '/models');
    check('models 200', r.status === 200);
    const list = r.json?.models;
    check('models 白名单', Array.isArray(list) && list.length > 0
      && list.every((m) => MODELS.includes(m.id)), JSON.stringify(list));
  }

  // 2b. GET /quota
  {
    const r = await req('GET', '/quota');
    check('quota 200 字段', r.status === 200 && typeof r.json?.remaining === 'number'
      && typeof r.json?.session_limit === 'number' && typeof r.json?.global_limit === 'number',
    JSON.stringify(r.json).slice(0, 120));
  }

  // 3. POST /assets
  let assetId = null;
  {
    const fd = new FormData();
    fd.append('file', new Blob([PNG_1PX], { type: 'image/png' }), 'test.png');
    fd.append('kind', 'original');
    const r = await req('POST', '/assets', { body: fd });
    check('assets 上传 2xx', r.status >= 200 && r.status < 300, `got ${r.status} ${r.text?.slice(0, 120)}`);
    assetId = r.json?.asset_id;
    check('assets 返回 asset_id+preview_url', typeof assetId === 'string' && typeof r.json?.preview_url === 'string');
  }

  // 4. GET /assets/{id}/content（归属 + 跨会话隔离）
  if (assetId) {
    const own = await req('GET', `/assets/${assetId}/content`, { raw: true });
    check('content 本人 200', own.status === 200, `got ${own.status}`);
    check('content image/*', (own.headers.get('content-type') || '').startsWith('image/'));
    const other = await req('GET', `/assets/${assetId}/content`, { session: OTHER_SID, raw: true });
    check('content 跨会话 404', other.status === 404, `got ${other.status}`);
  }

  // 5. POST /optimize（文字入口）
  {
    const r = await req('POST', '/optimize', { body: { text: '雨夜霓虹下的城市人像' } });
    check('optimize 200', r.status === 200, `got ${r.status} ${r.text?.slice(0, 120)}`);
    const c = r.json?.candidates;
    check('candidates 2–4', Array.isArray(c) && c.length >= 2 && c.length <= 4);
    check('candidate 结构+保留句', Array.isArray(c) && c.every((x) => typeof x.prompt === 'string'
      && typeof x.negative_prompt === 'string' && Array.isArray(x.style_tags)
      && /unchanged|保留|Keep any person natural|consistent facial features/i.test(x.prompt)));
    check('candidate 中文摘要', Array.isArray(c) && c.every((x) => typeof x.summary_zh === 'string' && x.summary_zh.length > 0));
    check('recommendations 数组', Array.isArray(r.json?.recommendations));
    check('recommendations 兜底标记', typeof r.json?.recommendations_fallback === 'boolean');
  }

  // 6+7. POST /jobs/generate → GET /jobs/{id} 轮询至终态
  let resultAsset = null;
  {
    const r = await req('POST', '/jobs/generate', {
      body: { prompt: 'contract test prompt, keep the person unchanged', model: MODELS[0], ratio: '3:4' },
    });
    check('generate 202 queued', r.status === 202 && r.json?.status === 'queued', `got ${r.status}`);
    const jobId = r.json?.job_id;
    check('job_id 返回', typeof jobId === 'string');
    if (jobId) {
      let job = null;
      for (let i = 0; i < 45; i++) {
        await new Promise((s) => setTimeout(s, 2000));
        const g = await req('GET', `/jobs/${jobId}`);
        job = g.json;
        if (job?.status === 'succeeded' || job?.status === 'failed') break;
      }
      check('job 终态', job && ['succeeded', 'failed'].includes(job.status), JSON.stringify(job)?.slice(0, 160));
      if (job?.status === 'succeeded') {
        resultAsset = job.result?.asset_id;
        check('result 结构', typeof resultAsset === 'string' && typeof job.result?.url === 'string');
      } else if (job?.status === 'failed') {
        check('failed 带 error', job.error && typeof job.error.code === 'string');
      }
      const other = await req('GET', `/jobs/${jobId}`, { session: OTHER_SID });
      check('job 跨会话 404', other.status === 404, `got ${other.status}`);
    }
  }

  // 8. POST /skills
  let skillId = null;
  const skillBody = {
    format: 'tupai-skill', version: 1, title: '契约测试配方',
    prompt: 'contract test skill prompt, keep the person unchanged',
    negative_prompt: 'blurry', model: MODELS[0], params: { aspect: '3:4', size: '1K' }, style_tags: ['测试'],
  };
  {
    const r = await req('POST', '/skills', { body: skillBody });
    check('skills 保存 2xx', r.status >= 200 && r.status < 300, `got ${r.status}`);
    skillId = r.json?.skill_id || r.json?.id;
    check('skill_id 返回', typeof skillId === 'string');
    const list = await req('GET', '/skills');
    check('skills 列表 200', list.status === 200 && Array.isArray(list.json?.skills));
    check('skills 列表含刚保存配方', list.json?.skills?.some((s) => s.skill_id === skillId && s.prompt === skillBody.prompt));
  }

  // 9. GET /skills/{id}
  if (skillId) {
    const r = await req('GET', `/skills/${skillId}`);
    check('skill JSON 200', r.status === 200);
    const s = r.json?.skill || r.json;
    check('skill format/version', s?.format === 'tupai-skill' && s?.version === 1);
    const other = await req('GET', `/skills/${skillId}`, { session: OTHER_SID });
    check('skill 跨会话 404', other.status === 404, `got ${other.status}`);

    // 10. GET /skills/{id}/skill.md
    const md = await req('GET', `/skills/${skillId}/skill.md`, { raw: true });
    const mdText = await md.text();
    check('skill.md 200', md.status === 200);
    check('skill.md frontmatter', mdText.startsWith('---') && mdText.includes('name:'));
  }

  // 11. POST /skills/import（合法 + 非法 422）
  {
    const ok = await req('POST', '/skills/import', { body: skillBody });
    check('import 合法 2xx', ok.status >= 200 && ok.status < 300, `got ${ok.status}`);
    const bad = await req('POST', '/skills/import', { body: { format: 'wrong', version: 9 } });
    check('import 非法 422', bad.status === 422 && bad.json?.error?.code === 'invalid_input', `got ${bad.status}`);
  }

  // 12. POST /links/parse（非法/不可解析 → 422 parse_failed 降级）
  {
    const r = await req('POST', '/links/parse', { body: { url: 'https://v.douyin.com/example/' } });
    check('links/parse 422', r.status === 422 && r.json?.error?.code === 'parse_failed', `got ${r.status}`);
  }

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error('契约测试异常:', e); process.exit(2); });