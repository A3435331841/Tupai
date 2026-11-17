// 移动端视口 + 全新无痕上下文验收（零本地存储起点）
// 依赖：在任意目录 npm i playwright && npx playwright install chromium（国内可设 PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright）
// 运行：node dev/mobile-test.mjs（默认打云端；BASE=http://127.0.0.1:5173 可打本地 dev）
import { chromium, devices } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'https://tupai-moo3r9zpvox.qoder.zone';
const iPhone = devices['iPhone 13'];
let passed = 0, failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${detail}`); }
};
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

const browser = await chromium.launch();
const errors = [];

async function newMobilePage() {
  const context = await browser.newContext({ ...iPhone, isMobile: false, locale: 'zh-CN' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });
  return { context, page };
}

console.log('A. 首页（iPhone 13 视口 390x844，全新上下文）');
const a = await newMobilePage();
{
  const { page } = a;
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  check('首页标题含 图派', (await page.title()).includes('图派'));
  const iw = await page.evaluate(() => window.innerWidth);
  check('移动视口宽度 390 生效', iw === 390, `innerWidth=${iw}`);
  check('无横向溢出', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`);
  const playBtn = page.getByRole('button', { name: /一键试玩/ });
  check('一键试玩按钮可见', await playBtn.isVisible());
  await page.screenshot({ path: 'shot-home-mobile.png', fullPage: false });
}

