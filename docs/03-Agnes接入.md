# 图派 · Agnes 接入文档

> 版本 v3.1 · 2026-11-17 · 面向实现的接入摘要。实测手册与 Key 原文离线保存、不入仓库。
> ⚠️ Key 一律存 Sites Secret、仅云函数可读：**不进仓库、不进前端、不外传**。

## 1. 站点与认证

| | 中国站 | 国际站 |
|---|---|---|
| Base URL | `https://api.agnes-ai.cn/v1` | `https://apihub.agnes-ai.com/v1` |
| Key 归属 | 6 个（别名脱敏，按站点分组） | 4 个（别名脱敏，按站点分组） |

- 认证：`Authorization: Bearer sk-xxx`。
- **Key 与站点不互通**，打错站返回 401。Key 池按站点分组，请求配对。
- 免费档 **20 RPM/key**，超限 429。

## 2. 只用这些免费模型

| 用途 | 模型 | 接口 |
|---|---|---|
| 出图（主力） | `agnes-image-2.5-flash` | `POST /images/generations`（同步，约 8–20s） |
| 出图（切换项） | `agnes-image-2.1-flash` | 同上 |
| 视觉反推 | `agnes-3.0-flash`（视觉理解） | `POST /chat/completions` |
| 备用文本 | `agnes-2.5-flash` | 同上（注意隐式推理坑，见 §5） |

**禁用付费模型**：`agnes-2.5-pro*`、`agnes-3.0-pro`、`agnes-video-2.5`。代码中模型白名单硬校验。
（`agnes-image-2.0-flash` 仅国际站免费，可作第三备选；视频模型一期不用。）

## 3. 出图：generate 映射

```
POST {BASE}/images/generations
{
  "model": "agnes-image-2.5-flash",
  "prompt": "<用户提示词>",
  "size": "1K",
  "ratio": "3:4",
  "extra_body": {
    "image": ["data:image/png;base64,<用户原图>"],   // 图生图；也收公网URL
    "response_format": "url"
  }
}
→ { "data": [{ "url": "https://cos-platform-outputs.agnes-ai.cn/..." }], "task_id": "..." }
```

要点：
- **图生图放 `extra_body.image`**（字符串数组，1~N 张，前 3 张参考免费）；不传 `tags`。
- `response_format` 必须在 `extra_body` 内，放顶层无效。
- `size` 用档位 `1K/2K/3K/4K`；`ratio` 支持 1:1 / 3:4 / 4:3 / 16:9 / 9:16 / 2:3 / 3:2 / 21:9。
- **原图用 base64 data URL 直传**，避免原图落公网（隐私设计，见开发文档 §4.2）。
- 同步返回但耗时 8–20s → 服务端包成异步 Job，前端轮询；云函数超时上限需 M0 确认，不够则分段。
- 返回的 COS URL 是公开的 → **立即下载转存 Sites 存储**，前端只展示本站 URL。

## 4. 视觉理解：optimize / tags 映射

同一调用模式服务三个功能：**自动 prompt 优化**（图片→候选提示词）、**相似检索打标**（图片/文字→风格标签）、链接解析后的素材分析。

```
POST {BASE}/chat/completions
{
  "model": "agnes-3.0-flash",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "image_url", "image_url": { "url": "<图片公网URL>" } },
      { "type": "text", "text": "<指令：输出2–4条出图提示词候选+风格标签，JSON>" }
    ]
  }],
  "max_tokens": 2048
}
```

要点：
- **M0 已复验：data URL 被接受（2026-11-17，T1）**→ 视觉分析同样 base64 直传，原图全程不落公网；公网 URL 方式保留作链接解析图（本身来自公开 CDN）的通道。
- 走临时公开机制时：随机长密钥 + Job 后删除 + UI 明示；链接解析图直接用其公开 CDN URL。
- 一次调用同时产出候选提示词与标签（省 RPM）；要求结构化 JSON，解析失败重试 1 次后降级通用候选。
- 纯文字输入不带 image_url，直接文本扩写。
- 优化是灵感不是复刻，UI 不承诺像素级一致。

