// 构建批量图生图任务清单：技能 × 原图 → .scratch-20261119/生成任务.jsonl
// 输入：--skills=技能总表.json --corpus=技能演示图片清单.json [--per-skill=20] [--only=id1,id2]
// 每技能按优先类目轮转选原图；任务 id 稳定（skill--NN），配合 agnes-批量.mjs generate 断点续传。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};

const skillsFile = arg('skills');
const corpusFile = arg('corpus', join(ROOT, '资产仓库', '90-元数据', '技能演示图片清单.json'));
const perSkill = Number(arg('per-skill', 20));
const only = arg('only') ? new Set(arg('only').split(',')) : null;

const skillsDoc = JSON.parse(readFileSync(skillsFile, 'utf8'));
const skills = skillsDoc.技能 || skillsDoc.skills || skillsDoc;
const corpus = JSON.parse(readFileSync(corpusFile, 'utf8')).资产;

// 按分类分组（相对路径 → 绝对路径）
const byCat = {};
for (const a of corpus) {
  const cat = a.分类;
  (byCat[cat] ||= []).join('');
  (byCat[cat] ||= []).push(join(ROOT, a.路径));
}

const PREF = {
  '人像美化': ['人像人物'], '人像风格': ['人像人物'], '老照片修复': ['人像人物', '城市街景', '艺术画作'],
  '胶片质感': ['人像人物', '自然风光', '城市街景', '美食静物'],
  '城市夜景': ['城市街景', '建筑空间'], '旅行风光': ['自然风光', '建筑空间', '交通机械'],
  '插画动漫': ['艺术画作', '自然风光', '建筑空间'], '艺术画作': ['艺术画作', '自然风光', '建筑空间'],
  '复古年代': ['人像人物', '城市街景', '自然风光'], '商品静物': ['美食静物', '植物花卉', '交通机械', '建筑空间'],
  '美食饮品': ['美食静物', '植物花卉'], '趣味玩具化': ['动物宠物', '人像人物', '美食静物'],
  '创意合成': [], '特效光影': [],
};
const ALL_CATS = Object.keys(byCat);

function pickOriginals(cat, n, salt) {
  const pref = PREF[cat] || [];
  const pools = (pref.length ? pref : ALL_CATS).filter((c) => byCat[c]?.length);
  const picked = [];
  let i = 0;
  // 先按类目轮转，池空则全局轮转
  while (picked.length < n && pools.length) {
    const catName = pools[i % pools.length];
    const pool = byCat[catName];
    const candidate = pool[(Math.floor(i / pools.length) + salt) % pool.length];
    if (!picked.includes(candidate)) picked.push(candidate);
    i++;
    if (i > n * 12) break; // 池太小防死循环
  }
  const flat = ALL_CATS.flatMap((c) => byCat[c]);
  let g = salt;
  while (picked.length < n && flat.length) {
    const candidate = flat[g++ % flat.length];
    if (!picked.includes(candidate)) picked.push(candidate);
    if (g > flat.length * 2) break;
  }
  return picked;
}

const tasks = [];
let saltBase = 0;
for (const s of skills) {
  if (only && !only.has(s.id)) continue;
  const picked = pickOriginals(s.category, perSkill, saltBase++);
  picked.forEach((img, i) => {
    tasks.push({
      id: `${s.id}--${String(i).padStart(2, '0')}`,
      out: `${s.id}/作品-${String(i + 1).padStart(2, '0')}.png`,
      image: img,
      prompt: s.prompt,
      negative: s.negative_prompt || 'watermark, text, low quality, blurry',
      ratio: s.ratio || '3:4',
      model: s.model || 'agnes-image-2.5-flash',
    });
  });
}

const outFile = join(ROOT, '.scratch-20261119', '生成任务.jsonl');
writeFileSync(outFile, tasks.map((t) => JSON.stringify(t)).join('\n'));
console.log(`构建任务 ${tasks.length} 条（${new Set(tasks.map((t) => t.id.split('--')[0])).size} 个技能 × ${perSkill}）→ ${outFile}`);
if (!corpus.length) console.log('警告：语料清单为空，请先跑 分类入库-20261119.mjs');
