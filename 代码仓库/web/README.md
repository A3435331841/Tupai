# 图派 Web

React、TypeScript 和 Vite 前端；产品说明、完整目录、API、本地服务与验证步骤见[项目 README](../../README.md)。

在本目录运行：

```bash
npm ci
npm run dev
npm run build
```

开发服务器代理 `/functions/v1/app` 到本地 8000 端口；需另行启动 `代码仓库/dev/function-local.ts` 才能使用无凭证本地后端。`public/` 中的资源是运行时副本，源文件和映射见 [`资产仓库`](../../资产仓库/总索引.md)。