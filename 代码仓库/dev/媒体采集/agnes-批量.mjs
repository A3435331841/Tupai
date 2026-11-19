// Agnes 批量工具：Key 池 + 限速 + 视觉分类 + 图生图批量生成（断点续传）
// Key 从 docs/references/agnes-api.md 提取（该文件 gitignore，绝不入库、绝不打印明文）。
// 用法：
//   node agnes-批量.mjs classify  --work=分类任务.json
//   node agnes-批量.mjs generate  --work=生成任务.jsonl
// 工作文件与状态文件均放 .scratch-20261119/ 下。
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH = join(ROOT, '.scratch-20261119');
const DOC = join(ROOT, 'docs', 'references', 'agnes-api.md');
const CN_BASE = 'https://api.agnes-ai.cn/v1';
const INTL_BASE = 'https://apihub.agnes-ai.com/v1';
const UA = 'TuPaiBatchTool/1.0';
const PER_KEY_INTERVAL_MS = 10000; // 实测单 key 短窗口 2-3 次即 429，保守 10s 间隔
const REQ_TIMEOUT_MS = 75000;

const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};

function maskKey(k) { return `${k.slice(0, 6)}…${k.slice(-4)}`; }

function loadKeys() {
  const txt = readFileSync(DOC, 'utf8');
  // 按文档表格行提取（key 与可用站点严格配对；401 大多因打错站点）
  const rows = [...txt.matchAll(/\|\s*([^|]+)\|\s*`(sk-[A-Za-z0-9_-]{20,})`\s*\|\s*([^|]*站)\s*\|/g)];
  const seen = new Set();
  const keys = [];
  for (const m of rows) {
    const key = m[2];
    if (seen.has(key)) continue;
    seen.add(key);
    const intl = /国际/.test(m[3]);
    keys.push({ i: keys.length, key, site: intl ? 'intl' : 'cn', base: intl ? INTL_BASE : CN_BASE, lastUsed: 0, cooldownUntil: 0, disabled: false, ok: 0, fail: 0 });
  }
  if (!keys.length) throw new Error('未在 agnes-api.md 中找到 key 表');
  console.log(`载入 key ${keys.length} 个（CN ${keys.filter((k) => k.site === 'cn').length} / INTL ${keys.filter((k) => k.site === 'intl').length}）: ${keys.map((k) => `${maskKey(k.key)}@${k.site}`).join(', ')}`);
  return keys;
}

