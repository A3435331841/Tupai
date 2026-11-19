import { toDataUrl } from './util.mjs';

const OPTIMIZE_TIMEOUT_MS = 25_000;
const GENERATE_TIMEOUT_MS = 45_000;
const RESULT_DOWNLOAD_TIMEOUT_MS = 30_000;

const PRESERVE = "Keep the person's face, facial features, expression, hairstyle and outfit exactly unchanged.";
const SCENE_PRESERVE = 'Keep the scene layout, objects, lighting and background unchanged; do not add people.';

function optimizeInstruction(count, hasImage) {
  const shape = `{"candidates":[{"summary_zh":"...","prompt":"...","negative_prompt":"...","style_tags":["..."]}],"tags":["..."]}`;
  if (hasImage) {
    return [
      '你是照片二次创作提示词专家。分析这张照片（主体/场景/光线/问题），产出可直接用于图生图模型的英文提示词。',
      `输出严格 JSON（不要 markdown 代码块），结构：${shape}`,
      `candidates 恰好 ${count} 条，每条是「单任务变体」：只改环境/光线/风格，绝不改人物主体。`,
      '每条候选必须有 summary_zh：一句中文（不超过 40 字），说明这条会改什么、会保留什么，供普通用户判断。',
      `若画面中有人物，prompt 必须包含保留约束句："${PRESERVE}"；若没有人像，改用："${SCENE_PRESERVE}"`,
      'prompt 用英文、具体、可执行（光线方向/色温/质感/氛围），negative_prompt 列出不想要的伪影。',
      'style_tags 用中文短词（如 胶片/夜景/人像/旅行/提亮/杂志）。tags 是整张照片的风格/场景/主体标签（中文，5–10 个），用于相似模板检索。',
      '只输出 JSON。',
    ].join('\n');
  }
  return [
    '你是出图提示词专家。把用户的中文想法扩写为可直接用于文生图模型的英文提示词。',
    `输出严格 JSON（不要 markdown 代码块），结构：${shape}`,
    `candidates 恰好 ${count} 条，每条是同一意图的不同风格变体（单任务，不叠加多个改造）。`,
    '每条候选必须有 summary_zh：一句中文（不超过 40 字），说明这条会改什么、会保留什么，供普通用户判断。',
    '若涉及人物，prompt 必须包含保留约束句（文生图场景指人物自然真实）："Keep any person natural and realistic, with consistent facial features and hands."',
    'prompt 用英文、具体（构图/光线/色彩/质感/氛围）；negative_prompt 列出伪影；style_tags 用中文短词。',
    'tags 是意图的风格/场景/主体标签（中文，5–10 个），用于相似模板检索。只输出 JSON。',
  ].join('\n');
}

function parseCandidates(text, count) {
  let raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) raw = raw.slice(start, end + 1);
  const obj = JSON.parse(raw);
  if (!Array.isArray(obj.candidates) || !obj.candidates.length) throw new Error('bad_shape');
  const candidates = obj.candidates.slice(0, count).map((c) => {
    const styleTags = Array.isArray(c.style_tags) ? c.style_tags.map(String).slice(0, 8) : [];
    const summary = String(c.summary_zh || '').trim().slice(0, 80) || styleTags.join('、') || '风格变体';
    return {
      summary_zh: summary,
      prompt: String(c.prompt || '').slice(0, 4000),
      negative_prompt: String(c.negative_prompt || '').slice(0, 1000),
      style_tags: styleTags,
    };
  }).filter((c) => c.prompt.length > 10);
  if (!candidates.length) throw new Error('empty_candidates');
  const tags = Array.isArray(obj.tags) ? obj.tags.map(String).slice(0, 12) : [];
  return { candidates, tags };
}

