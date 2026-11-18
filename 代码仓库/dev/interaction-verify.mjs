// 交互补核：覆盖 F5 推荐/一键同款、F7 字数/负面词、F10 再生成、F11 导入回填闭环。
// 运行：node dev/interaction-verify.mjs（默认本地 :5173；BASE=https://... 打云端）。需 playwright。
// 适配创作台「对话式多 Bot 编排台」DOM：左栏 Bot 列表 / 中栏对话与产物 / 右栏详情。
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const BASE = (process.env.BASE || 'http://127.0.0.1:5173').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', userAgent: UA });
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ok ', name); } else { fail++; console.log('FAIL ', name, detail); } };
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

await page.goto(BASE + '/studio?demo=text&text=' + encodeURIComponent('胶片感 旅行 傍晚暖光 人像 日常'), { waitUntil: 'networkidle', timeout: 60000 });
await page.locator('#prompt').waitFor({ timeout: 60000 });

// 触发一轮优化（小词面板「换一批候选」），拿到候选 / 推荐
await page.getByRole('button', { name: '换一批候选' }).click().catch(() => {});
await page.locator('#prompt').waitFor({ timeout: 60000 });

// F7 字数提示 + 负面词
const counter = await page.getByText(/正向提示词（\d+\/4000）/).first().textContent().catch(() => '');
ok('F7 正向字数提示 /4000', /\/4000）/.test(counter || ''), counter);
await page.getByText('负面提示词（可选）').first().click().catch(() => {});
const neg = page.locator('#negative-prompt');
await neg.fill('plastic skin, text');
ok('F7 负面词可编辑', (await neg.inputValue()) === 'plastic skin, text');

// F5 相似推荐 + 一键同款
const recSection = page.locator('section[aria-label="相似推荐"], div[aria-label="相似推荐"]');
const recCount = await recSection.locator('button', { hasText: '一键同款' }).count();
if (recCount > 0) {
  ok('F5 推荐卡渲染（含一键同款）', recCount >= 1, `n=${recCount}`);
  const coverVisible = await recSection.locator('img').first().isVisible().catch(() => false);
  ok('F5 推荐封面预览可见', coverVisible);
  const before = await page.locator('#prompt').inputValue();
  await recSection.getByRole('button', { name: '一键同款' }).first().click();
  await page.getByText(/已套用「.*」，参数可继续修改/).first().waitFor({ timeout: 10000 }).catch(() => {});
  const after = await page.locator('#prompt').inputValue();
  ok('F5 一键同款回填提示词', after.length > 0 && after !== before, `len=${after.length}`);
} else {
  ok('F5 无匹配时不显示推荐区（不挡主路径）', (await recSection.count()) === 0);
  console.log('  note 本轮真实 optimize 未触发相似推荐（空数组分支符合 F5 验收）');
}

// 生成 → F10 再生成
await page.getByRole('button', { name: '派单给小绘' }).click();
await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 120000 });
ok('F9 生成成功态出现下载', true);
const firstSrc = await page.locator('img[alt="AI 生成结果"]').getAttribute('src').catch(() => null);
ok('F9 结果图已渲染', Boolean(firstSrc));
await page.getByRole('button', { name: '再来一张' }).click();
await page.getByRole('button', { name: /出图…|下载成品/ }).waitFor({ timeout: 10000 }).catch(() => {});
await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 120000 });
ok('F10 再生成回到成功态', true);

// F11 保存 → 导出 JSON → 导入回填闭环
await page.getByRole('button', { name: '存为配方' }).click();
await page.locator('[role="dialog"]').waitFor({ timeout: 10000 });
await page.fill('#skill-title', '补核配方');
await page.getByRole('button', { name: '保存配方' }).click();
const [dj] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.getByRole('button', { name: /导出配方 JSON/ }).click(),
]);
const jsonPath = 'verify-skill.json';
await dj.saveAs(jsonPath);
const exported = JSON.parse(readFileSync(jsonPath, 'utf8'));
ok('F11 导出 JSON 含 prompt', typeof exported.prompt === 'string' && exported.prompt.length > 0);
await page.keyboard.press('Escape');
await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
await page.getByRole('button', { name: '返回修改' }).click().catch(() => {});
const importInput = page.locator('input[type="file"][accept*="json"]');
await importInput.setInputFiles(jsonPath);
await page.getByText(/已导入，上传自己的底图即可生成/).first().waitFor({ timeout: 15000 });
const importedPrompt = await page.locator('#prompt').inputValue();
ok('F11 导入回填提示词与导出一致', importedPrompt === exported.prompt, `len=${importedPrompt.length}`);

ok('D 无页面 JS 错误', errors.length === 0, errors.join('|'));
console.log(`\n${pass}/${pass + fail} 通过`);
await browser.close();
process.exit(fail ? 1 : 0);
