<p align="center"><img src="代码仓库/web/public/brand/logo-horizontal.svg" height="56" alt="图派 TuPai"></p>

<p align="center">把不好看的照片，变成可以发布的作品——原图不必公开。</p>

<p align="center"><a href="https://tupai-moo3r9zpvox.qoder.zone"><img src="https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%E4%BD%93%E9%AA%8C-%E7%AB%8B%E5%8D%B3%E6%89%93%E5%BC%80-8a4b2a?style=flat-square" alt="在线体验"></a> <img src="https://img.shields.io/badge/License-MIT-5a6f5a?style=flat-square" alt="MIT"> <img src="https://img.shields.io/badge/Deploy-Qoder_Sites-3b5b7a?style=flat-square" alt="Qoder Sites"></p>

<table>
<tr>
<td width="50%"><img src="docs/images/home.webp" alt="首页"><br><sub><b>首页</b> · 无限画廊与显影对比</sub></td>
<td width="50%"><img src="docs/images/studio.webp" alt="创作台"><br><sub><b>创作台</b> · 五阶段生成闭环</sub></td>
</tr>
<tr>
<td><img src="docs/images/library.webp" alt="资产库"><br><sub><b>资产库</b> · 影像档案与画册</sub></td>
<td><img src="docs/images/community.webp" alt="社区"><br><sub><b>社区</b> · 作品墙与共创</sub></td>
</tr>
</table>

## 这是什么

拍得不好看的照片，大多只能躺在相册里。图派先理解画面，再把「怎么改」写成可复用的配方，一键生成可以发布的作品。

**原图默认私密**：原图保存在私有存储，视觉分析和图生图时以 base64 传给 Agnes；发布与画册只接受生成结果。**配方可带走**：可导出 JSON 与 `SKILL.md`，也可重新导入。**结果可追溯**：创作台展示 AI 角标，下载时合成标识；社区与画册展示层已覆盖 AI 角标，服务端图片字节级水印仍是后续项，见[核对记录](docs/12-文档与代码核对.md)。

## 功能

- **创作闭环** — 图片或文字入口 → 自动优化提示词 → 候选方向 → 异步生成 → 修前修后对比 → 带 AI 标识下载
- **资产库与画册** — 原图/作品归档检索、回收站软删恢复；画册支持 9 套模板（3D 精装 / 杂志跨页 / 卡片画廊 / 胶片档案 / 影像图谱 / 光影瀑布 / WebGL 真曲页 / 底片夹 / 可编辑书含PDF导出）在线切换，ZIP 导出已实现（服务端 `export.zip` + 前端下载按钮）
- **灵感库** — 官方 266 套技能与真实示例对、图片参考的集中浏览，技能/配方可一键套用创作；保存配方时可勾选「公开到灵感库」，公开配方集中浏览并一键套用（浏览型，无社交互动）
- **社区** — 微博式信息流：发布、发现、fork、评论点赞、共创任务、通知、热榜（定时快照）、用户/帖子搜索、举报；审核降级、公开图片标识和完整署名链仍有缺口
- **链接导入** — 尽力解析抖音单条图文；导入图片继续创作时会作为私有原图保存，用后即焚尚未实现
- **Skills 双导出** — 配方导出为 JSON 与 SKILL.md，支持导入回填与站内配方

## 快速开始

要求 Node.js 22.13+（22.x 系列）或 24+，以及 Deno 2+。新克隆先检查 `.gitignore.example`，按需复制或合并为本地 `.gitignore`，已有文件不要覆盖。

```bash
# 前端（Vite :5173，代理 /functions/v1/app 到 :8000）
cd 代码仓库/web
npm ci
npm run dev

# 另开终端：无凭证本地 fake 后端
cd 代码仓库
deno run --allow-net=127.0.0.1:8000 --allow-read dev/function-local.ts
```

未配置 Agnes Key 时走 Mock。`web/package.json` 的 `dev:function` / `check:function` 已指向仓库根路径（`../dev/function-local.ts`、`../server/routes.mjs`），可直接用 `npm run dev:function` 本地联调。

## 验证

```bash
# 一键门禁：独立端口起干净假后端，检查「工作区将提交的快照」，输出逐项 PASS/FAIL
node 代码仓库/dev/acceptance-gates.mjs

# 也可以逐项执行（需先启动本地 fake 后端）
cd 代码仓库/web
npm run build

cd ..
node api/contract-test.mjs
node api/contract-test-extended.mjs
node dev/community-test.mjs
node dev/repo-scope-check.mjs
node dev/repo-scope-check-test.mjs
```

契约、社区和浏览器脚本需先启动匹配的本地服务；云端验收脚本会访问真实站点。提交范围检查读取 Git 暂存内容，不能替代敏感值审查。

## 技术栈

React 19 · Vite 8 · Tailwind 4 · Deno · Qoder Sites · OpenAPI · Agnes

## 文档

| 入口 | 内容 |
|---|---|
| [需求文档](docs/01-需求文档.md) | 定位、三期路线、功能与验收目标 |
| [开发文档](docs/02-开发文档.md) | 架构、数据模型、关键设计与实施记录 |
| [资产与数据](docs/04-资产与数据.md) | 唯一资产源、来源、协议与运行时映射 |
| [注意事项](docs/05-注意事项.md) | 安全、隐私、协议与赛务红线 |
| [参赛交付](docs/06-参赛交付.md) | 赛规、演示脚本、历史验证与部署记录 |
| [接口契约](docs/07-接口契约.md) | API 摘要；完整定义以 `openapi.yaml` 为准 |
| [提交边界](docs/11-提交范围与边界.md) | 公开范围、本地保留与检查流程 |
| [文档与代码核对](docs/12-文档与代码核对.md) | 已核实的实现差异、风险与待办 |
| [技能演示与语料批次](docs/16-技能演示与语料批次.md) | 技能库 266 条、语料分类入库、批量二次创作与社区画册呈现 |
| [技能配对一致性检查报告](docs/17-技能配对一致性检查报告.md) | 266 技能 × 20 对配对目检：达标率、根因与重测结论 |
| [技能配对路由修复记录](docs/18-技能配对路由修复记录.md) | 按 `input_type` 语义选图、补充输入与 0 分门禁的修复落地 |
| [灵感库与社区拆分需求](docs/19-灵感库与社区拆分需求.md) | 浏览型/社交型模块边界、功能、数据结构、热榜快照与 MVP 范围 |
| [画册多模板体系](docs/20-画册多模板体系.md) | 九套画册模板的视觉/交互、MIT 参考边界与验证 |

## 当前状态

线上地址与历史发布 ID 见 [参赛交付记录](docs/06-参赛交付.md)。本次代码和文档修订是否上线以实际部署记录为准。截止日期为 2026-11-30 18:00。

## License

MIT；第三方素材与代码遵循各自许可，详见 [LICENSE](LICENSE) 与资产来源记录。Key 仅存 Sites Secret。