export function createAgnesProvider(scheduler, fetchImpl) {
  async function callJson(path, body, timeoutMs) {
    let lastOutcome = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const key = await scheduler.acquire();
      if (!key) return { busy: true };
      let res;
      try {
        res = await fetchImpl(key.base + path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key.key}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        await key.release('network');
        lastOutcome = 'network';
        continue;
      }
      if (res.status === 429 || res.status === 402 || res.status === 401) {
        await key.release(res.status);
        lastOutcome = res.status;
        continue;
      }
      if (!res.ok) {
        await key.release('error');
        const err = new Error('upstream_' + res.status);
        err.status = res.status;
        throw err;
      }
      await key.release('ok');
      return { json: await res.json(), keyAlias: key.alias };
    }
    // 网络不可达视为失败，避免把真实故障伪装成「演示占位图」并消耗用户信任
    if (lastOutcome === 'network') throw new Error('upstream_network');
    return { busy: true, lastOutcome };
  }

  async function optimize({ imageBytes, imageMime, text, count }) {
    const content = [];
    if (imageBytes) content.push({ type: 'image_url', image_url: { url: toDataUrl(imageBytes, imageMime) } });
    content.push({ type: 'text', text: optimizeInstruction(count, Boolean(imageBytes)) + (text ? `\n用户想法：${text.slice(0, 500)}` : '') });
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await callJson('/chat/completions', {
        model: 'agnes-3.0-flash',
        messages: [{ role: 'user', content }],
        max_tokens: 2048,
      }, OPTIMIZE_TIMEOUT_MS);
      if (r.busy) return { busy: true };
      const msg = r.json?.choices?.[0]?.message || {};
      const textOut = msg.content || msg.reasoning_content || '';
      try { return { ...parseCandidates(textOut, count), keyAlias: r.keyAlias }; }
      catch { /* retry once, then caller falls back */ }
    }
    return { parseFailed: true };
  }

  async function generate({ prompt, negativePrompt, model, ratio, baseImage }) {
    const extraBody = { response_format: 'url' };
    if (baseImage) extraBody.image = [toDataUrl(baseImage.bytes, baseImage.mime)];
    const fullPrompt = negativePrompt ? `${prompt}\nAvoid these artifacts: ${negativePrompt}` : prompt;
    const r = await callJson('/images/generations', {
      model, prompt: fullPrompt, size: '1K', ratio, extra_body: extraBody,
    }, GENERATE_TIMEOUT_MS);
    if (r.busy) return { busy: true };
    const url = r.json?.data?.[0]?.url;
    if (!url || typeof url !== 'string') throw new Error('no_result_url');
    let res;
    try {
      res = await fetchImpl(url, { signal: AbortSignal.timeout(RESULT_DOWNLOAD_TIMEOUT_MS) });
    } catch { throw new Error('result_download_failed'); }
    if (!res.ok) throw new Error('result_download_failed');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 25 * 1024 * 1024) throw new Error('result_download_failed');
    const mime = (res.headers.get('content-type') || 'image/png').split(';')[0].trim();
    return { bytes: buf, mime, keyAlias: r.keyAlias };
  }

  async function safety({ imageBytes, imageMime }) {
    const content = [];
    if (imageBytes) content.push({ type: 'image_url', image_url: { url: toDataUrl(imageBytes, imageMime) } });
    content.push({ type: 'text', text: '你是内容安全审核员。判断这张图片是否包含色情裸露、血腥暴力、或未经授权的真人肖像侵权。只输出 JSON：{"safe":true} 或 {"safe":false,"reason":"简短中文原因"}。不要 markdown 代码块。' });
    const r = await callJson('/chat/completions', {
      model: 'agnes-3.0-flash', messages: [{ role: 'user', content }], max_tokens: 200,
    }, OPTIMIZE_TIMEOUT_MS);
    if (r.busy) return { busy: true };
    const msg = r.json?.choices?.[0]?.message || {};
    const t = String(msg.content || msg.reasoning_content || '');
    try {
      const m = t.match(/\{[\s\S]*\}/);
      const o = JSON.parse(m ? m[0] : t);
      return { safe: o.safe !== false, reason: String(o.reason || '').slice(0, 120) };
    } catch { return { parseFailed: true }; }
  }

  return { optimize, generate, safety };
}