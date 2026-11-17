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

⚠️ API Key 仅存 Sites Secret（仅云函数可读）；Key 手册离线保存、被 `.gitignore` 排除，仓库与站点零 Key（见 05 文档）。

## 目录

```
代码仓库/
├─ web/      # 前端 SPA（Vite+React，纯静态，独立部署）
├─ server/   # 后端 API（Sites 云函数，独立部署）
└─ api/      # openapi.yaml 契约 + mock + 契约测试
资产仓库/     # 模板提示词与 Skills 原料（测试底图仅本地保存，不入库；规范见 04）
docs/         # 本套文档
```

## 关联项目

- 拾影 Shiying（链接解析工具，GPL-3.0，独立运行，不并入本仓库）
- 画册技能：[HaichaoLihc/create-photo-flipbook-ui](https://github.com/HaichaoLihc/create-photo-flipbook-ui)（MIT，二期复用）

## 当前状态

一期 MVP 已发布（2026-11-17）：**https://tupai-moo3r9zpvox.qoder.zone** （Qoder Sites，public，真实 Agnes 出图）。图片/文字双入口（生成前可补/换底图）→ 自动优化提示词（中文摘要候选）→ 相似模板/Skills 推荐（无匹配 5 模板兜底）→ 创作台模板选择/夜景雨夜霓虹等变体/换一批候选 → 模型/画幅编辑 → 异步生成 → 修前修后对比 → 强制带 AI 标识下载 → Skills JSON + SKILL.md 双导出/导入回填 + 「我的配方」复用；刷新可恢复上次生成，游客免登录、原图全程私密，HEIC 自动转 JPG。验收：云端契约 35/35、真实出图验收 22/22、移动视口 50/50、交互 10/10、60 秒彩排 23.3s；本地故障注入 20/20、构建通过，记录见 [06 §7](docs/06-参赛交付.md)。模板封面与演示样片为 AI/授权素材，演示样片做了暗光废片化处理。截止 2026-11-30 18:00。

## 本地开发

```bash
cd 代码仓库/web && npm install && npm run dev   # 前端 :5173（proxy → :8000）
cd 代码仓库 && deno run --allow-net=127.0.0.1:8000 --allow-read dev/function-local.ts  # 后端（无凭证 fake，Mock 兜底）
node 代码仓库/api/contract-test.mjs             # 契约测试 35 断言（可传云端 BASE）
node 代码仓库/dev/failpath-test.mjs             # 故障注入 20 断言（429/402/401→冷却/禁用→Mock、超时文案，零真实调用）
node 代码仓库/dev/mobile-test.mjs               # 移动视口+无痕等效 50 断言（需 playwright；BASE 可指本地 :5173）
node 代码仓库/dev/cloud-acceptance.mjs          # 云端真实出图验收（Secret 同步+正式发布后跑：真实 optimize/生成/封面懒生成/隐私）
node 代码仓库/dev/interaction-verify.mjs        # 交互补核 10 断言（F5 推荐/一键同款、F7 字数/负面、F10 再生成、F11 导入回填）
node 代码仓库/dev/regression-tab-reset.mjs      # 回归 6 断言（切文字标签/重新开始清除底图，纯文字不拿旧图生成）
node 代码仓库/dev/demo-rehearsal.mjs            # 60 秒演示彩排计时（核心路径 ≤60s 门禁）
```

Key 只存 Sites Secret（`AGNES_KEYS_CN` / `AGNES_KEYS_INTL`），云函数运行时读取；本地开发无需任何真实 Key。

## License

MIT（第三方材料各自协议，见 [LICENSE](LICENSE)）。