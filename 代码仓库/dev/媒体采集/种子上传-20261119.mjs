// 种子上传驱动：技能总表 + 语料原图 + 生成结果 → /api/v1/maintenance/seed-showcase 分批幂等写入
// 本地：BASE=http://127.0.0.1:8000/functions/v1/app  TOKEN=local-test-token（启动 function-local 时以 MAINTENANCE_TOKEN 注入）
// 生产：BASE=https://tupai-moo3r9zpvox.qoder.zone/functions/v1/app  TOKEN=<真实 MAINTENANCE_TOKEN>
// 用法：node 种子上传-20261119.mjs [--base=...] [--token=...] [--skills=技能总表.json] [--tasks=生成任务.jsonl] [--batch=4] [--albums-only] [--skills-only]
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const arg = (name, def) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : def;
};
const BASE = arg('base', 'http://127.0.0.1:8000/functions/v1/app');
const TOKEN = arg('token', process.env.MAINTENANCE_TOKEN || 'local-test-token');
const skillsFile = arg('skills', join(ROOT, '资产仓库', '20-技能资产', '自研', '图派技能库-20261119', '技能总表.json'));
const tasksFile = arg('tasks', join(ROOT, '.scratch-20261119', '生成任务.jsonl'));
const GEN_DIR = join(ROOT, '.scratch-20261119', '生成结果');
const BATCH = Number(arg('batch', 4));
const H = { 'x-maintenance-token': TOKEN, 'content-type': 'application/json' };
const stateFile = join(ROOT, '.scratch-20261119', '种子上传状态.json');

const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { skills: {}, slots: {}, albums: {} };
const saveState = (() => { let last = 0; return (force) => { const now = Date.now(); if (force || now - last > 5000) { writeFileSync(stateFile, JSON.stringify(state)); last = now; } }; })();

async function seed(body) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/v1/maintenance/seed-showcase`, { method: 'POST', headers: H, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      if (res.status === 400 || res.status === 415 || res.status === 413) throw new Error(`4xx ${JSON.stringify(json).slice(0, 200)}`);
      console.log(`  重试 ${attempt}（${res.status} ${JSON.stringify(json).slice(0, 120)}）`);
    } catch (e) {
      if (String(e.message).startsWith('4xx')) throw e;
      console.log(`  网络重试 ${attempt}: ${e.message.slice(0, 100)}`);
    }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error('连续失败');
}

const doc = JSON.parse(readFileSync(skillsFile, 'utf8'));
const skills = doc.技能 || doc.skills || doc;
console.log(`技能 ${skills.length} 个，目标 ${BASE}`);

// 1) 技能元数据
if (!arg('albums-only')) {
  for (const s of skills) {
    if (state.skills[s.id]) continue;
    await seed({ skills: [{ id: s.id, title_zh: s.name_zh, category: s.category, desc_zh: s.desc_zh, tags: s.tags, prompt: s.prompt, negative_prompt: s.negative_prompt, model: s.model, ratio: s.ratio, sort: s.sort ?? 0 }] });
    state.skills[s.id] = 1;
    saveState();
    process.stdout.write(`技能 ${s.id} ✓\n`);
  }
  console.log('技能元数据完成');
}

// 2) 示例对（原图=任务里的 image；作品=生成结果）
if (!arg('albums-only') && !arg('skills-only')) {
  const tasks = readFileSync(tasksFile, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const bySkill = new Map();
  for (const t of tasks) {
    const sid = t.id.split('--')[0];
    (bySkill.get(sid) || bySkill.set(sid, []).get(sid)).push(t);
  }
  // 配对审核排序（可选）：种子排序.json 决定每技能示例的展示顺序（封面取最高分对）
  const orderFile = join(ROOT, '.scratch-20261119', '种子排序.json');
  const orderDoc = existsSync(orderFile) ? JSON.parse(readFileSync(orderFile, 'utf8')) : null;
  for (const [sid, list0] of bySkill) {
    let list = list0;
    const ord = orderDoc?.顺序?.[sid];
    if (Array.isArray(ord) && ord.length === list0.length) {
      const map = new Map(list0.map((t) => [t.id, t]));
      const ordered = ord.map((id) => map.get(id)).filter(Boolean);
      if (ordered.length === list0.length) list = ordered;
    }
    for (let slot = 0; slot < list.length; slot++) {
      const key = `${sid}#${slot}`;
      if (state.slots[key]) continue;
      const t = list[slot];
      // 生成结果优先取转码后的 .jpg（转换脚本产出），否则用任务里的 .png
      const jpgPath = join(GEN_DIR, t.out.replace(/\.png$/i, '.jpg'));
      const outPath = existsSync(jpgPath) ? jpgPath : join(GEN_DIR, t.out);
      if (!existsSync(outPath) || statSync(outPath).size < 10000) continue; // 生成未完成，跳过（之后重跑）
      const pairs = [];
      for (let i = slot; i < Math.min(slot + BATCH, list.length); i++) {
        const ti = list[i];
        const oiJpg = join(GEN_DIR, ti.out.replace(/\.png$/i, '.jpg'));
        const oi = existsSync(oiJpg) ? oiJpg : join(GEN_DIR, ti.out);
        if (!existsSync(oi) || statSync(oi).size < 10000) break;
        const ik = `${sid}#${i}`;
        if (state.slots[ik]) continue;
        pairs.push({
          skill_id: sid, slot: i,
          original: { b64: readFileSync(ti.image).toString('base64'), mime: ti.image.endsWith('.png') ? 'image/png' : 'image/jpeg' },
          result: { b64: readFileSync(oi).toString('base64'), mime: oi.endsWith('.png') ? 'image/png' : 'image/jpeg' },
        });
      }
      if (!pairs.length) continue;
      const r = await seed({ pairs });
      for (const p of pairs) state.slots[`${sid}#${p.slot}`] = 1;
      saveState();
      console.log(`对 ${sid} slot ${pairs[0].slot}-${pairs[pairs.length - 1].slot} ✓ (assets=${r.assets})`);
      await new Promise((rr) => setTimeout(rr, 300));
    }
  }
  console.log('示例对完成');
}

// 3) 画册定稿
if (!arg('skills-only')) {
  const ids = skills.map((s) => s.id);
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const r = await seed({ albums: chunk });
    console.log(`画册定稿 ${chunk.length} 个（albums=${r.albums}）`);
  }
  saveState(true);
}

console.log('种子上传完成：', BASE);