class Pool {
  constructor(keys) { this.keys = keys; }
  healthy() { return this.keys.filter((k) => !k.disabled); }
  async acquire() {
    // 轮询等待可用 key（全部冷却/间隔不足时 sleep）
    for (;;) {
      const now = Date.now();
      const ready = this.keys.filter((k) => !k.disabled && k.cooldownUntil <= now);
      if (ready.length) {
        ready.sort((a, b) => Math.max(a.lastUsed, a.cooldownUntil) - Math.max(b.lastUsed, b.cooldownUntil));
        const k = ready[0];
        const wait = Math.max(0, k.lastUsed + PER_KEY_INTERVAL_MS - now);
        if (wait > 0) await sleep(wait);
        k.lastUsed = Date.now();
        return k;
      }
      await sleep(3000);
    }
  }
  release(k, status) {
    if (status === 429) k.cooldownUntil = Date.now() + 60000;
    else if (status === 402) k.cooldownUntil = Date.now() + 3600000;
    else if (status === 401) { k.disabled = true; console.log(`key ${maskKey(k.key)} 401 永久禁用`); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(urlPath, body, tries = 4) {
  const keys = globalThis.__pool;
  let lastStatus = 0, lastErr = '';
  for (let i = 0; i < tries; i++) {
    const k = await keys.acquire();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
    try {
      const res = await fetch(k.base + urlPath, {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json', 'user-agent': UA },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (res.ok) { k.ok++; return { json: await res.json(), key: k }; }
      lastStatus = res.status;
      const txt = await res.text().catch(() => '');
      lastErr = txt.slice(0, 200);
      keys.release(k, res.status);
      if (res.status === 429 || res.status === 402 || res.status === 401) { i--; continue; } // 换 key 重试（不计次数）
      // 其他状态码：短暂等待重试
      await sleep(2000 * (i + 1));
    } catch (e) {
      clearTimeout(t);
      lastErr = `network:${e.message}`;
      keys.release(k, 0);
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error(`API 失败 status=${lastStatus} err=${lastErr}`);
}

function toDataUrl(buf, mime = 'image/jpeg') {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ---------- 视觉分类 ----------
const CATEGORIES = ['自然风光', '城市街景', '人像人物', '动物宠物', '植物花卉', '美食静物', '建筑空间', '艺术画作', '天文太空', '交通机械', '其他'];
const CLASSIFY_PROMPT = `你是图库分类助手。看这张图，输出严格 JSON（不要多余文字）：
{"category":"从[${CATEGORIES.join(',')}]中选一个","usable":true或false,"tags":["中文标签2-4个"],"note":"简短说明或拒收原因"}
usable=false 的情况：截图/文字截图/拼贴表情包/纯文字/水印明显/模糊低质/色情暴力。`;

async function classify() {
  const work = JSON.parse(readFileSync(arg('work'), 'utf8')); // [{file, rel}]
  const outFile = arg('out', join(SCRATCH, '分类结果.jsonl'));
  const done = new Set();
  if (existsSync(outFile)) {
    const last = new Map();
    for (const line of readFileSync(outFile, 'utf8').split('\n')) {
      try { const d = JSON.parse(line); last.set(d.file, d); } catch {}
    }
    for (const [file, d] of last) if (d.usable !== undefined && !String(d.note || '').startsWith('调用失败')) done.add(file);
  }
  console.log(`分类任务 ${work.length} 项，已完成 ${done.size}`);
  const CONC = Number(arg('conc', Math.min(8, globalThis.__keys.length)));
  let idx = 0, ok = 0, fail = 0;
  async function worker(wid) {
    for (;;) {
      const i = idx++;
      if (i >= work.length) return;
      const item = work[i];
      if (done.has(item.file)) continue;
      try {
        const buf = readFileSync(item.file);
        if (buf.length > 6 * 1024 * 1024) throw new Error('文件过大');
        const dataUrl = toDataUrl(buf, item.mime || 'image/jpeg');
        const { json } = await apiFetch('/chat/completions', {
          model: 'agnes-3.0-flash',
          messages: [
            { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl } }, { type: 'text', text: CLASSIFY_PROMPT }] },
          ],
          max_tokens: 300,
        });
        const text = json?.choices?.[0]?.message?.content || '';
        const m = text.match(/\{[\s\S]*\}/);
        const parsed = m ? JSON.parse(m[0]) : { category: '其他', usable: false, tags: [], note: '解析失败' };
        appendFileSync(outFile, JSON.stringify({ file: item.file, rel: item.rel, ...parsed }) + '\n');
        ok++;
        if (ok % 20 === 0) console.log(`[worker${wid}] 进度 ok=${ok} fail=${fail}/${idx}`);
      } catch (e) {
        fail++;
        appendFileSync(outFile, JSON.stringify({ file: item.file, rel: item.rel, category: '其他', usable: false, tags: [], note: '调用失败:' + e.message.slice(0, 120) }) + '\n');
        if (fail % 10 === 0) console.log(`[worker${wid}] 失败累计 ${fail}: ${e.message.slice(0, 100)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
  console.log(`分类完成 ok=${ok} fail=${fail}`);
}

// ---------- 图生图批量 ----------
async function generate() {
  const workFile = arg('work');
  const lines = readFileSync(workFile, 'utf8').split('\n').filter((l) => l.trim());
  const tasks = lines.map((l) => JSON.parse(l)); // {id, out, image, prompt, negative, ratio, model}
  const stateFile = workFile.replace(/\.(jsonl|json)$/, '') + '.状态.json';
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { done: {}, failed: {} };
  const todo = tasks.filter((t) => !state.done[t.id]);
  console.log(`生成任务 ${tasks.length} 项，待做 ${todo.length}（已完成 ${Object.keys(state.done).length}）`);
  mkdirSync(join(SCRATCH, '生成结果'), { recursive: true });
  const CONC = Number(arg('conc', Math.min(10, globalThis.__keys.length)));
  let idx = 0, ok = 0, fail = 0;
  const saveState = (() => { let last = 0; return (force) => { const now = Date.now(); if (force || now - last > 15000) { writeFileSync(stateFile, JSON.stringify(state)); last = now; } }; })();
  async function worker(wid) {
    for (;;) {
      const i = idx++;
      if (i >= todo.length) return;
      const t = todo[i];
      const outFile = join(SCRATCH, '生成结果', t.out);
      mkdirSync(dirname(outFile), { recursive: true });
      if (existsSync(outFile) && statSize(outFile) > 10000) { state.done[t.id] = { out: t.out, cached: true }; saveState(); continue; }
      try {
        const buf = readFileSync(t.image);
        const body = {
          model: t.model || 'agnes-image-2.5-flash',
          prompt: t.prompt,
          size: t.size || '1K',
          ratio: t.ratio || '1:1',
          extra_body: { response_format: 'url', image: [toDataUrl(buf)] },
        };
        if (t.negative) body.negative_prompt = t.negative;
        const { json } = await apiFetch('/images/generations', body);
        const url = json?.data?.[0]?.url;
        if (!url) throw new Error('无结果 url');
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 60000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error(`结果下载 ${res.status}`);
        const img = Buffer.from(await res.arrayBuffer());
        if (img.length < 10000) throw new Error('结果过小');
        writeFileSync(outFile, img);
        state.done[t.id] = { out: t.out, bytes: img.length, task_id: json.task_id };
        ok++;
        if (ok % 10 === 0) { saveState(); console.log(`[worker${wid}] ok=${ok} fail=${fail}/${idx}`); }
      } catch (e) {
        fail++;
        state.failed[t.id] = (state.failed[t.id] || 0) + 1;
        console.log(`[worker${wid}] 失败 ${t.id}: ${e.message.slice(0, 140)}`);
        // 全部 key 不可用等严重情况不退出，继续下一个任务
      }
      saveState();
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
  saveState(true);
  console.log(`生成完成 ok=${ok} fail=${fail}；状态文件 ${stateFile}`);
  if (fail > 0) console.log(`提示：重跑同命令可自动跳过已完成项并重试失败项`);
}

function statSize(p) { try { return statSync(p).size; } catch { return 0; } }

// ---------- main ----------
const cmd = process.argv[2];
const keys = loadKeys();
globalThis.__keys = keys;
globalThis.__pool = new Pool(keys);
if (cmd === 'classify') await classify();
else if (cmd === 'generate') await generate();
else { console.log('未知命令；用法: classify | generate'); process.exit(1); }
