// 资产仓库全面中文化迁移脚本（2026-11-18）
// 用法：
//   node 代码仓库/dev/资产迁移-20261118.mjs            # dry-run：打印映射与校验结果
//   node 代码仓库/dev/资产迁移-20261118.mjs --apply     # 执行：已跟踪用 git mv，未跟踪用 mv
// 规则来源：docs/13-创意资产库结构与命名规范.md §10 迁移映射
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = process.cwd();
const ASSET = path.join(REPO, '资产仓库');
const APPLY = process.argv.includes('--apply');

const PAGE_CN = { home: '首页', studio: '创作台', library: '资产库', community: '社区', legal: '隐私页' };
const HOME_HISTORY_INTENT = '杂志策展';
const OTHER_HISTORY_INTENT = '实现参考';
const APPROVED_BRAND_EXPLORE = new Set(['01', '03', '05', '06', '07', '10', '11', '14']);

function pageIntent(page, verDir) {
  if (verDir.startsWith('v01-')) return page === 'home' ? HOME_HISTORY_INTENT : OTHER_HISTORY_INTENT;
  if (verDir.startsWith('v02-') && page === 'home') return '显影暗房';
  return verDir.replace(/^v\d+-YYYYMMDD-/, '');
}

// 返回目标相对路径（相对 资产仓库/），或 null 表示原地不动
function mapPath(rel) {
  const b = (p) => path.basename(p);
  const parts = rel.split('/');

  if (rel === '总索引.md') return '00-总索引.md';
  if (rel === '设计说明.md') return '99-归档/通用留档/设计说明.md';

  if (rel.startsWith('brand/')) {
    if (rel === 'brand/品牌规范.md') return '10-品牌资产/品牌规范.md';
    if (rel.startsWith('brand/logo/')) return `10-品牌资产/标志/在用/${b(rel)}`;
    if (rel.startsWith('brand/explorations/')) return `10-品牌资产/标志/放弃/选稿-v01-20261117/${b(rel)}`;
    return `10-品牌资产/${rel.slice('brand/'.length)}`;
  }

  if (rel.startsWith('designs/')) {
    if (rel === 'designs/brand/tupai-brand.miora') return '10-品牌资产/品牌视觉画布.miora';
    if (rel.startsWith('designs/system/prompts/')) return `30-提示词资产/页面设计提示词/${b(rel)}`;

    if (rel.startsWith('designs/pages/')) {
      const rest = rel.slice('designs/pages/'.length);
      const seg = rest.split('/');
      const page = seg[0];
      const cn = PAGE_CN[page] || page;
      const tail = rest.slice(page.length + 1);
      if (tail === '索引.md') return `50-页面设计/${cn}/索引.md`;

      if (tail.startsWith('v02-20261118-interactive/')) {
        const suffix = tail.slice('v02-20261118-interactive/'.length);
        return `50-页面设计/${cn}/在用/v02-20261118-显影暗房/${suffix}`;
      }
      if (tail.startsWith('archive/v01-20261117-reference/')) {
        const suffix = tail.slice('archive/v01-20261117-reference/'.length);
        const intent = pageIntent(page, 'v01-20261117');
        return `50-页面设计/${cn}/历史/v01-20261117-${intent}/${suffix}`;
      }
      if (tail.startsWith('archive/light-theme-v00/')) {
        const suffix = tail.slice('archive/light-theme-v00/'.length);
        return `50-页面设计/${cn}/放弃/v00-20261117-浅色克制/${suffix}`;
      }
      return `50-页面设计/${cn}/草稿/${tail}`;
    }

    if (rel.startsWith('designs/archive/verification-screenshots/')) {
      const name = b(rel);
      if (/创作台/.test(name)) return `50-页面设计/创作台/留档/${name}`;
      if (/社区/.test(name)) return `50-页面设计/社区/留档/${name}`;
      if (/资产库/.test(name)) return `50-页面设计/资产库/留档/${name}`;
      return `50-页面设计/首页/留档/${name}`;
    }
    if (rel.startsWith('designs/archive/')) {
      const name = b(rel);
      if (name === '品牌资产合集.jpg') return `10-品牌资产/应用示例/${name}`;
      if (name === '原生测试记录.txt') return `99-归档/通用留档/${name}`;
      return `50-页面设计/首页/留档/${name}`;
    }
    return `99-归档/通用留档/${b(rel)}`;
  }

  if (rel.startsWith('templates/')) return `60-模板资产/${rel.slice('templates/'.length)}`;

  if (rel.startsWith('media/')) {
    if (rel.startsWith('media/generated/brand-explorations/')) {
      const name = b(rel);
      const m = name.match(/品牌探索-(\d+)\.png$/);
      const n = m ? m[1] : '';
      if (APPROVED_BRAND_EXPLORE.has(n)) return `10-品牌资产/标志/在用/探索稿/${name}`;
      return `10-品牌资产/标志/放弃/${name}`;
    }
    if (rel.startsWith('media/generated/')) return `40-图片资产/AI生成/在用/${b(rel)}`;
    if (rel.startsWith('media/licensed/')) return `40-图片资产/真实授权/${b(rel)}`;
    if (rel.startsWith('media/derived/')) return `40-图片资产/派生加工/${b(rel)}`;
    if (rel.startsWith('media/private/')) return `95-私有资产/私有图片/${b(rel)}`;
    return `40-图片资产/${rel.slice('media/'.length)}`;
  }

  if (rel.startsWith('skills/')) {
    const rest = rel.slice('skills/'.length);
    if (rest.startsWith('third-party/')) return `20-技能资产/第三方/${rest.slice('third-party/'.length)}`;
    if (rest.startsWith('own/')) return `20-技能资产/自研/${rest.slice('own/'.length)}`;
    return `20-技能资产/${rest}`;
  }

  if (rel.startsWith('manifests/')) {
    if (rel === 'manifests/资产清单.json') return '90-元数据/资产总清单.json';
    if (rel === 'manifests/运行时映射.json') return '90-元数据/运行时映射.json';
    return `90-元数据/${b(rel)}`;
  }

  if (rel.startsWith('archive/manifests-legacy-20261118/')) return `99-归档/旧清单/${b(rel)}`;
  if (rel.startsWith('archive/')) return `99-归档/通用留档/${b(rel)}`;

  if (rel.startsWith('test-images/')) return `95-私有资产/本地测试底图/${rel.slice('test-images/'.length)}`;

  return null;
}

