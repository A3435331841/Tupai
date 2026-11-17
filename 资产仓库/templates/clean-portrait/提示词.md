# 清透人像 · clean-portrait

> 首版 M0-7 · 2026-11-17 · 待样片验证

- **说明**：杂乱背景的生活照 → 安静高级的柔光棚拍人像：中性背景、大窗柔光、真实皮肤质感。
- **适用**：自拍、半身生活照、职场形象照；主体清楚但背景杂乱/光线平的照片。
- **不适用**：全身复杂姿态、多人合照、需要保留原场景叙事的照片。
- **tags**: `人像, 清透, 柔光, 棚拍, 职场, 质感`
- **features**: 杂乱背景生活照 → 中性背景柔光棚拍，皮肤纹理真实
- **默认参数**: ratio `3:4` · size `1K` · model `agnes-image-2.5-flash`

## 默认提示词（img2img · 英文）

```text
Turn this casual photo into a quiet-luxury studio portrait. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Replace the background with a seamless warm-gray studio backdrop with subtle tonal gradation, broad soft window-like side light with gentle falloff, natural skin texture with visible pores, calm relaxed posture, restrained editorial styling, visible fabric texture, no glamour props, no skin smoothing, no changed facial features.
```

中文对照：把这张生活照变成安静奢华的棚拍人像——人物脸、表情、发型、服装完全不变；背景换为有细微色阶的暖灰无缝背景纸，大窗式柔侧光自然衰减，保留真实毛孔与皮肤纹理，姿态松弛，衣料质感清楚，无浮夸道具。

## negative_prompt

```text
plastic smooth skin, harsh shadows, cluttered background, changed face, glamour props, oversaturation, flat background without gradation, watermark, text
```

## 样片生成指令（txt2img · 供 GPT/Agnes）

```text
Quiet-luxury editorial portrait of a young East Asian woman in a simple ivory wool sweater, relaxed asymmetrical pose on a wooden stool, seamless warm-gray studio backdrop with subtle tonal gradation, broad soft window-like side light, natural skin texture with visible pores, visible fabric drape, calm off-camera gaze, restrained styling, vertical 3:4, no glamour props, no plastic skin.
```

> 样片要求：人物一律 AI 生成；≥2 张候选；可另出一张炭灰/米白背景变体供终选。

## 灵感来源

`portrait-quiet-luxury-studio`（open-image-prompts 风格卡，CC-BY-4.0 元数据层；提示词原创重写）。