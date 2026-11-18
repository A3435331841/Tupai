// 图派仓库范围检查：约束 GitHub 提交边界（见 docs/11-提交范围与边界.md）。
// 用法: node 代码仓库/dev/repo-scope-check.mjs [--strict]
// --strict 时把「告警」也视为失败（用于新批次提交前）。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(ROOT);

const STRICT = process.argv.includes('--strict');
const WARN_MB = 5;
const FAIL_MB = 50;

const ALLOWED_TOP = new Set(['.gitignore', 'AGENTS.md', 'README.md', 'LICENSE', 'docs', '代码仓库', '资产仓库']);

const FORBIDDEN = [
  [/(^|\/)node_modules\//, '依赖目录 node_modules'],
  [/(^|\/)dist\//, '构建产物 dist'],
  [/(^|\/)\.vite\//, 'Vite 缓存'],
  [/(^|\/)\.workbuddy\//, '本地工具状态 .workbuddy'],
  [/(^|\/)test-images\//, '本地测试底图'],
  [/(^|\/)media\/private\//, '私密素材 media/private'],
  [/(^|\/)screenshots?\//, '临时截图目录'],
  [/(^|\/)早期规划\//, '本地历史资料 早期规划'],
  [/(^|\/)docs\/references\/agnes-api\.md$/, '含凭据的 Agnes 手册'],
  [/(^|\/)\.env($|\.)/, '环境变量文件'],
  [/(^|\/)(agnes key\.txt|[^/]*\.key)$/, 'Key 文件'],
  [/(^|\/)(id_rsa|id_ed25519|[^/]*\.pem)$/, 'SSH/私钥文件'],
  [/\.log$/, '日志文件'],
  [/\.tsbuildinfo$/, 'TypeScript 增量缓存'],
];

const IMAGE_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.svg']);

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const files = trackedFiles();
const errors = [];
const warnings = [];
const large = [];
const images = new Map();

for (const file of files) {
  const normalized = file.split(path.sep).join('/');
  const top = normalized.split('/')[0];
  if (!ALLOWED_TOP.has(top)) errors.push(`未知顶层路径: ${normalized}`);

  for (const [re, label] of FORBIDDEN) {
    if (re.test(normalized)) errors.push(`禁止提交（${label}）: ${normalized}`);
  }

  let size = 0;
  try { size = statSync(file).size; } catch { errors.push(`文件缺失: ${normalized}`); continue; }
  const mb = size / 1048576;
  if (mb > FAIL_MB) errors.push(`超大文件 >${FAIL_MB}MB: ${normalized} (${mb.toFixed(1)}MB)`);
  else if (mb > WARN_MB) warnings.push(`大文件 >${WARN_MB}MB: ${normalized} (${mb.toFixed(1)}MB)`);
  if (mb > WARN_MB) large.push([mb, normalized]);

  if (IMAGE_EXT.has(path.extname(normalized).toLowerCase()) && normalized.startsWith('资产仓库/')) {
    try {
      const hash = sha256(file);
      if (!images.has(hash)) images.set(hash, []);
      images.get(hash).push(normalized);
    } catch { /* 已在上方记录缺失 */ }
  }
}

const duplicateGroups = [...images.values()].filter((group) => group.length > 1);
if (duplicateGroups.length) {
  warnings.push(`重复图片 ${duplicateGroups.length} 组（历史原型/派生副本；新增资产应先查 sha256）`);
}

large.sort((a, b) => b[0] - a[0]);
if (large.length) {
  console.log('最大的已跟踪文件：');
  for (const [mb, file] of large.slice(0, 8)) console.log(`  ${mb.toFixed(2)} MB  ${file}`);
}
if (duplicateGroups.length) {
  console.log('重复图片组（前 5 组）：');
  for (const group of duplicateGroups.slice(0, 5)) console.log(`  - ${group.join('  <=>  ')}`);
}

console.log('\n仓库范围检查');
console.log(`  跟踪文件: ${files.length}`);
console.log(`  禁止/未知路径: ${errors.filter((x) => !x.startsWith('超大文件')).length}`);
console.log(`  超大文件: ${errors.filter((x) => x.startsWith('超大文件')).length}`);
console.log(`  告警: ${warnings.length}`);

for (const message of errors) console.log(`  FAIL  ${message}`);
for (const message of warnings) console.log(`  WARN  ${message}`);

const failed = errors.length > 0 || (STRICT && warnings.some((w) => !w.startsWith('重复图片')));
console.log(`\n结果: ${failed ? 'FAIL' : 'PASS'}${STRICT ? '（strict；历史重复图片仅告警）' : ''}`);
process.exit(failed ? 1 : 0);
