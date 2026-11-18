# 图派 TuPai · 下一阶段执行 Prompt（增强版）

> **历史执行 Prompt（2026-11-18 资产治理轮次）**：仅作过程记录；文中路径已按当前命名同步，执行以本地 `AGENTS.md`（私有，不入库）与 `资产仓库/总索引.md` 为准。
> 用途：把本文件完整交给下一轮“主执行 Agent”。这是执行约束，不是产品说明。
> 基线：仓库 A3435331841/Tupai，主分支 main，Qoder 公网 https://tupai-moo3r9zpvox.qoder.zone。

## 角色

你是图派项目的唯一主执行 Agent、集成者和发布负责人。你的任务不是单独完成某个页面，而是先治理仓库的资产、目录、设计版本、文档和协作秩序，再在稳定基线上做页面优化，最后分批提交 GitHub 并发布 Qoder Site。

允许使用子 Agent，但子 Agent 只能做分区的分析或实现；只有主执行 Agent 可以执行全仓移动、最终合并、提交、push 和部署。

## 最终目标

1. 设计稿和资产仓库不再各自维护一套资产；形成唯一、清晰、可追溯的资产源。
2. 所有现有资产被归类；源文件和运行时副本有明确映射，不再靠人工散复制。
3. 页面设计有可追踪的版本命名和当前版本索引，禁止最终版、新版、old、final 等命名混用。
4. 根目录新增项目级 AGENTS.md，规定多 Agent 的读取顺序、写作用域、隔离方式和交付责任。
5. 全量复查并更新文档，确保 README、架构、资产、接口、设计状态和部署记录一致。
6. 首页和后续页面按“页面独立、功能不外溢”的方式优化，不得整页照搬参考站。
7. 每批改动可独立审查、验证和回退；Git 提交按资产、文档、页面、发布记录分批完成。
8. GitHub 与 Qoder 公网最终指向同一已验证版本，部署后完成公网复验并回写记录。

## 开工前检查

先阅读根目录 AGENTS.md（若不存在，先创建再改其他文件）、README、docs/01、02、04、05、06、07、09。

然后执行并记录：

```powershell
git branch --show-current
git status --short
git diff --stat
git log -10 --oneline
git worktree list
rg --files
```

当前工作区可能已有其他 Agent 或用户的未提交改动。不得执行 git reset --hard、git clean -fd、未经检查的 git stash，也不得覆盖未知来源文件。

若同一文件正在被另一个 Agent 修改，先停止该文件重构，改用独立 worktree，或等对方完成。不得靠“最后保存覆盖”解决冲突。

当前目录中的重点问题：

- 设计稿是设计、原型、选稿、预览、生成原图的混合区，不是单一资产库。
- 资产仓库已有 brand、templates、skills/third-party、test-images，但缺少统一下游索引。
- 代码仓库/web/public 存在 brand、templates、home、gallery、samples 等运行时副本。
- 根目录 web/screenshots 是历史验证产物，不是应用源码。
- docs/09 和多个页面、服务端文件可能来自并行 Agent，不能未经审阅当成完成基线。

## 阶段一：冻结与盘点

先输出“现状清单”再移动文件：

- 统计所有图片、SVG、HTML、Markdown、源文件和运行时资产的数量、大小、扩展名。
- 对 Logo、模板封面、主视觉、社区画廊图和演示图计算哈希，识别重复文件。
- 每个文件记录用途、来源、许可证、是否 AI 生成、是否公开、是否被代码引用、是否可删除。
- 用 rg 搜索所有引用：设计稿、资产仓库、/brand/、/templates/、/gallery/、/home/、/samples/。
- 未引用、重复、临时和历史文件先列入“待归档”，不要直接删除。

## 阶段二：统一资产目录

保留顶层资产仓库作为唯一资产根目录，把设计稿吸收进去。推荐结构：

```text
资产仓库/
├─ 总索引.md                         # 人类可读总索引
├─ brand/                           # Logo 唯一源与品牌规范
│  ├─ logo/
│  ├─ explorations/
│  └─ usage.md
├─ designs/
│  ├─ pages/
│  │  ├─ home/
│  │  │  ├─ 索引.md
│  │  │  ├─ v01-20261117-editorial/
│  │  │  ├─ v02-20261118-interactive/
│  │  │  └─ archive/
│  │  ├─ studio/
│  │  ├─ library/
│  │  ├─ community/
│  │  └─ legal/
│  ├─ system/
│  ├─ references/
│  └─ archive/
├─ templates/<template-id>/
│  ├─ 清单.json
│  ├─ 提示词.md
│  ├─ 封面.webp
│  └─ samples/
├─ media/
│  ├─ generated/
│  ├─ licensed/
│  ├─ derived/
│  └─ private/                      # gitignore
├─ skills/
│  ├─ own/
│  └─ third-party/
├─ manifests/
│  ├─ 资产清单.json
│  └─ 运行时映射.json
└─ archive/
```

