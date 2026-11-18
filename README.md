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
| [09-统一重构方案](docs/09-统一重构方案与文件清单.md) | 三页结构重构方案、文件清单与实施记录（含 historical 标记） |
| [10-资产治理执行Prompt](docs/10-下一阶段资产治理与页面迭代执行Prompt.md) | 资产治理与页面迭代的执行约束（九阶段） |
| [AGENTS.md](AGENTS.md) | **唯一 AI 协作规则**：读取顺序、写作用域、资产源规则、验证门禁、提交与发布纪律 |

⚠️ API Key 仅存 Sites Secret（仅云函数可读）；Key 手册离线保存、被 `.gitignore` 排除，仓库与站点零 Key（见 05 文档）。

## 目录

```
AGENTS.md     # ★ 唯一 AI 协作规则（读取顺序 / 写作用域 / 资产源 / 验证门禁 / 提交发布纪律）
代码仓库/
├─ web/      # 前端 SPA（Vite+React，纯静态，独立部署）；web/public/ 是运行时派生副本
├─ server/   # 后端 API（Sites 云函数，独立部署）
├─ api/      # openapi.yaml 契约 + schema + mock + 契约测试
└─ .图派.qoder.site  # 发布元数据（真实 project/site/deployment ID）
资产仓库/     # ★ 唯一资产源：brand / designs / templates / media / skills / manifests / test-images
docs/         # 本套文档 01–10
早期规划/     # 历史资料，只读
```

> 资产治理（2026-11-18）：原「设计稿」目录已整体吸收进 `资产仓库/`，按页面版本、品牌、媒体、模板、Skills 五类归位；`manifests/资产清单.json`（117 条记录 / 81 个唯一文件）+ `manifests/运行时映射.json`（26 项，零缺失）提供可追溯映射。旧版根清单已归档到 `资产仓库/archive/manifests-legacy-20261118/`。详见 [`资产仓库/总索引.md`](资产仓库/总索引.md)。

## 关联项目

- 拾影 Shiying（链接解析工具，GPL-3.0，独立运行，不并入本仓库）
- 画册技能：[HaichaoLihc/create-photo-flipbook-ui](https://github.com/HaichaoLihc/create-photo-flipbook-ui)（MIT，二期复用）

## 当前状态

一期 MVP 已发布（2026-11-17，2026-11-18 重新发布最新版）：**https://tupai-moo3r9zpvox.qoder.zone** （Qoder Sites，public，真实 Agnes 出图）。图片/文字双入口（生成前可补/换底图）→ 自动优化提示词（中文摘要候选）→ 相似模板/Skills 推荐（无匹配 5 模板兜底）→ 创作台模板选择/夜景雨夜霓虹等变体/换一批候选 → 模型/画幅编辑 → 异步生成 → 修前修后对比 → 强制带 AI 标识下载 → Skills JSON + SKILL.md 双导出/导入回填 + 「我的配方」复用；刷新可恢复上次生成，游客免登录、原图全程私密，HEIC 自动转 JPG。二期核心子集与三期社区已增量上线：登录/游客绑定、资产库检索与回收站、画册只读分享、抖音图文链接解析、社区发布/发现/fork/互动/共创任务/举报申诉/导出注销；P2-F4 对话检索、P2-F9 批量管理、P2-F10 存储配额、画册 zip 导出未实现。验收：云端契约 35/35、真实出图验收 22/22、移动视口 50/50、交互 10/10、60 秒彩排 23.3s；本地故障注入 20/20、扩展契约 49/49、构建通过，记录见 [06 §7](docs/06-参赛交付.md)。模板封面与演示样片为 AI/授权素材，演示样片做了暗光废片化处理。截止 2026-11-30 18:00。

## 本地开发

```bash
cd 代码仓库/web && npm install && npm run dev   # 前端 :5173（proxy → :8000）
cd 代码仓库 && deno run --allow-net=127.0.0.1:8000 --allow-read dev/function-local.ts  # 后端（无凭证 fake，Mock 兜底）
node 代码仓库/api/contract-test.mjs             # 一期契约 35 断言（可传云端 BASE）
node 代码仓库/api/contract-test-extended.mjs     # 二三期契约 49 断言（本地身份夹具，需本地 fake 后端）
node 代码仓库/dev/failpath-test.mjs             # 故障注入 20 断言（429/402/401→冷却/禁用→Mock、超时文案，零真实调用）
node 代码仓库/dev/mobile-test.mjs               # 移动视口+无痕等效 50 断言（需 playwright；BASE 可指本地 :5173）
node 代码仓库/dev/cloud-acceptance.mjs          # 云端真实出图验收（Secret 同步+正式发布后跑：真实 optimize/生成/封面懒生成/隐私）
node 代码仓库/dev/interaction-verify.mjs        # 交互补核 10 断言（F5 推荐/一键同款、F7 字数/负面、F10 再生成、F11 导入回填）
node 代码仓库/dev/regression-tab-reset.mjs      # 回归 6 断言（切文字标签/重新开始清除底图，纯文字不拿旧图生成）
node 代码仓库/dev/heic-verify.mjs               # HEIC 跨浏览器转换（失败引导必测；HEIC_FIXTURE=<真实.heic> 启用成功路径）
node 代码仓库/dev/community-test.mjs            # 三期社区全链 23 断言（本地身份夹具：发布审核/Fork/互动/任务/通知/举报申诉/注销）
node 代码仓库/dev/demo-rehearsal.mjs            # 60 秒演示彩排计时（核心路径 ≤60s 门禁）
```

Key 只存 Sites Secret（`AGNES_KEYS_CN` / `AGNES_KEYS_INTL`），云函数运行时读取；本地开发无需任何真实 Key。

## License

MIT（第三方材料各自协议，见 [LICENSE](LICENSE)）。