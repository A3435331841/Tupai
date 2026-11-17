# 契约 mock 数据

按 `../openapi.yaml`（唯一事实源）提供全端点样例响应，前端开发期默认走 mock，一键切真实后端。

| 文件 | 对应端点/分支 |
|---|---|
| templates.json | GET /templates（首批 5 模板定稿，与资产仓库/templates 一致） |
| models.json | GET /models |
| asset-uploaded.json | POST /assets 201 |
| optimize-img2img.json | POST /optimize 200（图片入口，含推荐） |
| optimize-txt2img.json | POST /optimize 200（文字入口，recommendations 为空） |
| optimize-provider-busy.json | POST /optimize 429 降级 |
| job-queued.json | POST /jobs/generate 202 |
| job-running.json / job-succeeded.json / job-failed.json | GET /jobs/:id 各状态 |
| generate-quota.json | POST /jobs/generate 429 配额 |
| skill-import.json | POST /skills/import 200（GET /skills/:id 同结构取 skill 字段） |
| skill-import-invalid.json | POST /skills/import 422 |
| skill.md | GET /skills/:id/skill.md（text/markdown） |
| links-parse.json / links-parse-failed.json | POST /links/parse 200 / 422 |

约定：
- `cover_url`、结果图 URL 目前为占位路径；样片产出后替换为本站真实资产 URL。
- mock 的 job 轮询建议按 queued → running → succeeded 顺序演示（前端可定时切换）。
- 契约变更流程：先改 openapi.yaml → 同步本目录 mock → 前后端各自实现（docs/02 §1 治理规则）。