// 枚举所有文件（相对 资产仓库/）
function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.posix.join(base, e.name);
    if (e.isDirectory()) walk(full, rel, out);
    else out.push(rel);
  }
}
const files = [];
walk(ASSET, '', files);
files.sort();

// 已跟踪文件集合
const tracked = new Set(
  execFileSync('git', ['ls-files', '资产仓库/'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter(Boolean).map((p) => p.slice('资产仓库/'.length))
);

// 构建映射并校验
const map = [];
const targets = new Map();
const errors = [];
for (const rel of files) {
  const to = mapPath(rel);
  if (!to) { errors.push(`无映射规则: ${rel}`); continue; }
  if (targets.has(to)) { errors.push(`目标冲突: ${to} <- ${targets.get(to)} / ${rel}`); continue; }
  targets.set(to, rel);
  map.push({ from: rel, to, tracked: tracked.has(rel) });
}

console.log(`文件总数: ${files.length} | 已跟踪: ${tracked.size} | 映射条目: ${map.length} | 冲突/无规则: ${errors.length}`);
if (errors.length) {
  console.log('\n[校验失败]');
  errors.forEach((e) => console.log('  - ' + e));
  process.exit(1);
}

// --emit-map：导出旧→新路径映射（供清单重建复用，避免规则漂移）
if (process.argv.includes('--emit-map')) {
  const out = {};
  for (const m of map) out[m.from] = m.to;
  const target = path.join(REPO, '代码仓库', 'dev', '资产迁移映射-20261118.json');
  fs.writeFileSync(target, JSON.stringify(out, null, 2), 'utf8');
  console.log('[映射已导出] ' + path.relative(REPO, target));
  process.exit(0);
}

// 目标文件已存在？
for (const { from, to } of map) {
  const abs = path.join(ASSET, to);
  if (from !== to && fs.existsSync(abs)) {
    console.log(`[目标已存在，将拒绝] ${to}`);
    process.exit(1);
  }
}

if (!APPLY) {
  const byTop = {};
  for (const m of map) {
    const top = m.to.split('/')[0];
    (byTop[top] ||= []).push(m);
  }
  for (const top of Object.keys(byTop).sort()) {
    console.log(`\n== ${top} (${byTop[top].length}) ==`);
    for (const m of byTop[top]) console.log(`  ${m.tracked ? 'G' : ' '} ${m.from}  ->  ${m.to}`);
  }
  console.log('\n[dry-run] 未改动任何文件。检查无误后加 --apply 执行。');
  process.exit(0);
}

// 执行：先建目标目录，再逐个移动
for (const m of map) {
  if (m.from === m.to) continue;
  const fromAbs = path.join(ASSET, m.from);
  const toAbs = path.join(ASSET, m.to);
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  if (m.tracked) {
    execFileSync('git', ['mv', '--', path.join('资产仓库', m.from), path.join('资产仓库', m.to)], { cwd: REPO, stdio: 'pipe' });
  } else {
    fs.renameSync(fromAbs, toAbs);
  }
}

// 清理遗留空目录（自底向上）
function pruneEmpty(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name));
  }
  if (fs.readdirSync(dir).length === 0 && path.resolve(dir) !== ASSET) fs.rmdirSync(dir);
}
pruneEmpty(ASSET);

console.log(`\n[完成] 已迁移 ${map.filter((m) => m.from !== m.to).length} 个文件。`);
