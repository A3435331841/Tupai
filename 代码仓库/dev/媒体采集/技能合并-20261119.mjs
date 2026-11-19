// 技能合并：.scratch-20261119/skills/*.json + 既有 seed 模板 → 校验、跨来源查重、定稿技能总表
// 产出：资产仓库/20-技能资产/自研/图派技能库-20261119/技能总表.json + 合并报告
// 查重规则：① id 冲突 → 后者加来源后缀 ② name_zh 相同 → 视为同技能取先者 ③ tags 交集≥80% 且同 category → 取先者
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKILLS_DIR = join(ROOT, '.scratch-20261119', 'skills');
const OUT_DIR = join(ROOT, '资产仓库', '20-技能资产', '自研', '图派技能库-20261119');

const CATEGORIES = ['人像美化', '人像风格', '胶片质感', '城市夜景', '旅行风光', '插画动漫', '艺术画作', '复古年代', '创意合成', '特效光影', '商品静物', '美食饮品', '老照片修复', '趣味玩具化'];

// 既有模板 id（不可冲突）
const EXISTING_IDS = new Set(['film-daily', 'night-bright', 'clean-portrait', 'travel-postcard', 'magazine-cover', 'rain-neon', 'retro-postcard']);

const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.json'));
console.log('来源文件:', files.join(', '));

// 已定稿技能不可变：技能总表若已存在，其中的技能保留原 id；只对新增来源做校验与查重后追加
const OUT_FILE = join(OUT_DIR, '技能总表.json');
const REPORT_FILE = join(SKILLS_DIR, '..', '合并报告.json');
let finalized = [];
let mergedFiles = [];
if (existsSync(OUT_FILE)) {
  try {
    const prev = JSON.parse(readFileSync(OUT_FILE, 'utf8'));
    finalized = prev.技能 || [];
    mergedFiles = prev.来源统计?.map((x) => x.文件) || [];
    console.log(`已定稿 ${finalized.length} 条（已并入: ${mergedFiles.join(', ')}），保持不变`);
  } catch { console.log('技能总表损坏，按全新合并处理'); }
}

const all = [];
for (const f of files) {
  if (mergedFiles.includes(f)) continue; // 已并入的来源不重复处理（保证 id 稳定）
  try {
    const arr = JSON.parse(readFileSync(join(SKILLS_DIR, f), 'utf8'));
    for (const s of arr) all.push({ ...s, _src: f });
  } catch (e) { console.log(`跳过损坏文件 ${f}: ${e.message}`); }
}
console.log(`新增候选 ${all.length} 条（来自 ${files.length - mergedFiles.length} 个新文件）`);

// 校验
const valid = [];
const rejects = [];
function validate(s) {
  const problems = [];
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(s.id || '')) problems.push('id 不合法');
  if (!s.name_zh || s.name_zh.length > 12) problems.push('name_zh 缺失或过长');
  if (!CATEGORIES.includes(s.category)) problems.push(`category 不受控: ${s.category}`);
  if (!s.prompt || s.prompt.length < 40) problems.push('prompt 缺失或过短');
  if (/\{\{|\{argument/.test(s.prompt || '')) problems.push('prompt 残留变量');
  if (!s.model || !/agnes-image/.test(s.model)) problems.push('model 非法');
  if (!['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'].includes(s.ratio || '')) problems.push(`ratio 非法: ${s.ratio}`);
  if (!Array.isArray(s.tags) || s.tags.length < 2) problems.push('tags 不足');
  if (!s.source?.repo) problems.push('source 缺失');
  return problems;
}
for (const s of all) {
  const problems = validate(s);
  if (problems.length) rejects.push({ id: s.id, src: s._src, problems });
  else valid.push(s);
}
console.log(`校验通过 ${valid.length}，拒收 ${rejects.length}`);

// 查重（对已定稿技能也查重，避免新来源重复）
const seenIds = new Set([...EXISTING_IDS, ...finalized.map((s) => s.id)]);
const finalNames = new Set(finalized.map((s) => s.name_zh));
const kept = [];
let dupId = 0, dupName = 0, dupTags = 0;
for (const s of valid) {
  let id = s.id;
  if (seenIds.has(id)) { id = `${id}-${(s.source.repo || 'x').split('/')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}`; if (seenIds.has(id)) { dupId++; continue; } dupId++; }
  if (finalNames.has(s.name_zh)) { dupName++; continue; }
  const nameHit = kept.find((k) => k.name_zh === s.name_zh);
  if (nameHit) { dupName++; continue; }
  const pool = [...finalized, ...kept];
  const tagHit = pool.find((k) => k.category === s.category
    && (() => { const inter = s.tags.filter((t) => k.tags.includes(t)).length; return inter / Math.max(s.tags.length, k.tags.length) >= 0.8; })());
  if (tagHit) { dupTags++; continue; }
  seenIds.add(id);
  kept.push({ ...s, id });
}
console.log(`新增查重后 ${kept.length}（去 id 冲突 ${dupId} / 重名 ${dupName} / 标签近似 ${dupTags}）`);

// 类目分布 + 排序：已定稿在前（id/sort 不变），新增追加并重新编号 sort
const finalSkills = finalized.map((s, i) => ({ ...s, sort: s.sort ?? i }));
kept.sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.id.localeCompare(b.id));
const addedSkills = kept.map((s, i) => ({ ...s, sort: finalSkills.length + i }));
const allSkills = [...finalSkills, ...addedSkills];
const dist = {};
for (const s of allSkills) dist[s.category] = (dist[s.category] || 0) + 1;

// 落盘
mkdirSync(OUT_DIR, { recursive: true });
const out = {
  说明: '图派图片二次创作技能库（GitHub 多来源收集 + 规范化重写；协议与出处见各 source 字段与 20-技能资产/第三方/来源说明）',
  更新: new Date().toISOString().slice(0, 10),
  总数: allSkills.length,
  类目分布: dist,
  来源统计: [...mergedFiles.map((f) => ({ 文件: f, 条数: finalSkills.filter((s) => s.来源文件 === f || s._src === f).length })),
    ...files.filter((f) => !mergedFiles.includes(f)).map((f) => ({ 文件: f, 条数: addedSkills.filter((s) => s._src === f).length }))],
  技能: allSkills.map(({ _src, ...s }) => ({ ...s, ...(s.来源文件 ? {} : { 来源文件: _src }) })),
};
writeFileSync(OUT_FILE, JSON.stringify(out, null, 1));
writeFileSync(REPORT_FILE, JSON.stringify({ 本次候选: all.length, 本次校验拒收: rejects, id冲突: dupId, 重名: dupName, 标签近似: dupTags, 新增: addedSkills.length, 累计定稿: allSkills.length, dist }, null, 1));
console.log(`累计定稿 ${allSkills.length} 条（本次新增 ${addedSkills.length}）→ ${OUT_FILE}`);
console.log('类目分布:', JSON.stringify(dist));
