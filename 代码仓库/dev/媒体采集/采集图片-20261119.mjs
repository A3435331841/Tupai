// 图片语料采集（暂存）：picsum(Unsplash 授权) + NASA(公有领域) + Pexels CDN(Pexels License)
// 产物只落 .scratch-20261119/图源原始/，分类入库由 分类入库-20261119.mjs 完成。
// 断点续传：每个来源写 progress.json；重复运行跳过已下载文件。
// 用法：node 代码仓库/dev/媒体采集/采集图片-20261119.mjs [--picsum] [--nasa] [--pexels] [--pexels-attempts=2600]
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'); // 仓库根
const STAGE = join(ROOT, '.scratch-20261119', '图源原始');
const SOURCES = ['picsum', 'nasa', 'pexels'];
const args = new Set(process.argv.slice(2));
const selected = SOURCES.filter((s) => args.has(`--${s}`));
const want = (name) => (selected.length ? selected.includes(name) : true);
const numArg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};

const UA = 'TuPaiCorpusHarvester/1.0 (competition demo; contact via repo issues)';
const MAX_EDGE = 2000;

function loadProgress(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; }
}
function saveProgress(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 1));
}
async function fetchWithRetry(url, tries = 3, timeoutMs = 30000) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return res;
      if (res.status === 404 || res.status === 410) return res; // 明确不存在
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    } catch {
      clearTimeout(t);
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  return null;
}

// ---------- picsum ----------
async function picsum() {
  const dir = join(STAGE, 'picsum');
  mkdirSync(dir, { recursive: true });
  const progFile = join(dir, 'progress.json');
  const prog = loadProgress(progFile);
  prog.done = prog.done || {};
  // 1) 全量列表
  let list = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetchWithRetry(`https://picsum.photos/v2/list?page=${page}&limit=100`);
    if (!res || !res.ok) break;
    const arr = await res.json();
    if (!arr.length) break;
    list = list.concat(arr);
  }
  writeFileSync(join(dir, 'picsum-list.json'), JSON.stringify(list, null, 1));
  console.log(`picsum 列表: ${list.length} 条`);
  // 2) 逐张下载，长边压到 MAX_EDGE
  let ok = 0, skip = 0, fail = 0, idx = 0;
  const CONC = numArg('conc', 8);
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= list.length) return;
      const it = list[i];
      const name = `picsum-${String(it.id).padStart(4, '0')}.jpg`;
      const out = join(dir, name);
      if (prog.done[name] && existsSync(out)) { skip++; continue; }
      try {
        const w = Math.min(it.width, MAX_EDGE);
        const h = Math.round((it.height / it.width) * w);
        const res = await fetchWithRetry(`https://picsum.photos/id/${it.id}/${w}/${h}.jpg`);
        if (res && res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 30000) {
            writeFileSync(out, buf);
            prog.done[name] = { bytes: buf.length, author: it.author, unsplash: it.url, w, h };
            ok++;
            if (ok % 25 === 0) { saveProgress(progFile, prog); console.log(`picsum 进度 ok=${ok}/${list.length}`); }
          } else { fail++; }
        } else { fail++; }
      } catch { fail++; }
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  saveProgress(progFile, prog);
  console.log(`picsum 完成: ok=${ok} skip=${skip} fail=${fail}`);
}

