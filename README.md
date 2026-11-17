# 图派（TuPai）

让拍照不好看的人，也能有别样的作品去发布——可以不发原图。
2026 Qoder 高校创造力大赛 · LifeHack 赛道参赛作品，代码全程用 Qoder 开发，部署 Qoder Sites。

## 文档索引（docs/）

| 文档 | 回答什么 |
|---|---|
| [01-需求文档](docs/01-需求文档.md) | 做什么：定位、三期路线、一期功能与验收、Skills 规格 |
| [02-开发文档](docs/02-开发文档.md) | 怎么做：架构、数据模型、关键设计、任务分解与分工（WBS） |
| [03-Agnes接入](docs/03-Agnes接入.md) | 出图/反推 API 接入细节与实测清单 |
| [04-资产与数据](docs/04-资产与数据.md) | 资产目录、首批数据来源、开源项目集成清单 |
| [05-注意事项](docs/05-注意事项.md) | 安全/隐私/协议/工程/赛务红线 |
| [06-参赛交付](docs/06-参赛交付.md) | 赛规、时间线、演示脚本、天池帖、发布检查清单 |
| [07-接口契约](docs/07-接口契约.md) | 前后端分离的 API 契约 v1（冻结规则、端点定义、mock 约定） |
| [08-调研参考](docs/08-调研参考.md) | 豆包爆款玩法、Skills 原料、数据集、前端设计参考、DeepSeek 搜索调研结论 |

⚠️ `docs/references/agnes-api.md` 含真实 API Key，**禁止提交公开仓库或外传**（见 05 文档）。

## 目录

```
代码仓库/
├─ web/      # 前端 SPA（Vite+React，纯静态，独立部署）
├─ server/   # 后端 API（Sites 云函数，独立部署）
└─ api/      # openapi.yaml 契约 + mock + 契约测试
资产仓库/     # 模板样片、测试图、提示词原料（规范见 04）
docs/         # 本套文档
早期规划/     # Grok 时期 PDF 与归档（其中结论以 docs 为准）
```

## 关联项目

- 拾影 Shiying（本地链接解析工具，GPL-3.0，独立运行）：`../Shiying`
- 画册技能：[HaichaoLihc/create-photo-flipbook-ui](https://github.com/HaichaoLihc/create-photo-flipbook-ui)（MIT，二期复用）

## 当前状态

一期 MVP 已部署（2026-11-17）：**https://tupai-moo3r9zpvox.qoder.zone** （Qoder Sites，public）。图片/文字双入口 → 自动优化提示词 → 相似模板/Skills 推荐 → 模型/画幅编辑 → 异步生成 → 修前修后对比 → 含 AI 标识下载 → Skills JSON + SKILL.md 双导出/导入回填，游客免登录、原图全程私密。云端契约测试 29/29、超时 spike（10/20/30s）与浏览器双入口全链路验收通过，记录见 [06 §7](docs/06-参赛交付.md)。当前线上为无 Key 演示版（界面明确标注）；Agnes Key 经 Sites Secret 录入后发布正式版即恢复真实出图。截止 2026-11-30 18:00。

## 本地开发

```bash
cd 代码仓库/web && npm install && npm run dev   # 前端 :5173（proxy → :8000）
cd 代码仓库 && deno run --allow-net=127.0.0.1:8000 --allow-read dev/function-local.ts  # 后端（无凭证 fake，Mock 兜底）
node 代码仓库/api/contract-test.mjs             # 契约测试 29 断言（可传云端 BASE）
```

Key 只存 Sites Secret（`AGNES_KEYS_CN` / `AGNES_KEYS_INTL`），云函数运行时读取；本地开发无需任何真实 Key。