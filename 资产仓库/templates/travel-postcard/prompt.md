# 旅行明信片 · travel-postcard

> 首版 M0-7 · 2026-11-17 · 待样片验证 · 含「复古明信片」插画变体

- **说明**：灰蒙蒙的旅行随拍 → 黄金时刻电影感明信片：暖金光、空气透视、通向远方的视觉路径；变体可做复古丝网印明信片。
- **适用**：风景、地标、旅途街景；有人物时人物保持不变。
- **不适用**：纯人像特写（用清透人像/胶片日常）、夜景（用夜景提亮）、需要文字排版的成品海报（文字后期加）。
- **tags**: `旅行, 风景, 黄金时刻, 明信片, 城市, 地标`
- **features**: 平淡旅行照 → 黄金时刻三层景深电影感，或复古插画明信片
- **默认参数**: ratio `3:4` · size `1K` · model `agnes-image-2.5-flash`

## 默认提示词（img2img · 英文）

```text
Transform this travel snapshot into a cinematic golden-hour postcard. Keep any people in the frame unchanged in face, pose and clothing. Re-light the scene with low warm golden-hour light entering from one side, slightly cool shadows, thin atmospheric haze separating foreground, midground and distant layers, a readable visual path leading toward the distant landmark, restrained warm highlights, believable natural detail, calm expansive mood, no orange wash, no artificial HDR halo, no added buildings or people.
```

中文对照：把旅行随拍变成黄金时刻电影明信片——画面中人物的脸、姿态、服装不变；低角度暖金光从一侧进入，阴影略冷，薄雾分出前中远三层，有通向远方地标的视觉路径，暖高光克制，自然细节可信，辽阔安静。

## 变体：复古明信片（插画化，二选一）

```text
Restyle this travel photo into a vintage mid-century travel postcard illustration: one iconic landmark as a heroic simplified silhouette against a simple sun-and-sky field, limited screen-print palette of three to four inks such as vermilion, teal and cream, cream paper border, subtle halftone and worn lithographic grain, optimistic mood, clean empty title band at the bottom, no invented text, no logo.
```

## negative_prompt

```text
orange wash, fake HDR halo, sun centered in frame, added people, warped landmark, oversharpening, photographic collage, invented text, logo, watermark
```

## 样片生成指令（txt2img · 两变体各 ≥1 张）

黄金时刻版：
```text
Cinematic golden-hour landscape of a lakeside mountain village, tactile foreground of wildflowers and rocks leading along a path toward distant peaks, low warm side light, thin haze separating three depth layers, slightly cool shadows, calm expansive mood, vertical 3:4, no text, no orange wash.
```

复古版：
```text
Vintage mid-century travel postcard illustration of a lakeside mountain village, one heroic simplified landmark silhouette against a large sun disc, limited screen-print palette of vermilion, teal, navy and cream, cream paper border, subtle halftone grain, clean empty title band at the bottom, vertical 3:4, no invented text, no logo.
```

> 样片要求：一律 AI 生成；变体终选时决定是否独立成模板（M1-9）。

## 灵感来源

`landscape-golden-hour-wilderness` + `retro-city-travel-poster`（open-image-prompts 风格卡，CC-BY-4.0 元数据层；提示词原创重写）。