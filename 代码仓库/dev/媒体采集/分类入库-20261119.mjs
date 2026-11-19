// 把 .scratch-20261119/图源原始/ 中通过视觉分类的图片入库到 资产仓库/40-图片资产/真实授权/<分类>/
// 输入：.scratch-20261119/分类结果.jsonl（agnes-批量.mjs classify 的输出）
// 输出：资产仓库/40-图片资产/真实授权/<分类>/<分类>-NNN-<来源id>.jpg + 每分类 清单.json + 汇总 90-元数据/技能演示图片清单.json
// 规则：sha256 与既有资产总清单查重，命中即跳过（禁止重复资产）；来源/协议逐条记录。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH = join(ROOT, '.scratch-20261119');
const ASSET_ROOT = join(ROOT, '资产仓库');
const OUT_BASE = join(ASSET_ROOT, '40-图片资产', '真实授权');
const META_DIR = join(ASSET_ROOT, '90-元数据');

const CAT_DIRS = {
  '自然风光': '10-自然风光', '城市街景': '20-城市街景', '人像人物': '30-人像人物', '动物宠物': '40-动物宠物',
  '植物花卉': '50-植物花卉', '美食静物': '60-美食静物', '建筑空间': '70-建筑空间', '艺术画作': '80-艺术画作',
  '天文太空': '90-天文太空', '交通机械': '95-交通机械',
};
const LICENSE_BY_SOURCE = {
  picsum: { license: 'Unsplash License（via picsum.photos）', source: 'https://picsum.photos' },
  nasa: { license: 'NASA 公有领域', source: 'https://images-api.nasa.gov' },
  pexels: { license: 'Pexels License', source: 'https://www.pexels.com' },
};

function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

// 既有清单 sha 集合（查重）
const existingShas = new Set();
try {
  const total = JSON.parse(readFileSync(join(META_DIR, '资产总清单.json'), 'utf8'));
  const arr = Array.isArray(total) ? total : (total.assets || total.资产 || []);
  for (const it of arr) if (it.sha256) existingShas.add(it.sha256);
  console.log(`既有清单 ${arr.length} 条，载入 sha ${existingShas.size} 个`);
} catch (e) { console.log('资产总清单.json 读取失败（继续，跳过查重）:', e.message); }

// 分类结果
const results = readFileSync(join(SCRATCH, '分类结果.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
console.log(`分类结果 ${results.length} 条`);
const usable = results.filter((r) => r.usable === true && CAT_DIRS[r.category]);
console.log(`可用 ${usable.length} 条，分类分布:`, JSON.stringify(usable.reduce((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {}), null, 0));

const manifest = [];
const counters = {};
let copied = 0, skippedDup = 0, skippedMissing = 0;

for (const r of usable) {
  const src = join(ROOT, r.rel || r.file);
  if (!existsSync(src)) { skippedMissing++; continue; }
  const buf = readFileSync(src);
  const hash = sha256(buf);
  if (existingShas.has(hash)) { skippedDup++; continue; }
  const catDir = join(OUT_BASE, CAT_DIRS[r.category]);
  mkdirSync(catDir, { recursive: true });
  counters[r.category] = (counters[r.category] || 0) + 1;
  const stem = basename(r.file, extname(r.file));
  const ext = extname(r.file) === '.png' ? '.png' : '.jpg';
  const outName = `${r.category}-${String(counters[r.category]).padStart(3, '0')}-${stem}${ext}`;
  const outPath = join(catDir, outName);
  copyFileSync(src, outPath);
  existingShas.add(hash);
  const srcKey = stem.split('-')[0];
  const lic = LICENSE_BY_SOURCE[srcKey] || { license: '未知', source: '' };
  manifest.push({
    id: `corpus-${stem}`,
    名称: outName,
    类型: '图片',
    路径: outPath.slice(ROOT.length + 1).replaceAll('\\', '/'),
    状态: 'approved',
    来源: lic.source,
    协议: lic.license,
    sha256: hash,
    字节: buf.length,
    分类: r.category,
    标签: r.tags || [],
    决策: '新增-技能演示原图语料',
    视觉备注: (r.note || '').slice(0, 80),
  });
  copied++;
}

// 每分类 清单.json
for (const [cat, dirName] of Object.entries(CAT_DIRS)) {
  const items = manifest.filter((m) => m.分类 === cat);
  if (!items.length) continue;
  writeFileSync(join(OUT_BASE, dirName, '清单.json'), JSON.stringify({ 分类: cat, 数量: items.length, 资产: items }, null, 1));
}

// 汇总到 90-元数据
mkdirSync(META_DIR, { recursive: true });
const outFile = join(META_DIR, '技能演示图片清单.json');
let prev = { 资产: [] };
if (existsSync(outFile)) { try { prev = JSON.parse(readFileSync(outFile, 'utf8')); } catch {} }
const merged = [...(prev.资产 || []), ...manifest];
writeFileSync(outFile, JSON.stringify({ 说明: '技能演示原图语料（公开授权图片，分类保存）', 更新: new Date().toISOString().slice(0, 10), 总数: merged.length, 资产: merged }, null, 1));
console.log(`入库完成: 复制 ${copied}，跳过重复 ${skippedDup}，源缺失 ${skippedMissing}；清单 ${outFile}`);