// ---------- NASA ----------
const NASA_QUERIES = [
  'nebula', 'galaxy', 'earth from space', 'mars surface', 'international space station',
  'moon surface', 'aurora', 'hurricane from space', 'jupiter', 'saturn rings',
  'milky way', 'solar flare', 'space shuttle launch', 'crater', 'earth horizon',
  'andes mountains from space', 'coral reef from space', 'river delta from space',
  'glacier from space', 'desert from space', 'volcano from space', 'city lights from space',
  'mars rover', 'venus', 'uranus', 'neptune', 'pluto', 'asteroid', 'comet', 'solar eclipse',
  'aircraft', 'wind tunnel', 'mars valley', 'enceladus', 'io volcano', 'titan moon',
];
async function nasa() {
  const dir = join(STAGE, 'nasa');
  mkdirSync(dir, { recursive: true });
  const progFile = join(dir, 'progress.json');
  const prog = loadProgress(progFile);
  prog.done = prog.done || {};
  const items = [];
  for (const q of NASA_QUERIES) {
    const res = await fetchWithRetry(`https://images-api.nasa.gov/search?q=${encodeURIComponent(q)}&media_type=image&page_size=60`);
    if (!res || !res.ok) { console.log('nasa 查询失败:', q); continue; }
    const docs = (await res.json())?.collection?.items || [];
    for (const d of docs) {
      const href = d?.links?.find((l) => l.render === 'image')?.href;
      if (href && d.data?.[0]?.nasa_id) items.push({ nasa_id: d.data[0].nasa_id, title: d.data[0].title, q, thumb: href });
    }
  }
  // 去重
  const seen = new Set();
  const uniq = items.filter((x) => (seen.has(x.nasa_id) ? false : (seen.add(x.nasa_id), true)));
  writeFileSync(join(dir, 'nasa-list.json'), JSON.stringify(uniq, null, 1));
  console.log(`nasa 列表: ${uniq.length} 条`);
  let ok = 0, fail = 0;
  for (const it of uniq) {
    const name = `nasa-${it.nasa_id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60)}.jpg`;
    const out = join(dir, name);
    if (prog.done[name] && existsSync(out)) continue;
    // thumb 是 ~thumb URL；把 ~thumb 换 ~medium 拿中等分辨率
    const url = it.thumb.replace('~thumb', '~medium');
    const res = await fetchWithRetry(url);
    if (res && res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 20000) {
        writeFileSync(out, buf);
        prog.done[name] = { bytes: buf.length, title: it.title, q: it.q, nasa_id: it.nasa_id, source: url };
        ok++;
      } else fail++;
    } else fail++;
    if (ok % 20 === 0 && ok > 0) saveProgress(progFile, prog);
  }
  saveProgress(progFile, prog);
  console.log(`nasa 完成: ok=${ok} fail=${fail}`);
}

// ---------- Pexels CDN 扫号 ----------
async function pexels() {
  const dir = join(STAGE, 'pexels');
  mkdirSync(dir, { recursive: true });
  const progFile = join(dir, 'progress.json');
  const prog = loadProgress(progFile);
  prog.done = prog.done || {};
  prog.tried = prog.tried || [];
  const attempts = numArg('pexels-attempts', 2600);
  let ok = 0, fail = 0;
  for (let i = 0; i < attempts; i++) {
    // 早期热门图集中在 1..3,000,000；伪随机避免与上次重复
    const id = prog.tried.length ? (prog.cursor ?? 1) : 1;
    const photoId = ((id * 1103515245 + 12345) % 3000000) + 1;
    prog.cursor = photoId;
    const name = `pexels-${String(photoId).padStart(7, '0')}.jpg`;
    const out = join(dir, name);
    if (prog.done[name] && existsSync(out)) continue;
    const url = `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=${MAX_EDGE}`;
    const res = await fetchWithRetry(url, 2, 20000);
    if (res && res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 25000) { // 只挡明显占位图；质量交给视觉分类拒收
        writeFileSync(out, buf);
        prog.done[name] = { bytes: buf.length, photoId, source: `https://www.pexels.com/photo/${photoId}/`, license: 'Pexels License' };
        ok++;
      } else fail++;
    } else fail++;
    prog.tried.push(photoId);
    if (prog.tried.length > 20000) prog.tried = prog.tried.slice(-5000);
    if ((ok + fail) % 30 === 0) saveProgress(progFile, prog);
  }
  saveProgress(progFile, prog);
  console.log(`pexels 完成: ok=${ok} fail=${fail}`);
}

const jobs = [];
if (want('picsum')) jobs.push(picsum());
if (want('nasa')) jobs.push(nasa());
if (want('pexels')) jobs.push(pexels());
await Promise.all(jobs);
console.log('采集结束');