执行规则：

1. 变更路径优先用 git mv，保留 Git 历史。
2. 源资产只保留一份；代码仓库/web/public 是运行时派生副本，不是第二份源。
3. 每个运行副本必须能由 `运行时映射.json` 追溯回源文件。
4. 资产仓库/test-images 继续作为本地测试资产，默认不入公开仓库，保留许可证记录。
5. .workbuddy、浏览器缓存、临时截图、验证脚本输出不得进入提交，除非进入设计验收证据并登记 manifest。
6. 移动或重命名后立即执行引用扫描、构建和资源 404 检查。
7. 不删除用户创建的旧版本；被替代版本移到 archive，并写迁移记录。

## 阶段三：命名与版本规范

目录和文件名统一使用 ASCII 小写 kebab-case；中文只出现在页面文案和 Markdown 标题里。

页面设计版本目录格式：

- vNN-YYYYMMDD-<intent>
- 示例：v01-20261117-editorial、v02-20261118-interactive-compare
- 禁止：最终版、新版、最终最终、copy、old、new-new、无意义时间戳、随机 hash 目录名。

每个版本目录包含 版本说明.md，状态只能是 concept、review、approved、superseded、archived。当前版本由页面 `索引.md` 指向，不通过复制成 current 或改名为 final 表达。

预览文件：preview-desktop@2x.webp、preview-tablet@2x.webp、preview-mobile@2x.webp。

页面素材：<page>-<slot>-vNN-YYYYMMDD-<variant>.<ext>，例如 home-hero-v02-20261118-warm-street.webp。

派生图放 media/derived，必须能追溯源文件，不能覆盖源图。

每个主要资产或资产组至少记录：

```json
{
  "id": "home-hero-v02-warm-street",
  "type": "image",
  "path": "资产仓库/designs/pages/home/v02-20261118-interactive-compare/assets/hero.webp",
  "origin": "ai-generated",
  "author": "TuPai",
  "license": "project-owned",
  "source": null,
  "prompt_path": "提示词.md",
  "created_at": "2026-11-18",
  "dimensions": "864x1152",
  "sha256": "...",
  "visibility": "public",
  "runtime_path": "代码仓库/web/public/home/hero-street.webp",
  "used_by": ["代码仓库/web/pages/Home.tsx"],
  "derivative_of": null,
  "status": "approved"
}
```

## 阶段四：文档与项目级 AGENTS.md

文档规则：

- 根 AGENTS.md 是全项目唯一 AI 协作规则，不在多个子目录复制不同版本。
- README 只保留概览、快速开始、文档索引、当前状态和关键链接。
- docs/04 改成新的资产分类、来源、许可证、命名和运行时映射规范。
- docs/02 更新实际目录、构建路径和资源引用方式。
- docs/06 更新本地/云端验证、部署 ID、提交 hash、日期和已知限制。
- docs/09 与页面实现状态核对，未完成内容标记 historical，不能假装完成。
- 过时文档移到 docs/archive，旧位置留迁移说明，不直接删除历史。
- 所有文档链接必须可解析，所有路径必须存在或明确标记为计划。

AGENTS.md 必须包含：

1. 项目地图和读取顺序。
2. 唯一资产源与运行时副本规则。
3. 多 Agent 并发规则：先声明写作用域；AGENTS.md、README、globals、package.json、API 契约、部署配置只允许主执行 Agent 修改；不同 Agent 使用独立 worktree/分支；子 Agent 不做 commit/push/deploy；主执行 Agent 负责合并、验收和发布。
4. 代码边界：API 契约、五阶段状态机、隐私 blob、AI 标识、HEIC、会话恢复不得顺手改。
5. 资源规则：先查 manifest，再设计、再落盘，不凭视觉相似重复复制。
6. 验证门禁、提交批次、部署步骤和回滚方式。
7. 安全红线：不提交 Key、私图、.env、docs/references/agnes-api.md、测试底图。
8. 未理解或发生冲突时停止并报告的触发条件。

## 阶段五：页面优化方式

按页面级、单点、可回退推进，不整页复刻其他设计：

- 首页：保留暖纸色、宋体大字、整幅主视觉、五模板横向带和三步结构；只优化显影对比质感、状态切换、无障碍和细微排版。
- 创作台：保持现有 API、stage 状态机和生成链路，只优化步骤呈现、候选信息密度和结果对比区。
- 资产库：强化影像档案感、图集节奏、画册和配方入口；不改分页、私有资产读取和回收站语义。
- 社区：强化策展感和作品优先；不改发布、审核、fork、点赞、举报链路。
- Legal：只调整阅读层级、锚点和排版，不改事实与隐私措辞。

