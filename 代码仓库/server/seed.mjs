// First-batch templates (融合版, finalized 2026-11-17). Prompts are TuPai originals;
// visual grammar distilled from open-image-prompts style cards (CC-BY-4.0 metadata layer).
export const TEMPLATES = [
  {
    id: 'film-daily', title: '胶片日常', sort: 1,
    description: '日常随手拍变「朋友抓拍」式胶片氛围照：暖逆光、Portra 色感、细颗粒，人物不变。',
    prompt: "Transform this everyday snapshot into a candid analog film photograph. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Late-afternoon warm backlight with a gentle golden rim on hair and shoulders, slightly cool shadows, Kodak Portra-like color response with warm natural skin tones, fine organic film grain, subtle lens softness toward the edges, organic off-center framing as if observed rather than posed, background remains readable with gentle depth, no orange wash, no fake light leaks, no plastic skin.",
    negative_prompt: 'orange color wash, fake light leaks, plastic smooth skin, over-sharpening, changed facial features, changed outfit, studio backdrop, heavy vignette, watermark, text',
    default_model: 'agnes-image-2.5-flash', ratio: '3:4',
    tags: ['胶片', '日常', '逆光', '暖调', '人像', '旅行', '咖啡馆'],
    features: '日光生活照 → 暖逆光胶片氛围，保留人物与场景可读性',
    sample_prompt: 'Candid analog film photograph of a young East Asian woman laughing while holding a paper coffee cup at a sunlit street cafe, late-afternoon backlight with golden rim light on her hair, slightly cool shadows, Kodak Portra color response, warm natural skin tones, fine film grain, off-center observational framing, readable street background with gentle depth, vertical 3:4, no orange wash, no fake light leaks.',
  },
  {
    id: 'night-bright', title: '夜景提亮', sort: 2,
    description: '暗光聚餐/夜拍废片救星：自然提亮、降噪、恢复面部细节，保留夜晚氛围；可选雨夜霓虹变体。',
    prompt: "Brighten and clean up this dark night photo while keeping the person's face, expression and clothing exactly unchanged. Lift the ambient exposure naturally as if soft warm practical light filled the scene, reduce noise and color cast, recover shadow detail on the face, keep background lights and signage readable with a gentle glow, preserve the original night atmosphere and the color of each light source, no daylight look, no plastic skin, no changed facial features.",
    negative_prompt: 'daylight conversion, blown highlights, plastic skin, changed face, heavy HDR halo, amplified noise, color banding, symmetrical red-blue split, watermark, text',
    default_model: 'agnes-image-2.5-flash', ratio: '3:4',
    tags: ['夜景', '提亮', '人像', '聚餐', '霓虹', '雨夜', '电影感'],
    features: '欠曝夜景 → 明亮干净或霓虹电影感，人物面部不变',
    sample_prompt: 'Natural-looking brightened night photograph of a young East Asian woman at an outdoor dinner table with friends, warm practical string lights, clean low-noise image, clear facial detail in shadow areas, readable background signage with gentle glow, authentic night atmosphere preserved, vertical 3:4.',
    variants: [
      {
        id: 'rain-neon', label: '雨夜霓虹',
        prompt: "Restyle this night photo into a cinematic rainy-neon portrait. Keep the person's face, expression and outfit unchanged. Cool cyan ambient light with a narrow magenta rim from physically motivated neon signs, wet-look reflections on street surfaces, soft neon bokeh in the background, deep blacks with preserved facial detail, emotionally restrained mood, no symmetrical red-blue split, no cyber implants, no plastic skin.",
        negative_prompt: 'symmetrical red-blue split, cyber implants, plastic skin, changed facial features, daylight look, watermark, text',
      },
    ],
  },
  {
    id: 'clean-portrait', title: '清透人像', sort: 3,
    description: '杂乱背景生活照变安静高级的柔光棚拍人像：中性背景、大窗柔光、真实皮肤质感。',
    prompt: "Turn this casual photo into a quiet-luxury studio portrait. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Replace the background with a seamless warm-gray studio backdrop with subtle tonal gradation, broad soft window-like side light with gentle falloff, natural skin texture with visible pores, calm relaxed posture, restrained editorial styling, visible fabric texture, no glamour props, no skin smoothing, no changed facial features.",
    negative_prompt: 'plastic smooth skin, harsh shadows, cluttered background, changed face, glamour props, oversaturation, flat background without gradation, watermark, text',
    default_model: 'agnes-image-2.5-flash', ratio: '3:4',
    tags: ['人像', '清透', '柔光', '棚拍', '职场', '质感'],
    features: '杂乱背景生活照 → 中性背景柔光棚拍，皮肤纹理真实',
    sample_prompt: 'Quiet-luxury editorial portrait of a young East Asian woman in a simple ivory wool sweater, relaxed asymmetrical pose on a wooden stool, seamless warm-gray studio backdrop with subtle tonal gradation, broad soft window-like side light, natural skin texture with visible pores, visible fabric drape, calm off-camera gaze, restrained styling, vertical 3:4, no glamour props, no plastic skin.',
  },
  {
    id: 'travel-postcard', title: '旅行明信片', sort: 4,
    description: '灰蒙蒙旅行随拍变黄金时刻电影感明信片：暖金光、空气透视、通向远方的视觉路径。',
    prompt: 'Transform this travel snapshot into a cinematic golden-hour postcard. Keep any people in the frame unchanged in face, pose and clothing. Re-light the scene with low warm golden-hour light entering from one side, slightly cool shadows, thin atmospheric haze separating foreground, midground and distant layers, a readable visual path leading toward the distant landmark, restrained warm highlights, believable natural detail, calm expansive mood, no orange wash, no artificial HDR halo, no added buildings or people.',
    negative_prompt: 'orange wash, fake HDR halo, sun centered in frame, added people, warped landmark, oversharpening, photographic collage, invented text, logo, watermark',
    default_model: 'agnes-image-2.5-flash', ratio: '3:4',
    tags: ['旅行', '风景', '黄金时刻', '明信片', '城市', '地标'],
    features: '平淡旅行照 → 黄金时刻三层景深电影感，或复古插画明信片',
    sample_prompt: 'Cinematic golden-hour landscape of a lakeside mountain village, tactile foreground of wildflowers and rocks leading along a path toward distant peaks, low warm side light, thin haze separating three depth layers, slightly cool shadows, calm expansive mood, vertical 3:4, no text, no orange wash.',
    variants: [
      {
        id: 'retro-postcard', label: '复古明信片',
        prompt: 'Restyle this travel photo into a vintage mid-century travel postcard illustration: one iconic landmark as a heroic simplified silhouette against a simple sun-and-sky field, limited screen-print palette of three to four inks such as vermilion, teal and cream, cream paper border, subtle halftone and worn lithographic grain, optimistic mood, clean empty title band at the bottom, no invented text, no logo.',
        negative_prompt: 'photorealism, invented text, logo, watermark, extra people, warped landmark, oversaturation',
      },
    ],
  },
  {
    id: 'magazine-cover', title: '杂志封面', sort: 5,
    description: '普通照片变黑白雕塑感杂志封面：强轮廓、顶部大留白预留刊头位、完整灰阶；文字后期排版。',
    prompt: "Transform this photo into a monochrome sculptural magazine-cover portrait. Keep the person's face, expression and outfit unchanged. Arrange body and garment as one strong readable silhouette against a minimal seamless setting, large negative space reserved at the top for future typography, soft directional key light plus a narrow separation edge, full tonal range from textured blacks to clean highlights, restrained expression, no crushed fabric detail, no flat grayscale conversion, no props, no rendered text.",
    negative_prompt: 'crushed blacks without detail, flat grayscale conversion, background merging with hair, rendered text or letters, props, ID-photo pose, plastic skin, color accents, watermark',
    default_model: 'agnes-image-2.5-flash', ratio: '3:4',
    tags: ['杂志', '封面', '黑白', '人像', '编辑风', '留白'],
    features: '彩色照片 → 黑白雕塑式封面构图，顶部留白可排刊头',
    sample_prompt: 'Monochrome sculptural editorial portrait of a young East Asian man in a black structured coat, one strong silhouette against a minimal light-gray seamless backdrop, large negative space above the head, soft directional key light plus a narrow rim separation, full tonal range from textured blacks to clean highlights, visible fabric folds, restrained expression, vertical 3:4 magazine-cover composition, no text, no props.',
  },
];

export async function ensureSeeded(db) {
  const existing = await db.from('templates').select('id', { count: 'exact' }).limit(1);
  if (!existing.error && Number.isSafeInteger(existing.count) && existing.count >= TEMPLATES.length) return;
  for (const t of TEMPLATES) {
    await db.from('templates').insertIfAbsent({
      id: t.id, title: t.title, description: t.description, cover_asset_id: null,
      prompt: t.prompt, negative_prompt: t.negative_prompt, default_model: t.default_model,
      ratio: t.ratio, tags: t.tags, features: t.features, sort: t.sort,
    }, { onConflict: 'id' });
  }
}