console.log('B. 文字入口全链路（真实点击导航）');
{
  const { page } = a;
  const t0 = Date.now();
  await page.getByRole('button', { name: /文字试玩/ }).click();
  await page.waitForURL(/\/studio/, { timeout: 15000 });
  check('点击导航到 /studio', page.url().includes('/studio'));
  // F2 上传校验：拖拽绕过 accept，客户端须即时拦截；清除重选回选择区
  await page.getByRole('tab', { name: '上传图片' }).click();
  const zone = page.getByRole('button', { name: /点击选择或拖拽图片到此处/ });
  await zone.waitFor({ timeout: 10000 });
  const drop = (name, type, bytes) => page.evaluate(({ name, type, bytes }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], name, { type }));
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('点击选择或拖拽图片到此处'));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, type, bytes });
  const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await drop('x.txt', 'text/plain', btoa('x'));
  await page.getByText('仅支持 JPG / PNG / WebP 图片').waitFor({ timeout: 5000 });
  check('拖拽非法格式即时可读错误', true);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(16 * 1024 * 1024)], 'big.png', { type: 'image/png' }));
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('点击选择或拖拽图片到此处'));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.getByText('图片超过 15MB 上限').waitFor({ timeout: 5000 });
  check('拖拽超大小即时可读错误', true);
  await drop('bad.heic', 'image/heic', btoa('not-a-heic'));
  await page.getByText('HEIC 转换失败，请先在相册导出为 JPG 后重试').waitFor({ timeout: 5000 });
  check('HEIC 失败有可读引导', true);
  await drop('ok.png', 'image/png', TINY_PNG);
  await page.getByAltText('原图预览').waitFor({ timeout: 5000 });
  check('合法拖拽入场出原图预览', true);
  await page.getByRole('button', { name: '清除重选' }).click();
  await zone.waitFor({ timeout: 5000 });
  check('清除重选回到选择区', true);
  await page.getByRole('tab', { name: '输入文字' }).click();
  await page.getByRole('button', { name: '自动优化提示词' }).click();
  await page.getByText('候选提示词', { exact: false }).first().waitFor({ timeout: 30000 });
  check('文生图徽标', await page.getByText('文生图 · 纯文字').isVisible());
  check('候选区渲染', await page.getByText('候选提示词', { exact: false }).first().isVisible());
  const summaryText = await page.getByTestId('current-summary').textContent();
  check('候选中文摘要可见', Boolean(summaryText && /[\u4e00-\u9fa5]/.test(summaryText)), summaryText || '');
  check('生成配额提示可见', await page.getByText(/今日还可生成 \d+ 次/).first().isVisible());
  check('创作台无横向溢出', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`);
  const promptBefore = await page.inputValue('#prompt');
  await page.selectOption('#model', { index: 1 });
  await page.selectOption('#ratio', { index: 1 });
  check('模型/画幅切换不丢提示词', (await page.inputValue('#prompt')) === promptBefore && promptBefore.length > 0);
  await page.screenshot({ path: 'shot-studio-text-mobile.png' });

  await page.getByRole('button', { name: '生成作品' }).click();
  const tGen = Date.now();
  await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 90000 });
  console.log(`  计时：文字试玩→候选 ${((tGen - t0) / 1000).toFixed(1)}s（含人工阅读停顿则更长）；生成→可下载 ${((Date.now() - tGen) / 1000).toFixed(1)}s；主路径合计 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  check('生成完成出现下载按钮', true);
  check('结果 AI 生成角标', await page.getByText('AI 生成', { exact: true }).first().isVisible());
  check('结果区无横向溢出', (await overflow(page)) <= 1);
  await page.screenshot({ path: 'shot-result-mobile.png' });

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /下载成品/ }).click(),
  ]);
  await dl.saveAs('download-result.png');
  check('下载成品触发且为 PNG', dl.suggestedFilename().endsWith('.png'), dl.suggestedFilename());
  const magic = readFileSync('download-result.png').subarray(0, 8);
  check('下载文件为真 PNG（canvas 合成 AI 标识）', magic[0] === 0x89 && magic[1] === 0x50 && magic[2] === 0x4e && magic[3] === 0x47);

  await page.getByRole('button', { name: '存为 Skills 配方' }).click();
  await page.locator('[role="dialog"]').waitFor({ timeout: 10000 });
  check('Skills 保存对话框打开（移动端）', true);
  await page.fill('#skill-title', '移动端验收配方');
  await page.getByRole('button', { name: '保存配方' }).click();
  const [dlJson] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /导出配方 JSON/ }).click(),
  ]);
  await dlJson.saveAs('skill-export.json');
  const [dlMd] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    page.getByRole('button', { name: /导出 Qoder SKILL.md/ }).click(),
  ]);
  await dlMd.saveAs('skill-export.md');
  check('JSON + SKILL.md 双导出触发', dlJson.suggestedFilename().endsWith('.json') && dlMd.suggestedFilename().endsWith('.md'));
  const sj = JSON.parse(readFileSync('skill-export.json', 'utf8'));
  check('导出 JSON 符合 tupai-skill v1', sj.format === 'tupai-skill' && sj.version === 1 && sj.title === '移动端验收配方');
  check('SKILL.md 含 frontmatter', readFileSync('skill-export.md', 'utf8').startsWith('---'));
  await page.getByRole('button', { name: '查看我的配方' }).click();
  const mySkillsDialog = page.getByRole('dialog');
  await mySkillsDialog.getByText('移动端验收配方').waitFor({ timeout: 10000 });
  check('我的配方列表可见', true);
  await mySkillsDialog.getByRole('button', { name: '套用' }).first().click();
  await page.getByText(/已套用「移动端验收配方」/).first().waitFor({ timeout: 10000 });
  check('我的配方可套用回填', (await page.inputValue('#prompt')).length > 0);
  await page.screenshot({ path: 'shot-skill-dialog-mobile.png' });
  await page.goto(BASE + '/studio', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByText('上次生成的作品还在').waitFor({ timeout: 15000 });
  check('刷新后出现上次生成入口', true);
  await page.getByRole('button', { name: '查看上次作品' }).click();
  await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 30000 });
  check('刷新后可恢复上次作品', true);
  const sidA = await page.evaluate(() => localStorage.getItem('tupai-session-id'));
  console.log('  ctxA session:', sidA);
  await a.context.close();
}

console.log('C. 图片入口（第二个全新上下文 = 无痕等效，会话隔离）');
const c = await newMobilePage();
{
  const { page } = c;
  await page.goto(BASE + '/studio?demo=night', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByText('图生图 · 有底图').waitFor({ timeout: 30000 });
  check('样例废片自动上传 → 图生图徽标', true);
  await page.getByRole('button', { name: '自动优化提示词' }).click();
  await page.getByText('候选提示词', { exact: false }).first().waitFor({ timeout: 30000 });
  check('图片入口候选渲染', true);
  check('无横向溢出', (await overflow(page)) <= 1);
  await page.screenshot({ path: 'shot-studio-image-mobile.png' });
  await page.getByRole('button', { name: '生成作品' }).click();
  await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 90000 });
  check('图片入口生成完成', true);
  const slider = page.getByLabel('修前修后对比滑杆');
  await slider.waitFor({ timeout: 15000 });
  await slider.fill('30');
  check('对比滑杆可拖动（修前修后）', (await slider.inputValue()) === '30');
  await page.screenshot({ path: 'shot-result-image-mobile.png' });
  const sidC = await page.evaluate(() => localStorage.getItem('tupai-session-id'));
  check('全新上下文生成独立会话（无痕等效）', typeof sidC === 'string' && sidC.length > 0);
  console.log('  ctxC session:', sidC);
  await c.context.close();
}

