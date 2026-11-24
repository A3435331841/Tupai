// 图派一键验收门禁：在独立端口起干净本地假后端，依次跑全部自动化门禁并汇总。
// 用法：node 代码仓库/dev/acceptance-gates.mjs [port] [--json-only]
// 退出码：全部通过为 0，任一失败为 1。
// 覆盖 AGENTS.md §7 门禁：build / 契约一期 / 契约扩展 / 社区回归 / 故障注入 / 仓库范围 / 范围检查自测 / 文档链接。
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const webDir = path.join(root, '代码仓库', 'web');
const codeDir = path.join(root, '代码仓库');
const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8010);
const appBase = `http://127.0.0.1:${port}/functions/v1/app`;
const rootBase = `http://127.0.0.1:${port}`;
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const denoBin = isWin ? 'deno.cmd' : 'deno';

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n${detail.slice(-1200)}`}`);
}

function run(name, cmd, args, { cwd = codeDir, timeout = 300000, env = {}, shell = isWin } = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    timeout,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    shell,
  });
  const ok = r.status === 0;
  record(name, ok, `${r.stdout || ''}${r.stderr || ''}${r.error ? String(r.error) : ''}`);
  return ok;
}

// ---- 干净假后端 ----------------------------------------------------------
const server = spawn(
  denoBin,
  ['run', '--allow-net=127.0.0.1', '--allow-read', '--allow-env', 'dev/function-local.ts'],
  { cwd: codeDir, env: { ...process.env, PORT: String(port) }, stdio: 'ignore', shell: isWin },
);
let serverExited = false;
server.on('exit', () => { serverExited = true; });

