// 60 秒演示彩排（docs/06 §6 清单）：首页→文字试玩→优化→生成→下载 核心路径计时 ≤60s
// 运行：node dev/demo-rehearsal.mjs（默认云端；BASE=http://127.0.0.1:5173 打本地 dev）
// 依赖 playwright（同 mobile-test.mjs）；Skills 双导出作为附加段单独计时，不计入 60s 核心。
import { chromium } from 'playwright';

const BASE = (process.env.BASE || 'https://tupai-moo3r9zpvox.qoder.zone').replace(/\/$/, '');
const browser = await chromium.launch();
// 平台边缘对 HeadlessChrome UA 的 POST 返 403（.bot 防护），彩排须用真实浏览器 UA
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' });
const marks = [];
const mark = (name) => marks.push([name, Date.now()]);
const since = (a, b) => ((marks[b][1] - marks[a][1]) / 1000).toFixed(1);

mark('start');
await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
mark('home');
await page.getByRole('button', { name: /文字试玩/ }).click();
await page.waitForURL(/\/studio/, { timeout: 15000 });
await page.getByRole('button', { name: '自动优化提示词' }).click();
await page.getByText('候选提示词', { exact: false }).first().waitFor({ timeout: 60000 });
mark('optimized');
await page.getByRole('button', { name: '生成作品' }).click();
await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 120000 });
mark('generated');
const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: /下载成品/ }).click(),
]);
mark('downloaded');

const core = (marks[4][1] - marks[0][1]) / 1000;
console.log(`核心路径分段：首页加载 ${since(0, 1)}s → 优化 ${since(1, 2)}s → 生成 ${since(2, 3)}s → 下载 ${since(3, 4)}s`);
console.log(`核心合计 ${core.toFixed(1)}s（门禁 ≤60s）${core <= 60 ? '✔' : '✘'}`);

// 附加段：Skills 保存+双导出（演示完整性，不计入 60s）
await page.getByRole('button', { name: '存为 Skills 配方' }).click();
await page.locator('[role="dialog"]').waitFor({ timeout: 10000 });
await page.fill('#skill-title', '彩排配方');
await page.getByRole('button', { name: '保存配方' }).click();
const [dj] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: /导出配方 JSON/ }).click(),
]);
const [dm] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: /导出 Qoder SKILL.md/ }).click(),
]);
mark('exported');
console.log(`附加段 Skills 保存+双导出 ${since(4, 5)}s（${dj.suggestedFilename()} / ${dm.suggestedFilename()}）`);
console.log(`全程 ${(marks[5][1] - marks[0][1]) / 1000}s`);

await browser.close();
process.exit(core <= 60 ? 0 : 1);