---
name: tupai-film-daily-travel
description: 图派配方「胶片日常·旅行」——把日光旅行随拍变成 Portra 胶片氛围照，人物不变。用户提供底图后按配方生成。
---

# 胶片日常·旅行（图派 Skills 导出）

来源：图派 TuPai · tupai-skill-v1 · 模板 film-daily

## 使用步骤

1. 请用户提供一张自己的底图（日光/傍晚生活照、旅行随拍）。
2. 以底图为参考图（图生图），使用下方提示词生成；比例 3:4。
3. 模型：`agnes-image-2.5-flash`（或用户指定的等效图像模型）。
4. 结果交给用户挑选；不满意可微调提示词重试。

## 提示词

```text
Transform this everyday snapshot into a candid analog film photograph. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Late-afternoon warm backlight, Kodak Portra-like color response, fine film grain, off-center framing, no orange wash, no plastic skin.
```

## 负面词

```text
orange color wash, fake light leaks, plastic smooth skin, changed facial features, watermark, text
```

## 约束

- 不改变人物面部、表情、发型与服装。
- 不内嵌他人原图；底图必须由当前用户提供。
- 输出注明 AI 生成。