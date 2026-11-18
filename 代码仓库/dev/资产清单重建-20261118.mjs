// 资产总清单重建（2026-11-18 中文化迁移配套）
// 读取旧清单（现 90-元数据/资产总清单.json 仍为旧内容），按迁移映射更新路径、
// 按新目录分区重标六态、补中文名称/分区/六维标签/决策字段，并生成标签词表与字段规范。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const MAP = JSON.parse(fs.readFileSync(path.join(REPO, '代码仓库/dev/资产迁移映射-20261118.json'), 'utf8'));
const LIST = path.join(REPO, '资产仓库/90-元数据/资产总清单.json');
// 始终以 HEAD 中的原始清单为输入，保证脚本可重复执行且不污染
const original = execFileSync('git', ['show', 'HEAD:资产仓库/manifests/资产清单.json'], { cwd: REPO, encoding: 'utf8' });
const old = JSON.parse(original);
const assets = old.assets;

// 由新路径推断六态
function statusFromPath(p) {
  if (p.includes('/在用/')) return 'approved';
  if (p.includes('/历史/')) return 'superseded';
  if (p.includes('/放弃/')) return 'discarded';
  if (p.includes('/留档/')) return 'archived';
  if (p.includes('/草稿/')) return 'draft';
  if (p.includes('/评审/')) return 'review';
  return null; // 素材类，沿用原状态
}

