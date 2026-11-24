---
name: 胶片日常·旅行
description: 图派（TuPai）出图配方：适合日光旅行随拍。用于把日常照片二次创作为可发布的作品；提示词与参数可直接复用。
---

# 胶片日常·旅行

把日常照片二次创作为愿意发出去的作品。本技能由图派（TuPai）导出，格式 tupai-skill-v1。

## 使用方法

1. 准备一张自己的底图（人物主体清晰；本配方只改环境/光线/风格，不改主体）。
2. 调用图生图模型，传入下方提示词与参数；无底图时按文生图使用。
3. 不满意可再生成 3–5 次；仍不行就换一条候选思路，不要叠加多个改造任务。

## 提示词

```text
Transform this everyday snapshot into a candid analog film photograph. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Late-afternoon warm backlight, Kodak Portra-like color response, fine film grain, off-center framing, no orange wash, no plastic skin.
```

## 负面提示词

```text
orange color wash, fake light leaks, plastic smooth skin, changed facial features, watermark, text
```

## 参数

- 模型：`agnes-image-2.5-flash`
- 画幅比例：`3:4`
- 尺寸档位：`1K`
- 来源模板：`film-daily`

## 备注

适合日光旅行随拍

## 边界

- 保留人物脸部、表情、发型与服装不变；只做环境/光线/风格改造。
- 结果发布时标注「AI 生成」；不公开他人原图。
