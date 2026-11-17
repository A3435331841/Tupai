// 回归：切「输入文字」标签 / 「重新开始」必须清除已上传底图，纯文字意图不得拿旧图生成。
// 运行：node dev/regression-tab-reset.mjs（默认云端；BASE=http://127.0.0.1:5173 打本地）。需 playwright。
import { chromium } from 'playwright';
const BASE = (process.env.BASE || 'https://tupai-moo3r9zpvox.qoder.zone').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', userAgent: UA });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok ', n); } else { fail++; console.log('FAIL ', n, d); } };
const genBodies = [];
page.on('request', (r) => { if (r.url().includes('/jobs/generate') && r.method() === 'POST') genBodies.push(r.postData()); });
const badgeText = () => page.getByText(/图生图 · 有底图|文生图 · 纯文字/).first().textContent();

await page.goto(BASE + '/studio?demo=night', { waitUntil: 'networkidle', timeout: 60000 });
await page.getByAltText('原图预览').waitFor({ timeout: 30000 });
await page.getByRole('button', { name: '自动优化提示词' }).click();
await page.locator('#prompt').waitFor({ timeout: 60000 });
ok('图片优化后为图生图', (await badgeText()).includes('图生图'));

await page.getByRole('button', { name: '重新开始' }).click();
ok('重新开始回到上传区（底图已清除）', await page.getByRole('button', { name: /点击选择或拖拽图片到此处/ }).isVisible());
await page.getByRole('tab', { name: '输入文字' }).click();
ok('重新开始清空文字输入', (await page.locator('#idea').inputValue()) === '');
ok('切文字标签后为文生图', (await badgeText()).includes('文生图'));
await page.fill('#idea', '一只在窗台晒太阳的橘猫');
await page.getByRole('button', { name: '自动优化提示词' }).click();
await page.locator('#prompt').waitFor({ timeout: 60000 });
ok('文字优化后仍为文生图', (await badgeText()).includes('文生图'));
await page.getByRole('button', { name: '生成作品' }).click();
await page.getByRole('button', { name: /下载成品/ }).waitFor({ timeout: 120000 });
const body = JSON.parse(genBodies[genBodies.length - 1] || '{}');
ok('纯文字生成不带旧底图 asset_id', body.asset_id === undefined, `asset_id=${body.asset_id}`);

console.log(`\n${pass}/${pass + fail} 通过`);
await browser.close();
process.exit(fail ? 1 : 0);