# AGENTS.md · 图派 TuPai 项目 AI 协作规则

> 本文件是全项目**唯一**的 AI 协作规则，不在任何子目录复制副本。
> 所有 Agent（含主执行 Agent 与子 Agent）开工前必须完整阅读本文件。
> 基线：仓库 `A3435331841/Tupai`，主分支 `main`，Qoder 公网 https://tupai-moo3r9zpvox.qoder.zone

---

## 1. 项目地图与读取顺序

```
LifeHack·图派/                    # 仓库根（git 根在此，不在 代码仓库/）
├─ AGENTS.md                      # 本文件：唯一协作规则
├─ README.md                      # 概览 / 快速开始 / 文档索引 / 当前状态
├─ docs/                          # 项目文档 01–10
├─ 资产仓库/                       # ★ 唯一资产源（source of truth）
│  ├─ INDEX.md                    # 人类可读总索引
│  ├─ brand/{logo,explorations,usage.md}
│  ├─ designs/pages/{home,studio,library,community,legal}/
│  ├─ designs/{system,references,archive}/
│  ├─ templates/<template-id>/{manifest.json,prompt.md,cover.webp,samples/}
│  ├─ media/{generated,licensed,derived,private}/
│  ├─ skills/{own,third-party}/
│  ├─ manifests/{assets.json,runtime-map.json}
│  └─ archive/
├─ 代码仓库/                       # 可运行产品
│  ├─ web/                        # React 前端；web/public/ 是运行时派生副本
│  ├─ server/                     # Deno 云函数
│  ├─ api/                        # openapi / schema / contract-test
│  └─ .图派.qoder.site            # 发布元数据（真实 ID，勿编造）
├─ 早期规划/                       # 历史资料，只读
└─ .workbuddy/                    # 本地工具状态，不提交
```

**必读顺序**：`AGENTS.md` → `README.md` → `docs/01` → `docs/02` → `docs/04` → `docs/05` → `docs/06` → `docs/07` → `docs/09` → `docs/10`

---

## 2. 唯一资产源与运行时副本规则

- **唯一源**：`资产仓库/`。任何新增图片、Logo、模板封面、设计稿，先落这里。
- **运行时副本**：`代码仓库/web/public/` 只是构建产物输入，**不是第二份源**。禁止直接在 public 里「改图」而不同步回源。
- **映射可追溯**：每个 public 文件必须在 `资产仓库/manifests/runtime-map.json` 有 `runtime_path → source_path` 记录。
- **禁止散复制**：不得凭视觉相似重复复制图片；先查 `manifests/assets.json` 的 sha256，命中则复用。
- **派生图**（裁切、压缩、水印版）放 `media/derived/`，必须记录 `derivative_of`，不覆盖源图。

---

## 3. 多 Agent 并发规则

### 3.1 写作用域声明
每个 Agent 开工前必须在任务描述中声明：要改的**文件/目录清单**。未声明不得改动。

### 3.2 主执行 Agent 独占文件
以下文件**只允许主执行 Agent 修改**，子 Agent 一律只读：
- `AGENTS.md`、`README.md`
- `代码仓库/web/src/globals.css`
- `代码仓库/web/package.json`、`vite.config.ts`、`tsconfig*.json`
- `代码仓库/api/openapi.yaml`、`api/schema*.sql`、`server/*.mjs` 的接口契约部分
- `.图派.qoder.site`、任何部署配置

### 3.3 隔离方式
- 不同 Agent 使用**独立 worktree 或独立分支**；不得两个 Agent 同时改同一文件。
- 同一文件被他人改动未提交时，**停止该文件重构**，改独立 worktree 或等对方完成。
- 禁止用「最后保存覆盖」解决冲突。

### 3.4 交付责任
- 子 Agent：只做分区分析或实现，**不做 commit / push / deploy**。
- 主执行 Agent：负责全仓移动、最终合并、验收、提交、push、部署。

---

## 4. 代码边界（不得顺手改）

以下属于已验证的核心链路，除所属页面任务外不得改动：

| 边界 | 位置 | 原因 |
|---|---|---|
| API 契约 | `web/lib/api.ts`、`api/openapi.yaml` | 49 个方法签名 + 错误信封 |
| 五阶段状态机 | `web/pages/Studio.tsx` 的 `Stage` 与全部 `setStage` | 生成链路核心 |
| 隐私 blob 读取 | `components/AssetImage.tsx`、`fetchAssetBlob` | 私有图裸 `<img src>` 会 401 |
| AI 标识 | 下载 canvas 合成 + 页面角标 | 合规要求 |
| HEIC 转换 | `convertHeic` | 移动端上传依赖 |
| 会话恢复 | `pollJob` / `LastJob` localStorage | 长任务可靠性 |
| 深链协议 | `demo/template/asset/fork` 四参数 | 多页共享入口 |
| 路由 | `lib/router.ts`、`App.tsx` 三元分支 | 全站导航 |

---

## 5. 资源规则

