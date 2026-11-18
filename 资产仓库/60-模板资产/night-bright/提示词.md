# 夜景提亮 · night-bright

> 首版 M0-7 · 2026-11-17 · 待样片验证 · 含「雨夜霓虹」风格化变体

- **说明**：暗光聚餐/夜拍废片救星——自然提亮、降噪、恢复面部细节，保留夜晚氛围；变体可升级为电影感雨夜霓虹。
- **适用**：室内暗光自拍、夜晚聚餐、街头夜拍等欠曝照片。
- **不适用**：白天照片、严重运动模糊、要求证件照级保真的场景。
- **tags**: `夜景, 提亮, 人像, 聚餐, 霓虹, 雨夜, 电影感`
- **features**: 欠曝夜景 → 明亮干净或霓虹电影感，人物面部不变
- **默认参数**: ratio `3:4` · size `1K` · model `agnes-image-2.5-flash`

## 默认提示词（img2img · 提亮主配方）

```text
Brighten and clean up this dark night photo while keeping the person's face, expression and clothing exactly unchanged. Lift the ambient exposure naturally as if soft warm practical light filled the scene, reduce noise and color cast, recover shadow detail on the face, keep background lights and signage readable with a gentle glow, preserve the original night atmosphere and the color of each light source, no daylight look, no plastic skin, no changed facial features.
```

中文对照：提亮这张暗光夜拍——人物脸、表情、衣服完全不变；像被柔和暖色实用光补亮，降噪去色偏，恢复面部暗部细节，背景灯光招牌可读带柔光，保留夜晚氛围与各光源颜色，不要变成白天。

## 变体：雨夜霓虹（风格化，二选一）

```text
Restyle this night photo into a cinematic rainy-neon portrait. Keep the person's face, expression and outfit unchanged. Cool cyan ambient light with a narrow magenta rim from physically motivated neon signs, wet-look reflections on street surfaces, soft neon bokeh in the background, deep blacks with preserved facial detail, emotionally restrained mood, no symmetrical red-blue split, no cyber implants, no plastic skin.
```

## negative_prompt

```text
daylight conversion, blown highlights, plastic skin, changed face, heavy HDR halo, amplified noise, color banding, symmetrical red-blue split, watermark, text
```

## 样片生成指令（txt2img · 两变体各 ≥1 张）

提亮版：
```text
Natural-looking brightened night photograph of a young East Asian woman at an outdoor dinner table with friends, warm practical string lights, clean low-noise image, clear facial detail in shadow areas, readable background signage with gentle glow, authentic night atmosphere preserved, vertical 3:4.
```

霓虹版：
```text
Cinematic night portrait of a young East Asian man on a rain-darkened city street, cool cyan ambient light and a narrow magenta rim from neon signs, wet asphalt reflections, soft neon bokeh behind, deep blacks with clear facial detail, restrained expression, vertical 3:4, no symmetrical red-blue split.
```

> 样片要求：人物一律 AI 生成；两变体分开出样，终选时决定变体是否独立成模板（M1-9）。

## 灵感来源

提亮主配方自写（豆包爆款「改环境」方法论，docs/08 §1）；霓虹变体参考 `portrait-neon-rain-cinematic`（CC-BY-4.0 元数据层，提示词原创重写）。