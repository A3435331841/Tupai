-- 图派 TuPai · assets 扩展列迁移（2026-11-18）
-- 背景：二期资产库使用 assets.tags/source/deleted_at，但旧版 schema.sql 未定义，
-- 新环境按旧 DDL 初始化会在资产列表/软删处报错。本文件可安全重复执行。
-- 全新环境部署顺序：schema.sql → schema-community.sql → 本文件（重复列会被 IF NOT EXISTS 跳过）。

ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS assets_deleted_idx ON app.assets (deleted_at);
