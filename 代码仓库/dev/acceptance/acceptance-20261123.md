# 图派验收报告（2026-11-23）

> 对应任务：`.codeartsdoer/specs/tupai_studio/tasks.md`
> 结论口径：本地 fake DB/Storage 的契约与类型检查可复现；生产部署、外部 cron、人工运营均未完成时明确标注。

## 1. 本地门禁

| 检查 | 结果 |
|---|---|
| `deno check server/routes.mjs` | **通过** |
| `node api/contract-test.mjs` | **35 通过 / 0 失败** |
| `node api/contract-test-extended.mjs` | **49 通过 / 0 失败** |
| `npm --prefix web run build` | **通过**（基线，本期未改前端） |

## 2. 已完成能力

| 任务 | 实现 |
|---|---|
| 2.1–2.5 | `api/schema-migrations.sql` 只追加：assets 水印列、jobs 临时引用列、works 谱系列、`temp_refs`、`review_items`/`review_events`、`job_runs` |
| 3.1 | `server/ephemeral.mjs`：https、域名白名单、私网/回环拒绝、跨域重定向拒绝、20MB/15s、token 仅存 SHA-256 |
| 3.2 | `POST /api/v1/assets/temp-ref` 签发一次性引用 |
| 3.3 | `jobs/generate` 支持 `reference_token`，与 `asset_id` 互斥返回 `reference_conflict` |
| 3.4 | 任务终态与失败路径释放临时对象；`/maintenance/cleanup` 回收过期引用 |
| 3.5–3.6 | `watermark=required/1` 强制 SVG 包装，`watermark_state=failed` 返回 409，响应头 `x-watermark-state` |
| 3.7 | `POST /assets/{id}/download-ticket` 60 秒一次性下载地址 |
| 3.9–3.10 | 发布/fork 冻结 `lineage_credits`（≤6 层、循环拒绝、截断标记）；详情返回与历史按指针回填 |
| 3.11–3.13 | 复核工单列表/领取/处置与审计；降级发布自动建单；举报阈值与申诉入队 |
| 3.15 | `/maintenance/cleanup` 按日幂等键 + `job_runs` 执行记录 |

## 3. 未完成 / 未验证

| 任务 | 状态 |
|---|---|
| 3.8 文件级烘焙水印 | 可选，未实现；当前仅 SVG 可见标识 |
| 3.14 共创任务关闭/重开/撤销 | **未实现** |
| 3.16 新端点统一限流回归 | **未实现** |
| 4.1 链接导入改走临时引用（前端） | **未完成**：前端仍上传私有原图 |
| 4.2 下载按钮改走水印端点（前端） | **未完成**：前端仍 canvas 合成 |
| 4.3 谱系组件展示 | **未完成** |
| 4.4 维护端复核队列 | **未完成** |
| 4.5 共创管理入口 | **未完成** |
| 4.6 游客留存提示 | **未完成** |
| 5.4 即焚闭环 SQL 验收 | **未执行** |
| 5.5 三种入口水印人工验收 | **未执行** |
| 5.6 两层 fork 验收 | **未执行** |
| 5.9 生产部署与 cron | **外部依赖，未完成** |

## 4. 风险与口径

- 水印为 SVG 包装的可见标识，**不是**像素级烘焙水印；不得对外表述为"文件级水印"。
- 人工复核依赖运营人力；超 SLA 只提醒，不自动放行。
- 本地 fake 契约通过不等同于生产 Postgres 迁移通过；生产结论必须单独留证。