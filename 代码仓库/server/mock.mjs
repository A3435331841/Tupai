// Demo fallback when the whole key pool is cooling or unconfigured. Clearly labeled, never silent.
const PRESERVE = "Keep the person's face, facial features, expression, hairstyle and outfit exactly unchanged.";

export function mockOptimize({ text, count, tagsHint }) {
  const base = tagsHint?.length ? tagsHint : ['胶片', '日常', '人像'];
  const variants = [
    { prompt: `Transform this snapshot into a warm candid analog film photograph. ${PRESERVE} Late-afternoon golden backlight, Kodak Portra-like colors, fine organic grain, natural skin tones, shallow depth of field.`, negative_prompt: 'orange wash, fake light leaks, plastic skin, distorted face, extra fingers', style_tags: ['胶片', '暖调'] },
    { prompt: `Relight this photo as a clean bright editorial portrait. ${PRESERVE} Soft diffused window light from one side, airy neutral background, gentle contrast, true-to-life colors, crisp but natural detail.`, negative_prompt: 'harsh flash, overexposure, heavy makeup filter, warped features', style_tags: ['清透', '提亮'] },
    { prompt: `Turn this scene into a cinematic travel postcard. ${PRESERVE} Low golden-hour sun, thin atmospheric haze, three readable depth layers, restrained warm highlights and cool shadows, expansive calm mood.`, negative_prompt: 'fake HDR halo, oversaturated sky, cluttered background, text overlay', style_tags: ['旅行', '电影感'] },
    { prompt: `Restyle this photo as a premium monochrome magazine cover. ${PRESERVE} High-contrast black-and-white treatment, sculptural side light, generous negative space for typography, subtle print grain.`, negative_prompt: 'color accents, busy props, low contrast grey mush, invented text', style_tags: ['杂志', '黑白'] },
  ];
  const candidates = [];
  for (let i = 0; i < count; i++) candidates.push({ ...variants[i % variants.length] });
  if (text) candidates[0].prompt += ` User intent: ${text.slice(0, 200)}.`;
  return { candidates, tags: base, mock: true };
}

export function mockGenerate({ prompt }) {
  const label = '演示模式 · AI 服务繁忙时的占位结果';
  const escaped = String(prompt || '').slice(0, 120).replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="864" height="1152" viewBox="0 0 864 1152">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f5e9d7"/><stop offset="0.5" stop-color="#e8d5c4"/><stop offset="1" stop-color="#c9a689"/>
</linearGradient></defs>
<rect width="864" height="1152" fill="url(#g)"/>
<circle cx="620" cy="300" r="150" fill="#fff7ea" opacity="0.75"/>
<rect x="80" y="820" width="704" height="4" fill="#8a6f52" opacity="0.5"/>
<text x="432" y="540" font-family="sans-serif" font-size="44" fill="#5c4a35" text-anchor="middle">${label}</text>
<text x="432" y="620" font-family="sans-serif" font-size="24" fill="#7a654c" text-anchor="middle">AI 生成 · 演示占位图</text>
<text x="432" y="880" font-family="sans-serif" font-size="20" fill="#7a654c" text-anchor="middle">${escaped}</text>
</svg>`;
  return { bytes: new TextEncoder().encode(svg), mime: 'image/svg+xml', mock: true };
}