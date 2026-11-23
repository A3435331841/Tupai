// 配对质量审核：对每技能 20 组「原图→作品」打分（0-2），输出展示顺序覆盖文件
// 产物：.scratch-20261119/种子排序.json  { skillId: [taskId, ...] }（分数降序；种子驱动读取后决定 pairs 顺序）
// 分数含义：2=明显同源改写（推荐封面）；1=风格化重绘但构图/主体可辨；0=基本无关（排最后）
// 注意：--slots 与 --gate-zero 互斥（slots 只审每技能前 N 组，满足不了门禁 20 对全审完），同传报错退出 2
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH = join(ROOT, '.scratch-20261119');
const DOC = join(ROOT, 'docs', 'references', 'agnes-api.md');
const CN_BASE = 'https://api.agnes-ai.cn/v1';
const INTL_BASE = 'https://apihub.agnes-ai.com/v1';
const PER_KEY_INTERVAL_MS = 20000;
const UA = 'TuPaiPairAudit/1.0';
const OUT = join(SCRATCH, '配对审核.jsonl');

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const FINAL = arg('final', join(SCRATCH, '种子排序.json'));
const CONC = Number(arg('conc', 4));
const LIMIT = Number(arg('limit', 0)); // 0 = 全部
const SLOTS = Number(arg('slots', 0)); // 每技能只审前 N 组（0=全部）；封面取 best-of-N；与 --gate-zero 互斥
const TASKS_FILE = arg('tasks', join(SCRATCH, '生成任务.jsonl'));
const GATE_ZERO = process.argv.includes('--gate-zero'); // 加 --gate-zero 时：0 分对 ≥gate-min-zeros（默认 3）且占比 ≥gate-ratio（默认 30%）判不合格，或存在未审完技能 → 退出 1（个别 0 分只剔除该对）
const GATE_ONLY = process.argv.includes('--gate-only'); // 只算门禁，不调 API、不写排序文件（复用已有配对审核.jsonl）
const GATE_MIN_ZEROS = Number(arg('gate-min-zeros', 3)); // 至少 3 个 0 分对
const GATE_RATIO = Number(arg('gate-ratio', 0.3)); // 且 0 分占比 ≥30% 才判不合格（避免重改造类误杀）
const GATE_OUT = arg('gate-out', join(SCRATCH, '门禁-0分.json'));
if (SLOTS > 0 && GATE_ZERO) {
  console.error('❌ --slots 与 --gate-zero 互斥：slots 只审每技能前 N 组，无法满足门禁的 20 对全审完要求；请去掉 --slots 或改用 --gate-only 配完整评分文件');
  process.exit(2);
}
if (!GATE_ONLY && process.argv.some((x) => x.startsWith('--tasks=')) && !process.argv.some((x) => x.startsWith('--final='))) {
  console.error('❌ 显式指定 --tasks 时必须同时显式传 --final：避免用重跑任务集合覆盖生产 种子排序.json；若只想算门禁请加 --gate-only');
  process.exit(2);
}

function loadKeys() {
  const txt = readFileSync(DOC, 'utf8');
  const rows = [...txt.matchAll(/\|\s*([^|]+)\|\s*`(sk-[A-Za-z0-9_-]{20,})`\s*\|\s*([^|]*站)\s*\|/g)];
  const seen = new Set();
  const keys = [];
  for (const m of rows) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    const intl = /国际/.test(m[3]);
    keys.push({ key: m[2], base: intl ? INTL_BASE : CN_BASE, lastUsed: 0, cooldownUntil: 0, disabled: false });
  }
  return keys;
}
const keys = loadKeys();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _lock = Promise.resolve();
function acquire() {
  // 互斥选取：避免多 worker 同帧选中同一个 key（惊群）
  const run = _lock.then(async () => {
    for (;;) {
      const now = Date.now();
      const ready = keys.filter((k) => !k.disabled && k.cooldownUntil <= now);
      if (ready.length) {
        ready.sort((a, b) => Math.max(a.lastUsed, a.cooldownUntil) - Math.max(b.lastUsed, b.cooldownUntil));
        const k = ready[0];
        const wait = Math.max(0, k.lastUsed + PER_KEY_INTERVAL_MS - now);
        if (wait > 0) await sleep(wait);
        k.lastUsed = Date.now();
        return k;
      }
      await sleep(2000);
    }
  });
  _lock = run.then(() => undefined, () => undefined);
  return run;
}
function release(k, status) {
  if (status === 429) k.cooldownUntil = Date.now() + 60000;
  else if (status === 402) k.cooldownUntil = Date.now() + 3600000;
  else if (status === 401) k.disabled = true;
}

