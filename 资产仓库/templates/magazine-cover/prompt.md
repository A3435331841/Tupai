# 杂志封面 · magazine-cover

> 首版 M0-7 · 2026-11-17 · 待样片验证

- **说明**：普通照片 → 黑白雕塑感杂志封面：强轮廓、大留白（顶部预留刊头位）、完整灰阶；文字一律后期排版，不让模型造字。
- **适用**：半身/全身人像、有清楚姿态轮廓的照片；艺术家/编辑风封面需求。
- **不适用**：依赖色彩的场景（旅行/美食）、多人合照、需要彩色产品的画面。
- **tags**: `杂志, 封面, 黑白, 人像, 编辑风, 留白`
- **features**: 彩色照片 → 黑白雕塑式封面构图，顶部留白可排刊头
- **默认参数**: ratio `3:4` · size `1K` · model `agnes-image-2.5-flash`

## 默认提示词（img2img · 英文）

```text
Transform this photo into a monochrome sculptural magazine-cover portrait. Keep the person's face, expression and outfit unchanged. Arrange body and garment as one strong readable silhouette against a minimal seamless setting, large negative space reserved at the top for future typography, soft directional key light plus a narrow separation edge, full tonal range from textured blacks to clean highlights, restrained expression, no crushed fabric detail, no flat grayscale conversion, no props, no rendered text.
```

中文对照：把照片变成黑白雕塑感杂志封面——人物脸、表情、服装不变；身体与衣物构成一个强轮廓，极简无缝背景，顶部留大片负空间供后期排刊头，柔主光+窄边光分离，从有纹理的黑到干净高光的完整灰阶，黑衣黑发保留内部层次。

## negative_prompt

```text
crushed blacks without detail, flat grayscale conversion, background merging with hair, rendered text or letters, props, ID-photo pose, plastic skin, color accents, watermark
```

## 样片生成指令（txt2img · 供 GPT/Agnes）

```text
Monochrome sculptural editorial portrait of a young East Asian man in a black structured coat, one strong silhouette against a minimal light-gray seamless backdrop, large negative space above the head, soft directional key light plus a narrow rim separation, full tonal range from textured blacks to clean highlights, visible fabric folds, restrained expression, vertical 3:4 magazine-cover composition, no text, no props.
```

> 样片要求：人物一律 AI 生成；≥2 张候选（可出一张女性版供终选）；封面示意不排真实刊头文字，留白即可。

## 灵感来源

`portrait-monochrome-sculptural` + `monochrome-editorial-city-poster` 的版式留白思路（open-image-prompts 风格卡，CC-BY-4.0 元数据层；提示词原创重写）。