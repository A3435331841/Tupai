// 技能演示种子/展示链路冒烟测试：种入 1 技能 + 2 对示例 → 列表/详情/展示图/画册分享页 校验
// 需先启动本地后端：cd 代码仓库 && deno run --allow-net=127.0.0.1:8000 --allow-read dev/function-local.ts
const BASE = 'http://127.0.0.1:8000/functions/v1/app';
const TOKEN = 'local-test-token';
const H = { 'x-maintenance-token': TOKEN, 'content-type': 'application/json' };

let pass = 0, failCount = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ok ', name); } else { failCount++; console.log('  FAIL', name); } };

function tinyJpeg() {
  // 1x1 白色 JPEG（最小合法头，够过 sniff；尺寸 1x1 合法）
  const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  return b64;
}

const r0 = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({
  skills: [{ id: 'smoke-film', title_zh: '冒烟胶片', category: '胶片质感', desc_zh: '冒烟测试技能', tags: ['胶片'], prompt: 'Transform this photo into film look.', negative_prompt: 'watermark, text', model: 'agnes-image-2.5-flash', ratio: '3:4', sort: 0 }],
}) });
ok('skills 写入 200', r0.status === 200);
const j0 = await r0.json();
ok('skills=1 templates>=1', j0.skills === 1 && j0.templates >= 1);

// 幂等重放
const r0b = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({
  skills: [{ id: 'smoke-film', title_zh: '冒烟胶片', category: '胶片质感', desc_zh: '冒烟测试技能', tags: ['胶片'], prompt: 'Transform this photo into film look.', negative_prompt: 'watermark, text', model: 'agnes-image-2.5-flash', ratio: '3:4', sort: 0 }],
}) });
const j0b = await r0b.json();
ok('skills 重放仍 200', r0b.status === 200 && j0b.skills === 1);

const b64 = tinyJpeg();
const r1 = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({
  pairs: [
    { skill_id: 'smoke-film', slot: 0, original: { b64 }, result: { b64 } },
    { skill_id: 'smoke-film', slot: 1, original: { b64 }, result: { b64 } },
  ],
}) });
const j1 = await r1.json();
ok('pairs 写入 200 且 assets=4', r1.status === 200 && j1.assets === 4 && j1.pairs === 2);
// 乱序 slot 拒绝
const r1b = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({
  pairs: [{ skill_id: 'smoke-film', slot: 0, original: { b64 }, result: { b64 } }],
}) });
ok('重复 slot 幂等跳过', r1b.status === 200 && (await r1b.json()).skipped_pairs === 1);
const r1c = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({
  pairs: [{ skill_id: 'smoke-film', slot: 5, original: { b64 }, result: { b64 } }],
}) });
ok('乱序 slot 400', r1c.status === 400);
// 无 token 404
const r1d = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok('无 token 404', r1d.status === 404);

const r2 = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify({ albums: ['smoke-film'] }) });
const j2 = await r2.json();
ok('albums 定稿 200', r2.status === 200 && j2.albums === 1);

const r3 = await fetch(`${BASE}/api/v1/showcase/skills`);
const j3 = await r3.json();
const skill = (j3.skills || []).find((s) => s.id === 'smoke-film');
ok('列表含技能且 pair_count=2', Boolean(skill) && skill.pair_count === 2);
ok('cover 双图地址', Boolean(skill.cover?.original_url && skill.cover?.result_url));

const r4 = await fetch(`${BASE}/api/v1/showcase/skills/smoke-film`);
const j4 = await r4.json();
ok('详情 pairs=2 + album.share_page', j4.pairs?.length === 2 && /^\/api\/v1\/share\/[0-9a-f]{32}\/page$/.test(j4.album?.share_page || ''));

const origUrl = j4.pairs[0].original_url;
const r5 = await fetch(`${BASE}${origUrl}`);
ok('展示图 200 image/jpeg', r5.status === 200 && (r5.headers.get('content-type') || '').includes('image/jpeg'));
// 未登记资产不可取
const r5b = await fetch(`${BASE}/api/v1/showcase/img/a_${'0'.repeat(24)}`);
ok('未登记资产 404', r5b.status === 404);

// 画册分享页与分享视图
const token = j4.album.share_token;
const r6 = await fetch(`${BASE}/api/v1/share/${token}`);
const j6 = await r6.json();
ok('分享视图 2 图', r6.status === 200 && j6.images?.length === 2);
const r6b = await fetch(`${BASE}/api/v1/share/${token}/page`);
const html = await r6b.text();
ok('翻页页含相对 img 与 AI 角标', r6b.status === 200 && html.includes('img/') && html.includes('AI 生成'));

// 模板同步（创作台可套用）
const r7 = await fetch(`${BASE}/api/v1/templates`);
const j7 = await r7.json();
ok('templates 含技能 id', (j7.templates || []).some((t) => t.id === 'smoke-film'));

console.log(`\n结果: ${pass} 通过 / ${failCount} 失败`);
process.exit(failCount ? 1 : 0);