const PROMPT = `两张图：第一张是原图，第二张是 AI 改写后的作品。判断作品是否明显由原图改写而来（主体/构图延续或合理的风格化重绘）。
只输出 JSON：{"score":2|1|0,"reason":"≤20字"}
2=主体与构图明显延续原图；1=能看出借鉴但重绘幅度大；0=与原图基本无关`;

// 读任务与已有结果
const tasks = readFileSync(TASKS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
function resultPath(out) {
  for (const ext of ['.jpg', '.png']) {
    const p = join(SCRATCH, '生成结果', out.replace(/\.png$/i, ext));
    if (existsSync(p) && statSync(p).size > 10000) return p;
  }
  return null;
}

const done = new Map(); // taskId -> {score}；score:null 的失败记录不计入（允许重审补评）
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split('\n')) {
    try { const d = JSON.parse(line); if (d.score != null) done.set(d.id, d); } catch {}
  }
}
let todo = tasks
  .map((t) => ({ ...t, result: resultPath(t.out) }))
  .filter((t) => t.result && !done.has(t.id));
if (SLOTS > 0) {
  const perSkill = new Map();
  for (const t of todo) {
    const sid = t.id.split('--')[0];
    const n = perSkill.get(sid) || 0;
    if (n < SLOTS) perSkill.set(sid, n + 1);
    else t._skip = true;
  }
  todo = todo.filter((t) => !t._skip);
}
console.log(`审核任务 ${tasks.length}，有结果 ${tasks.length - tasks.filter((t) => !resultPath(t.out)).length}，待审 ${todo.length}${LIMIT ? `（限 ${LIMIT}）` : ''}`);
const work = GATE_ONLY ? [] : (LIMIT ? todo.slice(0, LIMIT) : todo);
if (GATE_ONLY) console.log('门禁模式：跳过 API 审核，仅用已有 配对审核.jsonl 计算');

