// 构建批量图生图任务清单（修复版 2026-11-22）
// 核心修复：禁止生产环境 flat 轮转；按 技能输入类型.json 的 input_type 匹配语料分类+标签+补充输入。
// 用法：
//   node 生成任务构建-20261119.mjs --skills=技能总表.json [--per-skill=20] [--out=生成任务.jsonl] [--only=id1,id2]
//   node 生成任务构建-20261119.mjs --smoke --per-skill=1   # 仅冒烟：flat 轮转，不用于正式演示
// 产物：任务 jsonl（id/out/image/prompt/negative/ratio/model/input_type）+ 路由报告 json
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRATCH = join(ROOT, '.scratch-20261119');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};

const skillsFile = arg('skills', join(ROOT, '资产仓库', '20-技能资产', '自研', '图派技能库-20261119', '技能总表.json'));
const corpusFile = arg('corpus', join(ROOT, '资产仓库', '90-元数据', '技能演示图片清单.json'));
const mappingFile = arg('mapping', join(ROOT, '资产仓库', '90-元数据', '技能输入类型.json'));
const suppFile = arg('supp', join(ROOT, '资产仓库', '90-元数据', '技能补充输入.json'));
const perSkill = Number(arg('per-skill', 20));
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const SMOKE = process.argv.includes('--smoke');
const OUT_FILE = arg('out', join(SCRATCH, '生成任务.jsonl'));
const OUT_PREFIX = arg('out-prefix', ''); // 隔离重跑目录，如 修复重跑/
const REPORT_FILE = arg('report', OUT_FILE.replace(/\.jsonl$/, '') + '-路由报告.json');

const abs = (rel) => join(ROOT, rel);

const skillsDoc = JSON.parse(readFileSync(skillsFile, 'utf8'));
const skills = skillsDoc.技能 || skillsDoc.skills || skillsDoc;

// ---------- 冒烟模式：flat 轮转，仅用于连通性测试 ----------
if (SMOKE) {
  const { readdirSync } = await import('node:fs');
  const flatPool = [];
  for (const src of ['picsum', 'nasa', 'pexels']) {
    const dir = join(SCRATCH, '图源原始', src);
    let names = [];
    try { names = readdirSync(dir).filter((n) => /\.(jpg|jpeg|png)$/i.test(n)); } catch {}
    for (const n of names) flatPool.push(join(SCRATCH, '图源原始', src, n));
  }
  console.log(`⚠ 冒烟模式：flat 轮转 ${flatPool.length} 张，产物不得用于正式演示`);
  const tasks = [];
  let salt = 0;
  for (const s of skills) {
    if (only && !only.has(s.id)) continue;
    for (let i = 0; i < perSkill; i++) {
      tasks.push({
        id: `${s.id}--${String(i).padStart(2, '0')}`,
        out: `${s.id}/作品-${String(i + 1).padStart(2, '0')}.png`,
        image: flatPool[(i * 53 + salt * 97 + 11) % flatPool.length],
        prompt: s.prompt, negative: s.negative_prompt || 'watermark, text, low quality, blurry',
        ratio: s.ratio || '3:4', model: s.model || 'agnes-image-2.5-flash', input_type: 'smoke-flat',
      });
    }
    salt++;
  }
  writeFileSync(OUT_FILE, tasks.map((t) => JSON.stringify(t)).join('\n'));
  console.log(`构建 ${tasks.length} 条（冒烟）→ ${OUT_FILE}`);
  process.exit(0);
}

// ---------- 匹配模式 ----------
const mapping = JSON.parse(readFileSync(mappingFile, 'utf8'));
const TYPES = mapping.类型定义;
const SKILL_TYPE = mapping.技能;
const corpus = JSON.parse(readFileSync(corpusFile, 'utf8')).资产;
const supp = existsSync(suppFile) ? JSON.parse(readFileSync(suppFile, 'utf8')).资产 : [];
const suppByName = new Map(supp.map((a) => [a.名称.replace(/\.(jpg|png)$/i, ''), join(ROOT, a.路径)]));

