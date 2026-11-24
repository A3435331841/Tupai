// 图派仓库范围检查：检查 Git 暂存区，而不是工作区中的其他版本。
// 用法：node 代码仓库/dev/repo-scope-check.mjs [--strict]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);
const strict = process.argv.includes('--strict');
const errors = [];
const warnings = [];
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', ...options });
const parts = (text) => text.split('\0').filter(Boolean);
const entries = new Map();

for (const record of parts(git(['ls-files', '--stage', '-z']))) {
  const match = record.match(/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/);
  if (!match || match[3] !== '0') {
    errors.push('暂存区存在未解决的冲突');
    continue;
  }
  entries.set(match[4], { mode: match[1], oid: match[2] });
}
const headRecords = parts(git(['ls-tree', '-r', '-z', '--full-tree', 'HEAD']));
const head = new Map();
for (const record of headRecords) {
  const match = record.match(/^(\d+) blob ([0-9a-f]+)\t([\s\S]+)$/);
  if (match) head.set(match[3], { mode: match[1], oid: match[2] });
}
const allowedTop = new Set(['.gitignore.example', 'README.md', 'LICENSE', 'docs', '代码仓库', '资产仓库']);
const forbidden = [
  [/(^|\/)node_modules\//i, '依赖目录'],
  [/(^|\/)dist\//i, '构建产物'],
  [/(^|\/)\.vite\//i, 'Vite 缓存'],
  [/(^|\/)(\.workbuddy|\.qoder|\.idea|\.vscode)\//i, '本地工具状态'],
  [/(^|\/)test-images\//i, '本地测试底图'],
  [/(^|\/)media\/private\//i, '私密素材'],
  [/(^|\/)screenshots?\//i, '临时截图'],
  [/(^|\/)早期规划\//, '本地历史资料'],
  [/^docs\/references\/agnes-api\.md$/i, '含凭据的 Agnes 手册'],
  [/^AGENTS\.md$/i, '本地私有协作规则'],
  [/^\.gitignore$/i, '本地私有忽略文件'],
  [/(^|\/)\.env[^/]*$/i, '环境变量文件'],
  [/(^|\/)(agnes key\.txt|[^/]*\.(key|pem))$/i, '密钥文件'],
  [/(^|\/)(id_rsa|id_ed25519)$/i, 'SSH 私钥'],
  [/\.(log|tsbuildinfo)$/i, '日志或增量缓存'],
];
// 新增过程材料仅留本地：按 docs/13 现行中文目录匹配（旧英文目录已不存在）。
const localOnlyNew = [
  [/^资产仓库\/50-页面设计\/.*\/assets\//, '原型素材副本'],
  [/^资产仓库\/50-页面设计\/.*\/(留档|历史|放弃)\//, '设计过程归档'],
  [/^资产仓库\/50-页面设计\/.*\/(explorations|草稿)\//, '设计探索'],
  [/^资产仓库\/50-页面设计\/.*\/预览-[^/]+\.(png|jpe?g|webp)$/i, '批量过程预览'],
  [/^资产仓库\/10-品牌资产\/.*\/(explorations|探索)\//, '品牌探索'],
  [/^资产仓库\/40-图片资产\/.*\/(explorations|探索)\//, '图片探索原图'],
  [/^资产仓库\/60-模板资产\/[^/]+\/samples\//, '模板回归样片'],
  [/^资产仓库\/95-私有资产\//, '私有资产'],
  [/\.(psd|ai|zip|mp4)$/i, '大型过程文件'],
];
const imageExt = new Set(['.webp', '.png', '.jpg', '.jpeg', '.svg']);
const isAssetImage = (file) => file.startsWith('资产仓库/') && imageExt.has(path.posix.extname(file).toLowerCase());

const uniqueOids = [...new Set([...entries.values()].map((entry) => entry.oid))];
const sizes = new Map();
if (uniqueOids.length) {
  const output = git(['cat-file', '--batch-check=%(objectname) %(objectsize)'], { input: uniqueOids.join('\n') + '\n' });
  for (const line of output.trim().split('\n')) {
    const match = line.match(/^([0-9a-f]+) (\d+)$/);
    if (!match) throw new Error(`无法读取暂存对象大小：${line}`);
    sizes.set(match[1], Number(match[2]));
  }
}
const imageGroups = new Map();
for (const [file, entry] of entries) {
  const top = file.split('/')[0];
  if (!allowedTop.has(top)) errors.push(`未知或禁止的顶层路径: ${file}`);
  for (const [pattern, label] of forbidden) if (pattern.test(file)) errors.push(`禁止提交（${label}）: ${file}`);
  if (!head.has(file)) {
    for (const [pattern, label] of localOnlyNew) if (pattern.test(file)) errors.push(`新增文件应仅留本地（${label}）: ${file}`);
  }
  if (entry.mode !== '100644' && entry.mode !== '100755') errors.push(`不支持的文件类型: ${file}`);
  const mb = (sizes.get(entry.oid) || 0) / 1048576;
  if (mb > 50) errors.push(`超大文件 >50 MiB: ${file} (${mb.toFixed(1)} MiB)`);
  else if (mb > 5) warnings.push(`大文件 >5 MiB: ${file} (${mb.toFixed(1)} MiB)`);
  if (isAssetImage(file)) {
    if (!imageGroups.has(entry.oid)) imageGroups.set(entry.oid, []);
    imageGroups.get(entry.oid).push(file);
  }
}
const headCounts = new Map();
for (const [file, entry] of head) {
  if (isAssetImage(file)) headCounts.set(entry.oid, (headCounts.get(entry.oid) || 0) + 1);
}
let historicalDuplicates = 0;
for (const [oid, files] of imageGroups) {
  if (files.length < 2) continue;
  if (files.length > (headCounts.get(oid) || 0)) errors.push(`新增重复图片: ${files.join(' <=> ')}`);
  else historicalDuplicates++;
}
if (historicalDuplicates) warnings.push(`历史重复图片 ${historicalDuplicates} 组（新增副本会阻断）`);

const blobCache = new Map();
function blob(file) {
  const entry = entries.get(file);
  if (!entry) throw new Error(`缺少暂存文件: ${file}`);
  if ((sizes.get(entry.oid) || 0) > 50 * 1048576) throw new Error(`对象超过 50 MiB: ${file}`);
  if (!blobCache.has(entry.oid)) blobCache.set(entry.oid, execFileSync('git', ['cat-file', 'blob', entry.oid], { maxBuffer: 51 * 1048576 }));
  return blobCache.get(entry.oid);
}
function json(file) {
  try { return JSON.parse(blob(file).toString('utf8')); }
  catch (e) { errors.push(`无法读取暂存清单 ${file}: ${e.message}`); return null; }
}
const map = json('资产仓库/90-元数据/运行时映射.json');
if (map) {
  const seen = new Set();
  if (!Array.isArray(map.runtime) || map.count !== map.runtime.length) errors.push('运行时映射 count 与条目不一致');
  for (const item of Array.isArray(map.runtime) ? map.runtime : []) {
    const { runtime_path: runtime, source_path: source, sha256 } = item;
    if (seen.has(runtime)) errors.push(`运行时映射重复: ${runtime}`);
    seen.add(runtime);
    if (!entries.has(runtime) || !entries.has(source)) { errors.push(`运行时映射文件未跟踪: ${runtime} → ${source}`); continue; }
    for (const file of [runtime, source]) {
      if ((sizes.get(entries.get(file).oid) || 0) > 50 * 1048576) continue;
      if (createHash('sha256').update(blob(file)).digest('hex') !== sha256) errors.push(`运行时映射哈希不符: ${file}`);
    }
  }
  for (const file of entries.keys()) {
    if (file.startsWith('代码仓库/web/public/') && !seen.has(file)) errors.push(`运行时资源缺少映射: ${file}`);
  }
}
const assets = json('资产仓库/90-元数据/资产总清单.json');
if (assets) {
  if (!Array.isArray(assets.assets) || assets.count !== assets.assets.length) errors.push('资产清单 count 与条目不一致');
  const registered = new Set();
  for (const item of Array.isArray(assets.assets) ? assets.assets : []) {
    if (registered.has(item.path)) errors.push(`资产清单路径重复: ${item.path}`);
    registered.add(item.path);
    if (item.repository_scope === 'local-only') {
      if (entries.has(item.path)) errors.push(`仅本地资产仍在暂存区: ${item.path}`);
    } else if (!entries.has(item.path)) errors.push(`资产清单路径未跟踪: ${item.path}`);
    else if (item.sha256 && (sizes.get(entries.get(item.path).oid) || 0) <= 50 * 1048576
      && createHash('sha256').update(blob(item.path)).digest('hex') !== item.sha256) {
      errors.push(`资产清单哈希不符: ${item.path}`);
    }
    // 引用字段不得残留迁移前旧目录（brand/designs/media/...），防止溯源链断裂
    // 同时覆盖现行英文键（used_by/runtime_path 等）与历史中文键，避免字段改名后漏检。
    const OLD_DIR = /^资产仓库\/(brand|designs|media|manifests|skills|test-images|archive)\//;
    for (const field of [
      '重复自', '派生自', '被引用于', '运行时路径', '提示词路径', '取代', '被取代于',
      'used_by', 'runtime_path', 'duplicate_of', 'derived_from', 'superseded_by',
    ]) {
      const v = item[field];
      if (v == null) continue;
      for (const ref of (Array.isArray(v) ? v : [v])) {
        if (typeof ref !== 'string') continue;
        if (OLD_DIR.test(ref)) errors.push(`资产清单 ${field} 残留旧路径: ${ref}`);
      }
    }
  }
  for (const file of entries.keys()) {
    if (isAssetImage(file) && !registered.has(file)) errors.push(`图片缺少资产清单记录: ${file}`);
  }
}
console.log(`仓库范围检查：暂存文件 ${entries.size}，错误 ${errors.length}，告警 ${warnings.length}`);
for (const message of errors) console.log(`  FAIL  ${message}`);
for (const message of warnings) console.log(`  WARN  ${message}`);
const failed = errors.length > 0 || (strict && warnings.some((w) => !w.startsWith('历史重复图片')));
console.log(`结果: ${failed ? 'FAIL' : 'PASS'}${strict ? '（strict；历史重复仅告警）' : ''}`);
process.exit(failed ? 1 : 0);