let idx = 0, ok = 0, fail = 0;
const { appendFileSync } = await import('node:fs');
async function worker(wid) {
  for (;;) {
    const i = idx++;
    if (i >= work.length) return;
    const t = work[i];
    try {
      const img = readFileSync(t.image);
      const res = readFileSync(t.result);
      const toB64 = (buf, mime) => `data:${mime};base64,${buf.toString('base64')}`;
      const body = {
        model: 'agnes-3.0-flash',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: toB64(img, t.image.endsWith('.png') ? 'image/png' : 'image/jpeg') } },
            { type: 'image_url', image_url: { url: toB64(res, t.result.endsWith('.png') ? 'image/png' : 'image/jpeg') } },
            { type: 'text', text: PROMPT },
          ],
        }],
        max_tokens: 120,
      };
      let json = null;
      for (let a = 0; a < 3; a++) {
        const k = await acquire();
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        try {
          const r = await fetch(k.base + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json', 'user-agent': UA }, body: JSON.stringify(body), signal: ctrl.signal });
          clearTimeout(to);
          if (r.ok) { json = await r.json(); break; }
          release(k, r.status);
          if (r.status === 429 || r.status === 401 || r.status === 402) { a--; continue; }
        } catch (e) { clearTimeout(to); release(k, 0); await sleep(1500 * (a + 1)); }
      }
      if (!json) throw new Error('api 失败');
      const text = json?.choices?.[0]?.message?.content || '';
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null; // 解析失败不写伪分数，落 score:null 失败记录（重跑补审）
      const rec = parsed
        ? { id: t.id, skill: t.id.split('--')[0], score: Number(parsed.score) || 0, reason: String(parsed.reason || '').slice(0, 30) }
        : { id: t.id, skill: t.id.split('--')[0], score: null, failed: true, reason: '解析失败' };
      appendFileSync(OUT, JSON.stringify(rec) + '\n');
      ok++;
      if (ok % 50 === 0) console.log(`[w${wid}] ok=${ok} fail=${fail}/${idx}`);
    } catch (e) {
      fail++;
      appendFileSync(OUT, JSON.stringify({ id: t.id, skill: t.id.split('--')[0], score: null, failed: true, reason: '审核失败' }) + '\n');
      if (fail % 20 === 0) console.log(`[w${wid}] fail=${fail}: ${e.message.slice(0, 80)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
console.log(`审核完成 ok=${ok} fail=${fail}`);

// 汇总排序
const scores = new Map(done);
for (const line of readFileSync(OUT, 'utf8').split('\n')) {
  try { const d = JSON.parse(line); if (d.score != null) scores.set(d.id, d); } catch {}
}
const bySkill = new Map();
for (const t of tasks) {
  const sid = t.id.split('--')[0];
  if (!bySkill.has(sid)) bySkill.set(sid, []);
  bySkill.get(sid).push({ id: t.id, score: scores.get(t.id)?.score ?? 1, result: Boolean(resultPath(t.out)) });
}
const order = {};
const dist = { 0: 0, 1: 0, 2: 0 };
for (const [sid, list] of bySkill) {
  const complete = list.filter((x) => x.result);
  if (complete.length < 20) continue; // 未完成技能跳过（重跑会补）
  complete.sort((a, b) => b.score - a.score);
  order[sid] = complete.map((x) => x.id);
  for (const x of complete) dist[x.score] = (dist[x.score] || 0) + 1;
}
if (GATE_ONLY) {
  console.log('门禁模式：不写排序文件（--final 忽略）；分数分布:', JSON.stringify(dist));
} else {
  writeFileSync(FINAL, JSON.stringify({ 说明: '每技能展示顺序（分数降序，封面取最高分对）', 技能数: Object.keys(order).length, 分数分布: dist, 顺序: order }, null, 1));
  console.log(`排序覆盖 ${Object.keys(order).length} 技能；分数分布:`, JSON.stringify(dist));
}

// ---------- 0 分门禁 ----------
// 依据 2026-11-22 检查：Agnes 0 分对经人工抽查确认「主体与构图完全无关」，可信。
// 门禁规则：0 分对 ≥3 且占比 ≥30% → 该技能画册不可用，需换匹配输入重跑（个别 0 分只剔除该对；禁止靠排序把 0 分藏到末尾）。
const gate = { 说明: `画册 0 分门禁：须 20 对全部审完；0 分对 ≥${GATE_MIN_ZEROS} 且占比 ≥${Math.round(GATE_RATIO * 100)}% 判不合格（个别 0 分只剔除该对，不废整个技能）`, 更新: '2026-11-22', 不合格: [], 未审完: [], 合格数: 0, 不合格数: 0, 未审完数: 0 };
for (const [sid, list] of bySkill) {
  const complete = list.filter((x) => x.result);
  const scored = complete.filter((x) => scores.get(x.id)?.score !== undefined);
  if (complete.length < 20 || scored.length < 20) {
    gate.未审完.push({ skill: sid, 有结果: complete.length, 已评分: scored.length });
    continue;
  }
  const zeros = scored.filter((x) => x.score === 0);
  const ratio = zeros.length / scored.length;
  if (zeros.length >= GATE_MIN_ZEROS && ratio >= GATE_RATIO) {
    gate.不合格.push({ skill: sid, "0分对数": zeros.length, "总对数": scored.length, "0分占比": Number(ratio.toFixed(2)), "0分任务": zeros.map((x) => x.id) });
  } else gate.合格数++;
}
gate.不合格数 = gate.不合格.length;
gate.未审完数 = gate.未审完.length;
writeFileSync(GATE_OUT, JSON.stringify(gate, null, 1));
console.log(`0 分门禁：合格 ${gate.合格数}，不合格 ${gate.不合格数}，未审完 ${gate.未审完数} → ${GATE_OUT}`);
if (GATE_ZERO && (gate.不合格数 > 0 || gate.未审完数 > 0)) {
  console.error('❌ 0 分门禁未通过：存在主体无关配对或审核未完成，禁止发布');
  process.exit(1);
}
