# 胶片日常 · film-daily

> 首版 M0-7 · 2026-11-17 · 待样片验证（M0-8 用户 GPT / Agnes 双通道）

- **说明**：把日常随手拍变成「朋友抓拍」式的胶片氛围照——暖逆光、Portra 色感、细颗粒，人物不变。
- **适用**：咖啡馆、街头、旅行、公园等日光或傍晚生活照；构图平庸但主体清楚的照片。
- **不适用**：夜景暗光（用夜景提亮）、需要棚拍质感（用清透人像）、主体模糊到无法辨认的照片。
- **tags**: `胶片, 日常, 逆光, 暖调, 人像, 旅行, 咖啡馆`
- **features**: 日光生活照 → 暖逆光胶片氛围，保留人物与场景可读性
- **默认参数**: ratio `3:4` · size `1K` · model `agnes-image-2.5-flash`

## 默认提示词（img2img · 英文）

```text
Transform this everyday snapshot into a candid analog film photograph. Keep the person's face, expression, hairstyle and outfit exactly unchanged. Late-afternoon warm backlight with a gentle golden rim on hair and shoulders, slightly cool shadows, Kodak Portra-like color response with warm natural skin tones, fine organic film grain, subtle lens softness toward the edges, organic off-center framing as if observed rather than posed, background remains readable with gentle depth, no orange wash, no fake light leaks, no plastic skin.
```

中文对照：把这张日常随拍变成胶片抓拍感——人物脸、表情、发型、服装完全不变；傍晚暖逆光给发丝肩膀镀金边，阴影略偏青，Portra 式暖肤色，细颗粒，边缘轻微镜头软化，构图像被观察而非摆拍，背景仍可读。

## negative_prompt

```text
orange color wash, fake light leaks, plastic smooth skin, over-sharpening, changed facial features, changed outfit, studio backdrop, heavy vignette, watermark, text
```

## 样片生成指令（txt2img · 供 GPT/Agnes 出封面与样片）

```text
Candid analog film photograph of a young East Asian woman laughing while holding a paper coffee cup at a sunlit street cafe, late-afternoon backlight with golden rim light on her hair, slightly cool shadows, Kodak Portra color response, warm natural skin tones, fine film grain, off-center observational framing, readable street background with gentle depth, vertical 3:4, no orange wash, no fake light leaks.
```

> 样片要求：画面人物一律 AI 生成，不用真人照片；≥2 张候选（M0-8）；终选后放 `samples/` 并出 `cover.png`。

## 灵感来源

`portrait-analog-golden-lifestyle`（open-image-prompts 风格卡，CC-BY-4.0 元数据层；提示词为图派原创重写，未搬运原文）。方法论依据：docs/08 §1.2「改环境不改主体 + 保留约束句」。