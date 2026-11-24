// 在临时仓库验证提交边界检查使用暂存内容，并保留历史过程文件。
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpRoot = path.resolve(os.tmpdir());
const fixture = mkdtempSync(path.join(tmpRoot, 'tupai-scope-test-'));
if (path.dirname(fixture) !== tmpRoot || !path.basename(fixture).startsWith('tupai-scope-test-')) throw new Error('临时目录校验失败');
const guardSource = fileURLToPath(new URL('./repo-scope-check.mjs', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: fixture, stdio: 'pipe' });
const put = (name, data) => { const file = path.join(fixture, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, data); };
const guard = () => spawnSync(process.execPath, ['代码仓库/dev/repo-scope-check.mjs'], { cwd: fixture, encoding: 'utf8' });
const check = (label, passed, output = '') => { if (!passed) throw new Error(`${label} 失败: ${output}`); console.log(`PASS ${label}`); };
try {
  git('init', '--quiet');
  git('config', 'user.name', 'Scope Test');
  git('config', 'user.email', 'scope-test@example.invalid');
  mkdirSync(path.join(fixture, '代码仓库/dev'), { recursive: true });
  copyFileSync(guardSource, path.join(fixture, '代码仓库/dev/repo-scope-check.mjs'));
  const image = Buffer.from('image fixture with no personal data');
  const digest = createHash('sha256').update(image).digest('hex');
  const source = '资产仓库/40-图片资产/AI生成/在用/原图.png';
  const runtime = '代码仓库/web/public/demo.png';
  const legacy = '资产仓库/50-页面设计/首页/留档/v01/assets/历史.png';
  const legacyBytes = Buffer.from('legacy image fixture');
  const legacyHash = createHash('sha256').update(legacyBytes).digest('hex');
  put('README.md', '# fixture\n');
  put(source, image);
  put(runtime, image);
  put(legacy, legacyBytes);
  put('资产仓库/90-元数据/运行时映射.json', JSON.stringify({ count: 1, runtime: [{ runtime_path: runtime, source_path: source, sha256: digest }] }));
  put('资产仓库/90-元数据/资产总清单.json', JSON.stringify({ count: 2, assets: [{ path: source, sha256: digest }, { path: legacy, sha256: legacyHash }] }));
  git('add', '--', 'README.md', '代码仓库', '资产仓库');
  git('commit', '--quiet', '-m', 'fixture');
  let result = guard();
  check('历史过程文件与映射通过', result.status === 0, result.stdout + result.stderr);

  const dup = '资产仓库/40-图片资产/AI生成/在用/重复.png';
  put(dup, image); git('add', '--', dup); put(dup, 'working tree is different');
  result = guard();
  check('检查暂存的重复图片而不是工作区版本', result.status !== 0 && result.stdout.includes('新增重复图片'), result.stdout + result.stderr);
  git('rm', '-f', '--cached', '--quiet', '--', dup); rmSync(path.join(fixture, dup));

  const forbidden = 'docs/references/agnes-api.md';
  put(forbidden, 'placeholder only'); git('add', '--', forbidden);
  result = guard();
  check('禁止文件阻断', result.status !== 0 && result.stdout.includes('禁止提交'), result.stdout + result.stderr);
  git('rm', '--cached', '--quiet', '--', forbidden); rmSync(path.join(fixture, forbidden));

  const processFile = '资产仓库/50-页面设计/首页/草稿/过程.png';
  put(processFile, 'new process file'); git('add', '--', processFile);
  result = guard();
  check('新增原型副本阻断', result.status !== 0 && result.stdout.includes('新增文件应仅留本地'), result.stdout + result.stderr);
  git('rm', '--cached', '--quiet', '--', processFile); rmSync(path.join(fixture, processFile));

  put(runtime, 'incorrect staged bytes'); git('add', '--', runtime); put(runtime, image);
  result = guard();
  check('运行时映射验证暂存版本', result.status !== 0 && result.stdout.includes('运行时映射哈希不符'), result.stdout + result.stderr);
  git('restore', '--staged', '--', runtime);
} finally {
  rmSync(fixture, { recursive: true, force: true });
}