// 由新路径 + 文件名推断六维标签
function tagsOf(p, origin) {
  const t = { 用途: [], 风格: [], 场景: [], 页面: [], 主题: [], 合规: [] };
  const add = (k, v) => { if (v && !t[k].includes(v)) t[k].push(v); };
  const name = path.basename(p);

  // 来源 → 合规/用途
  if (origin === 'ai-generated') add('合规', '含AI标识');
  if (/标志|logo/i.test(p)) add('用途', '品牌标志');
  if (/封面/.test(p)) add('用途', '模板封面');
  if (/主视觉/.test(p)) add('用途', '主视觉');
  if (/画廊|gallery/.test(p) || /周末市集|咖啡午后|城市夜色|旧书时光|海边黄昏|猫咪日常|绿植静物|都市天际|餐桌日记/.test(name)) add('用途', '画廊展示');
  if (/演示/.test(p)) add('用途', '演示样片');

  // 页面设计 → 页面 + 风格
  const pm = p.match(/50-页面设计\/([^/]+)\//);
  if (pm) {
    const pageMap = { 首页: '首页', 创作台: '创作台', 资产库: '资产库', 社区: '社区', 隐私页: '隐私页' };
    add('页面', pageMap[pm[1]] || pm[1]);
    if (/显影暗房/.test(p)) add('风格', '显影暗房');
    if (/杂志策展/.test(p)) add('风格', '杂志策展');
    if (/浅色克制/.test(p)) add('风格', '极简');
  }

  // 风格（模板名）
  const styleMap = { 'film-daily': '胶片日常', 'night-bright': '夜景提亮', 'clean-portrait': '清透人像', 'travel-postcard': '旅行明信片', 'magazine-cover': '杂志策展' };
  for (const [id, s] of Object.entries(styleMap)) if (p.includes(id)) add('风格', s);

  // 场景（源图名）
  const sceneMap = { 周末市集: '街拍', 咖啡午后: '室内', 城市夜色: '夜景', 旧书时光: '室内', 海边黄昏: '风景', 猫咪日常: '宠物', 绿植静物: '室内', 都市天际: '风景', 餐桌日记: '聚餐', 窗边阅读: '室内', 暖光美食: '食物', 黄昏街道: '街拍', 干花静物: '室内', 海边漫步: '风景', 猫与午后: '宠物' };
  for (const [k, v] of Object.entries(sceneMap)) if (name.includes(k)) add('场景', v);

  // 主题
  if (/显影/.test(p)) add('主题', '显影');
  if (/标志|logo/i.test(p)) add('主题', '私密守护');
  for (const k of Object.keys(t)) if (t[k].length === 0) delete t[k];
  return t;
}

// 中文名称：优先用文件名去扩展名，去掉纯 hash
function cnName(p, oldId) {
  const base = path.basename(p).replace(/\.[^.]+$/, '');
  if (/^[\w-]+$/.test(base) && /[a-z]/.test(base)) return oldId || base; // 英文 id 类保留旧 id 名
  return base;
}

// 原型副本 local-only 记录：旧清单路径是"真实位置"，但 id 带 -原型副本 后缀。
// 迁移后这些文件落在新原型 assets/ 目录，按文件名重新定位。
const PROTO_ASSETS = '资产仓库/50-页面设计/首页/在用/v02-20261118-显影暗房/assets/';
function locateProtoCopy(a) {
  if (!a.id.endsWith('-原型副本')) return null;
  const raw = path.basename(a.path).replace(/\.[^.]+$/, ''); // 去掉后缀取语义名
  const ext = path.extname(a.path);
  const candidates = [
    PROTO_ASSETS + 'gallery/' + raw + ext,
    PROTO_ASSETS + raw + ext,
  ];
  for (const c of candidates) if (fs.existsSync(path.join(REPO, c))) return c;
  return null;
}

let changed = 0, missingMap = 0;
const newAssets = assets.map((a) => {
  let newPath = MAP[a.path] || a.path;
  const proto = (!MAP[a.path]) ? locateProtoCopy(a) : null;
  if (proto) newPath = proto;
  if (newPath !== a.path) changed++;
  else if (!fs.existsSync(path.join(REPO, newPath))) missingMap++;
  const st = statusFromPath(newPath);
  // 原型自包含副本：物理在"在用/assets/"，但语义是重复留档，不占"在用"决策态
  const isProtoCopy = a.id.endsWith('-原型副本') || a.duplicate_of;
  const status = isProtoCopy ? 'archived' : (st || a.status);
  const o = { ...a };
  o.path = newPath;
  o.名称 = cnName(newPath, a.id);
  o.分区 = (newPath.match(/\/(在用|草稿|评审|历史|放弃|留档)\//) || [])[1] || null;
  o.状态 = status;
  delete o.status; // 统一使用中文字段名
  o.标签 = tagsOf(newPath, a.origin);
  // 保留原英文 id 稳定；旧 duplicate_of/derivative_of 语义保留
  if (a.duplicate_of) o.重复自 = a.duplicate_of; delete o.duplicate_of;
  if (a.derivative_of) o.派生自 = a.derivative_of; delete o.derivative_of;
  // 决策：仅设计类补理由；重复副本说明为例外留档
  if (isProtoCopy) {
    o.决策 = { 结果: '留档', 日期: '2026-11-18', 决策人: '项目', 理由: '原型自包含副本，重复自源文件，物理保留供 index.html 预览，不计入在用决策' };
  } else if (['首页', '创作台', '资产库', '社区', '隐私页'].some((x) => newPath.includes(x)) && o.分区) {
    o.决策 = { 结果: status === 'approved' ? '采纳' : status === 'discarded' ? '否决' : status === 'superseded' ? '被取代' : '待定', 日期: '2026-11-18', 决策人: status === 'approved' ? '用户' : '项目', 理由: o.分区 + ' 分区（迁移按目录状态归类）' };
  }
  return o;
});

const byStatus = {};
for (const a of newAssets) byStatus[a.状态] = (byStatus[a.状态] || 0) + 1;

const out = {
  generated_at: '2026-11-18',
  schema_version: '2.0',
  note: '全面中文化迁移后重建；状态六态（在用沿用 approved）、六维标签、目录分区/清单/版本说明三处同步。字段语义见 字段规范.json。',
  count: newAssets.length,
  status_summary: byStatus,
  assets: newAssets,
};
fs.writeFileSync(LIST, JSON.stringify(out, null, 2), 'utf8');
console.log('记录数:', newAssets.length, '| 路径已更新:', changed, '| 未映射且文件不存在:', missingMap);
console.log('状态分布:', byStatus);