console.log('E. 模板库一点即套用 + 开始创作（F1/F6）');
const e = await newMobilePage();
{
  const { page } = e;
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  const tplBtn = page.getByRole('button', { name: /套用模板/ }).first();
  await tplBtn.waitFor({ timeout: 30000 });
  check('模板库 5 卡渲染', (await page.getByRole('button', { name: /套用模板/ }).count()) === 5);
  check('模板封面示意可见', await page.locator('img[alt*="效果示意"]').first().isVisible());
  await tplBtn.click();
  await page.waitForURL(/\/studio\?template=/, { timeout: 15000 });
  await page.locator('#prompt').waitFor({ timeout: 15000 });
  check('一点即套用填入提示词区', (await page.inputValue('#prompt')).length > 50);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('button', { name: /一键试玩/ }).click();
  await page.waitForURL(/demo=night&template=night-bright/, { timeout: 15000 });
  await page.getByText('图生图 · 有底图').waitFor({ timeout: 15000 });
  check('一键试玩直入「样例废片 + 夜景提亮」', true);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.getByRole('button', { name: '开始创作' }).click();
  await page.waitForURL(/\/studio$/, { timeout: 15000 });
  check('开始创作导航到创作台', page.url().endsWith('/studio'));
  await e.context.close();
}

console.log('F. 模板 → 底图 → 变体 → 换一批（主路径修复）');
const f = await newMobilePage();
{
  const { page } = f;
  await page.goto(BASE + '/studio?template=night-bright', { waitUntil: 'networkidle', timeout: 60000 });
  await page.locator('#prompt').waitFor({ timeout: 15000 });
  const initialPrompt = await page.inputValue('#prompt');
  check('模板无图使用文生图示意词', initialPrompt.includes('Natural-looking brightened night photograph'), initialPrompt.slice(0, 50));
  check('ready 页有上传底图入口', await page.getByRole('button', { name: '上传底图' }).isVisible());
  check('无图时变体禁用', await page.locator('#variant-select').isDisabled());
  await page.locator('input[type="file"][accept*="image"]').setInputFiles('web/public/samples/demo-night.jpg');
  await page.getByText('图生图 · 有底图').waitFor({ timeout: 15000 });
  const afterUpload = await page.inputValue('#prompt');
  check('加底图后切换为图生图提示词', afterUpload.includes('Brighten and clean up this dark night photo'), afterUpload.slice(0, 50));
  check('加底图后变体解锁', !(await page.locator('#variant-select').isDisabled()));
  await page.selectOption('#variant-select', 'rain-neon');
  const variantPrompt = await page.inputValue('#prompt');
  check('雨夜霓虹变体可套用', variantPrompt.includes('rainy-neon'), variantPrompt.slice(0, 50));
  await page.getByRole('button', { name: '换一批候选' }).click();
  await page.getByText('候选提示词', { exact: false }).first().waitFor({ timeout: 60000 });
  check('换一批保留底图', await page.getByText('图生图 · 有底图').isVisible());
  check('换一批后无横向溢出', (await overflow(page)) <= 1, `overflow=${await overflow(page)}`);
  await page.selectOption('#template-select', 'film-daily');
  const filmPrompt = await page.inputValue('#prompt');
  check('创作台内可手动切换模板', filmPrompt.includes('analog film photograph'), filmPrompt.slice(0, 50));
  await page.screenshot({ path: 'shot-template-base-mobile.png' });
  await f.context.close();
}

console.log('D. 控制台错误');
const realErrors = errors.filter(e => !/favicon|Download the React DevTools/i.test(e));
check('无页面 JS 错误', realErrors.length === 0, realErrors.slice(0, 5).join(' | '));

await browser.close();
console.log(`\n${passed}/${passed + failed} 通过`);
process.exit(failed ? 1 : 0);