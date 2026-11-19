// Key 恢复探针：每 15 分钟探测全部 key（chat 1 token）；≥2 个恢复即退出码 0（供 && 链接续跑生成）
// 用法：node key恢复探针-20261120.mjs [--max-hours=6] && node agnes-批量.mjs generate ...
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOC = join(ROOT, 'docs', 'references', 'agnes-api.md');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const MAX_HOURS = Number(arg('max-hours', 6));
const INTERVAL_MIN = Number(arg('interval-min', 15));

function keys() {
  const txt = readFileSync(DOC, 'utf8');
  const rows = [...txt.matchAll(/\|\s*([^|]+)\|\s*`(sk-[A-Za-z0-9_-]{20,})`\s*\|\s*([^|]*站)\s*\|/g)];
  const seen = new Set();
  const out = [];
  for (const m of rows) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ name: m[1].trim(), key: m[2], base: /国际/.test(m[3]) ? 'https://apihub.agnes-ai.com/v1' : 'https://api.agnes-ai.cn/v1' });
  }
  return out;
}

const deadline = Date.now() + MAX_HOURS * 3600 * 1000;
let round = 0;
while (Date.now() < deadline) {
  round++;
  const healthy = [];
  for (const k of keys()) {
    try {
      const r = await fetch(k.base + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${k.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'agnes-3.0-flash', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      });
      if (r.ok) healthy.push(k.name);
    } catch { /* 网络错误不计 */ }
  }
  console.log(`[round ${round}] ${new Date().toISOString()} 健康 key: ${healthy.length}${healthy.length ? ' -> ' + healthy.join(',') : ''}`);
  if (healthy.length >= 2) {
    console.log('key 已恢复，退出以续跑生成');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MIN * 60 * 1000));
}
console.log('探针超时退出（key 未恢复）');
process.exit(2);