## 5. 已知坑（实测）

| 坑 | 对策 |
|---|---|
| 401 = Key 打错站点 | Key 池按站分组；401 时不盲目重试 |
| 429 = 超 RPM（**实测单 key 2–3 次/短窗口即触发，远严于标称 20**） | 保守限速 ≤3 RPM/key + 间隔 ≥10s + 轮换 key + 退避 |
| `agnes-2.5-flash` 隐式推理吃 max_tokens | max_tokens ≥ 512；读 `reasoning_content` 兜底 |
| `response_format` 位置错 | 只在 `extra_body` 内 |
| 402 配额不足 | 换 key；全池不足降级 Mock 并提示 |
| 免费体验价随时可能结束 | 模型白名单 + 用量日志；发布前复查账单页 |

## 6. Key 池运行设计

- 存储：Sites Secret（如 `AGNES_KEYS_CN` / `AGNES_KEYS_INTL`，JSON 数组），仅云函数可读。
- 调度：轮询选 key → 令牌桶校验 → 请求；429/402 标记冷却并换下一个；全池冷却 → Job 排队或 Mock 兜底。
- 日志：记录脱敏别名与状态码，**不落 key 明文**。
- 游客配额：每会话每日生成次数上限（M2 定值），防公开站被刷。

## 7. M0 实测清单（2026-11-17 本地实测，结果已回填）

- [x] 中国站 key 图生图（base64 原图）成功，7.9s（T4，CN key）
- [x] 国际站 key 出图成功，12.5s（T6，INTL key，`agnes-image-2.1-flash`）
- [x] 文生图（文字入口，无底图）成功，8.4s（T3，`agnes-image-2.5-flash`）
- [x] `agnes-image-2.1-flash` 出图成功（模型切换可用，T6）
- [x] optimize：公网 URL 图片 → 视觉描述成功，3.0s（T2）
- [x] **optimize：data URL 被接受 ✅（T1，2.3s）→ 隐私走 base64 直传，无需临时公开机制**
- [x] optimize：纯文字 → 结构化 JSON 候选成功，3.9s（T5，含保留约束句，格式符合 §4 要求）
- [x] 429 触发与轮换行为：单 CN key 约 2–3 次请求后即 429（**实际 RPM 远严于标称 20**）；换 key/等待后恢复，轮换策略有效
- [x] 云函数单次执行超时上限 vs 出图 8–20s（2026-11-17 云端实测：`_spike/sleep` 10/20/30s 均 HTTP 200，实际 10.34/20.58/30.79s → 网关单请求 ≥30s，轮询驱动租约执行形态成立，M0-3）

### 实测结论对设计的影响

1. **视觉分析 data URL 可行**（手册「只收公网 URL」结论被推翻）→ 开发文档 §4.3 首选路径成立：用户原图 base64 直传 Agnes，全程不落公网，无需临时公开对象与相应 UI 告知。
2. **限流比预期严**：单 key 短时间 2–3 次请求即 429。Key 池限速从「15 RPM/key」下调为**保守 ≤3 RPM/key + 请求间隔 ≥10s + 429 冷却轮换**；10 key 总吞吐约 30 RPM，MVP 够用。optimize（~3s）与 generate（8–20s）串行排队即可。
3. 出图耗时 8–13s，与手册一致；云函数超时验证仍是 M0 必做项。
4. 测试脚本曾按序号取 key 导致国际站 401；**按名称精确配对后正常**——Key 池配置必须用「别名→key→站点」结构化存储，禁止按数组下标猜站点。
5. **云网关对写请求校验 Origin**：无 Origin 的 POST → 403 `sites_gateway_origin_forbidden`；浏览器同源 fetch 天然携带，契约测试脚本已补 `Origin` 头（取 BASE origin）。
6. **平台 DB SDK 为 supabase-js v2 语义**：`update()` 不链 `.select()` 时 `data:null`（行已改但不返回）→ Job 租约与 Key 池两处 CAS 必须链 `.select()` 才能判定抢占成功；本地 fake 已同步该语义防回归（2026-11-17 云端发现并修复）。