async function waitHealthy() {
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    if (serverExited) return false;
    try {
      const r = await fetch(`${appBase}/api/v1/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((s) => setTimeout(s, 250));
  }
  return false;
}

// ---- 文档链接检查（仅第一方文档；第三方技能库按 AGENTS.md §6 原样保留，不纳入） ----
const mdFiles = [];
function walk(dir, depth = 0) {
  if (depth > 6) return;
  let items;
  try { items = readdirSync(dir); } catch { return; }
  for (const name of items) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    if (name === '20-技能资产' || name === '99-归档') continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, depth + 1);
    else if (/\.md$/i.test(name)) mdFiles.push(full);
  }
}
walk(path.join(root, 'docs'));
walk(path.join(root, '资产仓库'));
for (const f of ['README.md', 'AGENTS.md', '代码仓库/web/README.md']) {
  const full = path.join(root, f);
  if (existsSync(full)) mdFiles.push(full);
}

function checkDocLinks() {
  const broken = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (const file of new Set(mdFiles)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(linkRe)) {
      let target = m[1];
      if (/^(https?:|mailto:|#|data:)/i.test(target)) continue;
      target = decodeURI(target.split('#')[0].split('?')[0]);
      if (!target || target === '.' || target === '..') continue;
      if (!/\.(md|json|ts|tsx|mjs|css|html|yaml|yml|sql|png|jpe?g|webp|svg|txt)$/i.test(target) && !target.startsWith('./') && !target.startsWith('../')) continue;
      const candidates = [path.resolve(path.dirname(file), target)];
      if (!target.startsWith('.')) candidates.push(path.resolve(root, target));
      if (!candidates.some((c) => existsSync(c))) {
        broken.push(`${path.relative(root, file)} → ${m[1]}`);
      }
    }
  }
  record('文档相对链接可解析', broken.length === 0, broken.slice(0, 40).join('\n'));
}

// ---- Git 验收（确定性部分） ----------------------------------------------
function checkGit() {
  // 1) 空白错误（CRLF 提示为 warning，不算失败）
  const ws = spawnSync('git', ['diff', '--check'], { cwd: root, encoding: 'utf8', shell: isWin });
  record('Git 空白错误检查', ws.status === 0, `${ws.stdout || ''}${ws.stderr || ''}`);

  // 2) 提交标题规范：从「建立项目级 AI 协作规则」之后开始检查。
  // 4 条规则期早期提交使用旧格式且已推送 origin/main；AGENTS.md §8.1 禁止重写已推送历史，
  // 故显式豁免并在此登记，而不是靠缩短检查区间把问题藏掉。
  const LEGACY_TITLE_EXEMPT = new Set([
    'd4e64240154ba64cc3a01aa5040f81ea150d96e8', // 资产(首页): 新增放大副文案 Logo 与废片原图的唯一源…
    '1d81de3fa4b9e31e1fbd2fbfc3555042e76ed748', // 文档: 修正首页画廊范围与发布推送记录
    'c8fce3485cd8518925109f574316c48c45c4a0c0', // 文档: 同步阶段状态、契约、资产路径与计数
    '427cf9b38f425fd45883a8340a6aa74e9133c871', // 文档: 统一重构方案状态标记 + 资产治理执行约束
  ]);
  const LOG_SEP = '\u0000';
  const all = spawnSync('git', ['log', '--format=%H%x00%s%x00'], { cwd: root, encoding: 'utf8', shell: isWin });
  const tokens = (all.stdout || '').split(LOG_SEP);
  const commits = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const hash = tokens[i].trim();
    const subject = tokens[i + 1].trim();
    if (hash && subject) commits.push({ hash, subject });
  }
  const boundaryIndex = commits.findIndex((c) => c.subject === '文档(协作): 建立项目级 AI 协作规则');
  // 提交按新→旧排列；边界之前（索引更小）才是规则期。找不到边界时退回按日期。
  let period;
  if (boundaryIndex >= 0) {
    period = commits.slice(0, boundaryIndex);
  } else {
    const since = spawnSync('git', ['log', '--since=2026-11-19', '--format=%H%x00%s%x00'], {
      cwd: root, encoding: 'utf8', shell: isWin,
    });
    const t2 = (since.stdout || '').split(LOG_SEP);
    period = [];
    for (let i = 0; i + 1 < t2.length; i += 2) {
      const hash = t2[i].trim();
      const subject = t2[i + 1].trim();
      if (hash && subject) period.push({ hash, subject });
    }
  }
  const exempted = period.filter((c) => LEGACY_TITLE_EXEMPT.has(c.hash));
  const bad = period.filter(
    (c) => !LEGACY_TITLE_EXEMPT.has(c.hash)
      && (!/^(新增|修复|重构|文档|测试|构建|杂务|发布)\([^)]+\): .{1,50}$/.test(c.subject) || c.subject.endsWith('。')),
  );
  record(
    `Git 提交标题规范（规则期 ${period.length} 条，已推送历史豁免 ${exempted.length} 条）`,
    bad.length === 0,
    bad.slice(0, 20).map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join('\n'),
  );

  // 3) 受版本控制的敏感文件 / 私有资产
  const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', shell: isWin });
  const files = (tracked.stdout || '').split('\0').filter(Boolean);
  const risky = files.filter((f) =>
    /(^|\/)\.env|(^|\/)(agnes key\.txt|[^/]*\.(key|pem))$|(^|\/)(id_rsa|id_ed25519)$|^docs\/references\/agnes-api\.md$|^资产仓库\/95-私有资产\/|^AGENTS\.md$|^\.gitignore$|^早期规划\//i.test(f));
  record('Git 受控文件无敏感/私有内容', risky.length === 0, risky.slice(0, 20).join('\n'));
}

// 仓库范围检查默认读暂存区；验收要在不污染真实索引的前提下检查「工作区将提交的快照」，
// 因此用临时 GIT_INDEX_FILE 把工作区写入独立索引，再交给 repo-scope-check。
function checkRepoScope() {
  const tmpIndex = path.join(os.tmpdir(), `tupai-acceptance-${process.pid}-${Date.now()}.idx`);
  try {
    // 以 HEAD 初始化临时索引，保证「已跟踪但被忽略」的文件（如真实授权原图）仍在快照里，
    // 再叠加工作区改动与新增文件。
    const seed = spawnSync('git', ['read-tree', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
      shell: isWin,
    });
    if (seed.status !== 0) {
      record('仓库范围检查（工作区快照）', false, `无法初始化临时索引：${seed.stdout || ''}${seed.stderr || ''}`);
      return;
    }
    const add = spawnSync('git', ['add', '-A', '--', '.'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
      shell: isWin,
    });
    if (add.status !== 0) {
      record('仓库范围检查（工作区快照）', false, `无法建立临时索引：${add.stdout || ''}${add.stderr || ''}`);
      return;
    }
    const r = spawnSync(process.execPath, ['dev/repo-scope-check.mjs'], {
      cwd: codeDir,
      encoding: 'utf8',
      env: { ...process.env, GIT_INDEX_FILE: tmpIndex },
      shell: isWin,
    });
    record('仓库范围检查（工作区快照）', r.status === 0, `${r.stdout || ''}${r.stderr || ''}`);
  } finally {
    rmSync(tmpIndex, { force: true });
    rmSync(`${tmpIndex}.lock`, { force: true });
  }
}

// ---- 主流程 --------------------------------------------------------------
try {
  const up = await waitHealthy();
  if (!up) {
    record('本地假后端启动', false, `端口 ${port} 未就绪（deno 是否可用？）`);
  } else {
    record('本地假后端启动', true);
    run('前端构建（tsc + vite）', npm, ['run', 'build'], { cwd: webDir, timeout: 420000 });
    run('契约测试（一期）', process.execPath, ['api/contract-test.mjs', appBase]);
    run('契约测试（二三期扩展）', process.execPath, ['api/contract-test-extended.mjs', appBase]);
    run('社区全链回归', process.execPath, ['dev/community-test.mjs'], { env: { BASE: rootBase } });
    run('故障注入（429/402/401/轮换）', process.execPath, ['dev/failpath-test.mjs']);
    run('仓库范围检查自测', process.execPath, ['dev/repo-scope-check-test.mjs']);
    checkRepoScope();
  }
} finally {
  if (!serverExited) {
    if (isWin) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else server.kill();
  }
}
checkDocLinks();
checkGit();

const failed = results.filter((r) => !r.ok);
console.log(`\n验收门禁：${results.length - failed.length}/${results.length} 通过，${failed.length} 失败`);
console.log(`__ACCEPTANCE_JSON__ ${JSON.stringify({ gates: results.map(({ name, ok }) => ({ name, ok })), failed: failed.map((r) => r.name) })}`);
process.exit(failed.length === 0 ? 0 : 1);