每页单独产出设计目录与 manifest、源码改动、桌面预览、构建和功能验证记录、变更清单、已知限制和回退点。

移动端不是当前设计迭代的优先目标，但不得制造横向溢出、不可点击控件或构建失败；需要适配时单独建任务，不混进视觉重构提交。

## 阶段六：验证门禁

每批提交前至少执行：

```powershell
cd 代码仓库/web
npm run build
cd ..
node api/contract-test.mjs
```

按改动范围追加：

- 所有页面：rg 引用完整性、资源 404、console error。
- 创作/社区/资产：dev/community-test.mjs、dev/interaction-verify.mjs，以及必要的 failpath/mobile 测试。
- 交互改动：用 Playwright 实测拖动、键盘、弹窗和回退。
- 部署前：dev/cloud-acceptance.mjs（仅 Secret 已配置时）。

必须确认：页面可加载、交互可用、图片无 404；npm run build 通过；暂存区无本地测试资产、临时截图或含 Key 文件；git diff --check 无空白错误；当前设计版本与 `索引.md` 一致。

## 阶段七：GitHub 分批提交

仓库：https://github.com/A3435331841/Tupai.git，默认分支 main。

建议提交批次：

1. docs(agents): establish project-level AI collaboration rules
2. refactor(assets): consolidate source assets and add manifests
3. refactor(web): follow canonical asset paths
4. 每页单独提交：feat(home)、feat(studio)、feat(library)、feat(community)
5. docs(release): sync asset guide, verification and deployment record

提交纪律：

- 用 git add -- <明确路径>，禁止无脑 git add -A。
- 资产移动与页面视觉改动分开提交，避免巨型提交。
- 提交前检查 git diff --cached --stat 和敏感文件列表。
- 不覆盖、不强推、不重写已推送历史。
- 远端已前进时先拉取并人工解决冲突，不擅自 rebase/merge 覆盖。
- 所有批次完成后 git status --short 必须干净。
- push 后记录本地和远端 commit hash。

## 阶段八：Qoder 公网发布

发布前：

- 读取 代码仓库/.图派.qoder.site，使用真实 project/site/deployment 元数据，不编造 ID。
- 从 代码仓库/web 重新 build 静态产物。
- 确认 Secrets 仍只在 Qoder Site 后台，仓库内无 Key。
- 记录当前已发布版本作为回滚点。

发布：

- 使用当前可用的 Qoder Sites 管理/发布工具，把 代码仓库/web/dist 作为静态产物发布；服务端变更按现有 Qoder 云函数流程发布。
- 访问策略保持 public。
- 不用本地开发代理或临时 server 充当公网产物。

发布后：

- 打开 https://tupai-moo3r9zpvox.qoder.zone，实际验证首页、Logo、交互和资源加载。
- 验证 /studio、/library、/community、/legal。
- 可用时运行云端契约/验收脚本，记录真实结果。
- 把 Qoder actionId、projectId、siteId、deploymentId、releaseId、commit hash 和测试结果写入 docs/06。
- 追加一条仅含部署记录的文档提交并 push，保证 GitHub 与线上可追溯。

## 阶段九：完成定义

只有以下全部满足才可报告完成：

1. 资产源统一，所有文件有分类和来源；页面资产不只存在于临时目录。
2. 设计版本有 manifest、版本号和当前索引；没有 final/new/最终版 命名。
3. 运行副本映射完整，代码引用可解析，公网资源不 404。
4. 根 AGENTS.md 可执行，并行 Agent 写作用域和主执行者边界清楚。
5. 文档索引、架构、资产、接口、设计状态、部署记录一致。
6. 代码构建通过，适用测试通过，关键交互已实测。
7. Git 提交分批完成，无临时文件和敏感文件；远端与本地一致。
8. Qoder 公网已更新且对应同一 commit；发布后验证记录已回写。

## 必须停下来报告的情况

- 同一关键文件正被其他 Agent/用户修改，且无法安全隔离。
- 要删除或覆盖用户提供的原创资产。
- Qoder 发布权限、Secret 或部署工具不可用。
- 发现敏感 Key、用户私图或未授权第三方素材。
- 资产迁移会造成不可逆引用断裂，且找不到安全回滚点。

除以上情况外，按“盘点 → 安全迁移 → 引用修复 → 文档固化 → 页面优化 → 验证 → 分批提交 → 发布 → 回写记录”的顺序自主完成，不要停在计划阶段。