function resolvePool(typeKey, seen = new Set()) {
  const spec = TYPES[typeKey];
  if (!spec) throw new Error(`未定义输入类型: ${typeKey}`);
  if (seen.has(typeKey)) return [];
  seen.add(typeKey);
  const picked = [];
  for (const rel of spec.文件路径 || []) picked.push(abs(rel));
  const hasSelector = Boolean(spec.分类 || (spec.文件前缀 || []).length || (spec.文件路径 || []).length);
  for (const a of corpus) {
    if (!hasSelector) break;
    const name = a.名称 || '';
    if (spec.分类 && a.分类 !== spec.分类) continue;
    if ((spec.文件前缀 || []).length && !spec.文件前缀.some((p) => name.startsWith(p))) continue;
    const text = [...(a.标签 || []), a.视觉备注 || ''].join('|');
    if ((spec.标签含 || []).length && !spec.标签含.some((k) => text.includes(k))) continue;
    if ((spec.标签不含 || []).length && spec.标签不含.some((k) => text.includes(k))) continue;
    picked.push(abs(a.路径));
  }
  for (const s of spec.补充输入 || []) {
    const p = suppByName.get(s);
    if (!p) throw new Error(`补充输入缺失: ${s}（检查 技能补充输入.json）`);
    picked.push(p);
  }
  // 按清单顺序保持确定性，并按完整路径字符串去重（同内容不同路径的重复图不合并）
  const uniq = [];
  const seenHash = new Set();
  for (const rel of picked) {
    const full = rel;
    if (seenHash.has(full)) continue;
    seenHash.add(full);
    uniq.push(full);
  }
  return uniq;
}

const pools = {};
const report = { 说明: '按 input_type 选图的路由报告', 更新: '2026-11-22', 每技能对数: perSkill, 类型池量: {}, 技能: [], 警告: [] };
for (const tk of Object.keys(TYPES)) {
  const list = resolvePool(tk);
  pools[tk] = { list, min: list.length };
  report.类型池量[tk] = { 可用: list.length, 技能数: 0, 池不足: list.length < perSkill };
}

const tasks = [];
const missing = [];
for (const s of skills) {
  if (only && !only.has(s.id)) continue;
  const entry = SKILL_TYPE[s.id];
  if (!entry) { missing.push(s.id); continue; }
  const type = entry.input_type;
  if (!TYPES[type]) { missing.push(`${s.id}(${type})`); continue; } // 非法/缺失 input_type 汇入统一报错，避免 TYPES[type] 裸 TypeError
  const primary = pools[type]?.list || [];
  // 备选类型只在主池为空时兜底；主池不足时优先复用同类输入，禁止跨语义凑数
  const altTypes = (TYPES[type].备选类型 || []).filter((t) => pools[t]);
  let pool = [...primary];
  let usedAlt = false;
  if (!pool.length) {
    for (const t of altTypes) pool.push(...pools[t].list);
    usedAlt = pool.length > 0;
  }
  if (!pool.length) throw new Error(`技能 ${s.id} 的输入池为空（类型 ${type}）`);
  const offset = parseInt(createHash('md5').update(s.id).digest('hex').slice(0, 6), 16) % pool.length;
  const picked = [];
  for (let i = 0; i < perSkill; i++) {
    picked.push(pool[(offset + i) % pool.length]);
    if (pool.length >= perSkill && i >= pool.length - 1) break;
  }
  const unique = new Set(picked).size;
  report.类型池量[type].技能数++;
  report.技能.push({ id: s.id, input_type: type, 依据: entry.依据, 池量: primary.length, 实际输入数: unique, 复用: unique < perSkill, 备选兜底: usedAlt });
  if (usedAlt) report.警告.push(`${s.id}（${type}）主池为空，已用备选类型兜底，需补语料`);
  if (unique < perSkill) report.警告.push(`${s.id}（${type}）池 ${primary.length}，${perSkill} 对需复用输入`);
  picked.forEach((img, i) => {
    tasks.push({
      id: `${s.id}--${String(i).padStart(2, '0')}`,
      out: `${OUT_PREFIX}${s.id}/作品-${String(i + 1).padStart(2, '0')}.png`,
      image: img, prompt: s.prompt, negative: s.negative_prompt || 'watermark, text, low quality, blurry',
      ratio: s.ratio || '3:4', model: s.model || 'agnes-image-2.5-flash', input_type: type,
    });
  });
}
if (missing.length) {
  console.error(`❌ 未配置 input_type 的技能 ${missing.length} 个：${missing.join(', ')}`);
  process.exit(1);
}

writeFileSync(OUT_FILE, tasks.map((t) => JSON.stringify(t)).join('\n'));
report.任务数 = tasks.length;
report.技能数 = report.技能.length;
report.池不足类型 = Object.entries(report.类型池量).filter(([, v]) => v.池不足).map(([k, v]) => `${k}:${v.可用}`);
writeFileSync(REPORT_FILE, JSON.stringify(report, null, 1));
console.log(`构建 ${tasks.length} 条（${report.技能数} 技能 × ${perSkill}）→ ${OUT_FILE}`);
console.log(`路由报告 → ${REPORT_FILE}`);
console.log(`池不足（<${perSkill}）：${report.池不足类型.join(', ') || '无'}`);
console.log(`复用输入技能：${report.技能.filter((x) => x.复用).length} 个`);