1. 先查 `资产仓库/manifests/assets.json` 是否已有同类资产（按 sha256 / 用途）。
2. 再决定：复用 / 派生 / 新生成。**不得凭视觉相似重复复制**。
3. 新资产落盘必须同时写入 manifest（id/type/path/origin/license/sha256/runtime_path/used_by/status）。
4. 命名遵循 §6，中文只出现在页面文案和 Markdown 标题。

---

## 6. 命名与版本规范

- 目录、文件名：**ASCII 小写 kebab-case**。
- 页面设计版本目录：`vNN-YYYYMMDD-<intent>`，如 `v02-20261118-interactive-compare`。
- **禁止**：`最终版`、`新版`、`old`、`final`、`copy`、`new-new`、随机 hash 目录名、无意义时间戳。
- 每个版本目录含 `manifest.md`，`status` 只能是：`concept` / `review` / `approved` / `superseded` / `archived`。
- 当前版本由页面 `INDEX.md` 指向，**不通过**改名成 `final` 或复制成 `current` 表达。
- 预览文件：`preview-desktop@2x.webp`、`preview-tablet@2x.webp`、`preview-mobile@2x.webp`。
- 页面素材：`<page>-<slot>-vNN-YYYYMMDD-<variant>.<ext>`，如 `home-hero-v02-20261118-warm-street.webp`。

---

## 7. 验证门禁

每批提交前至少执行：

```powershell
cd 代码仓库/web
npm run build            # tsc --noEmit + vite build，必须通过
cd ..
node api/contract-test.mjs   # 契约测试，必须全绿
```

按改动范围追加：
- 所有页面：资源引用完整性、无 404、无 console error
- 创作台/社区/资产库：`node dev/community-test.mjs`、`node dev/interaction-verify.mjs`
- 交互改动：Playwright 实测拖动/键盘/弹窗/回退
- 部署前：`node dev/cloud-acceptance.mjs`（仅 Secret 已配置时）

**提交前必须确认**：页面可加载、交互可用、图片无 404、build 通过、暂存区无测试资产/临时截图/含 Key 文件、`git diff --check` 无空白错误、设计版本与 INDEX.md 一致。

---

## 8. 提交批次与部署

### 8.1 提交纪律
- 用 `git add -- <明确路径>`，**禁止 `git add -A`**。
- 资产移动与页面视觉改动**分开提交**，避免巨型提交。
- 提交前检查 `git diff --cached --stat`。
- **不覆盖、不强推、不重写已推送历史**；远端前进时先拉取人工解决冲突。
- 所有批次完成后 `git status --short` 必须干净。

### 8.2 建议批次
1. `docs(agents): establish project-level AI collaboration rules`
2. `refactor(assets): consolidate source assets and add manifests`
3. `refactor(web): follow canonical asset paths`
4. 每页单独：`feat(home)` / `feat(studio)` / `feat(library)` / `feat(community)`
5. `docs(release): sync asset guide, verification and deployment record`

### 8.3 部署
- 读取 `代码仓库/.图派.qoder.site` 使用真实 project/site/deployment ID，**不编造 ID**。
- 从 `代码仓库/web` 重新 build，把 `dist` 作为静态产物发布。
- 访问策略 public；不得用本地 dev server 冒充公网产物。
- 发布后实际访问验证：首页、`/studio`、`/library`、`/community`、`/legal`、Logo、资源加载。
- 把 actionId/projectId/siteId/deploymentId/releaseId/commit hash/测试结果写入 `docs/06`。
- 追加一条仅含部署记录的提交并 push。

---

## 9. 安全红线

**绝不提交**：
- API Key、Secret、`.env*`
- 用户私图、`资产仓库/media/private/`、`资产仓库/test-images/`
- `docs/references/agnes-api.md`（含凭据）
- `.workbuddy/`、浏览器缓存、临时截图（除已登记为验收证据）

---

## 10. 必须停下来报告的情况

遇到以下任一情况，**停止并在回复中明确报告**，不得擅自继续：

1. 同一关键文件正被其他 Agent/用户修改，且无法安全隔离。
2. 要删除或覆盖用户提供的原创资产。
3. Qoder 发布权限、Secret 或部署工具不可用。
4. 发现敏感 Key、用户私图或未授权第三方素材。
5. 资产迁移会造成不可逆引用断裂，且找不到安全回滚点。

除上述情况外，按 **盘点 → 安全迁移 → 引用修复 → 文档固化 → 页面优化 → 验证 → 分批提交 → 发布 → 回写记录** 顺序自主完成，不停在计划阶段。

---

## 11. 当前状态（2026-11-18）

- 资产治理：源资产已统一到 `资产仓库/`，`designs/` 按页面版本归档，`manifests/` 提供 assets/runtime 双映射。详见 `资产仓库/INDEX.md`。
- 页面状态：首页（已定稿，图派编辑风 + 显影对比）、创作台/资产库/社区（按设计稿复刻，功能完整）、Legal（静态）。
- 已知限制：见 `docs/06` 部署记录与 `docs/09` 完成度说明。
