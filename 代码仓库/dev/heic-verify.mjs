// HEIC 跨浏览器转换验证（修复记录⑪）：Chromium 原生不解 HEIC，须 heic2any(libheif) 解码。
// 失败路径必测；成功路径设 HEIC_FIXTURE=<真实.heic路径> 启用（避免第三方照片夹具入库）。
// 运行：node dev/heic-verify.mjs（默认云端；BASE=http://127.0.0.1:5173 打本地）。需 playwright。
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const BASE = (process.env.BASE || 'https://tupai-moo3r9zpvox.qoder.zone').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN', userAgent: UA });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok ', n); } else { fail++; console.log('FAIL ', n, d); } };
const drop = (name, type, bytes) => page.evaluate(({ name, type, bytes }) => {
  const dt = new DataTransfer();
  dt.items.add(new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], name, { type }));
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('点击选择或拖拽图片到此处'));
  el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
}, { name, type, bytes });

await page.goto(BASE + '/studio', { waitUntil: 'networkidle', timeout: 60000 });
await page.getByRole('button', { name: /点击选择或拖拽图片到此处/ }).waitFor({ timeout: 15000 });

// 失败路径：非法 HEIC 数据须可读引导，不静默
await drop('bad.heic', 'image/heic', btoa('not-a-heic'));
await page.getByText('HEIC 转换失败，请先在相册导出为 JPG 后重试').waitFor({ timeout: 15000 });
ok('非法 HEIC 有可读失败引导', true);

// 成功路径：真实 HEIC 在 Chromium 自动转换入场
const fixture = process.env.HEIC_FIXTURE;
if (fixture && existsSync(fixture)) {
  const b64 = readFileSync(fixture).toString('base64');
  await drop('ok.heic', 'image/heic', b64);
  await page.getByAltText('原图预览').waitFor({ timeout: 45000 });
  ok('真实 HEIC 在 Chromium 自动转换入场', true);
} else {
  console.log('  skip 真实 HEIC 成功转换（设 HEIC_FIXTURE=<真实.heic路径> 启用）');
}

console.log(`\n${pass}/${pass + fail} 通过`);
await browser.close();
process.exit(fail ? 1 : 0);