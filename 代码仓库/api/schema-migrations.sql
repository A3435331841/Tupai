-- 图派 TuPai · assets 扩展列迁移（2026-11-18）
-- 背景：二期资产库使用 assets.tags/source/deleted_at，但旧版 schema.sql 未定义，
-- 新环境按旧 DDL 初始化会在资产列表/软删处报错。本文件可安全重复执行。
-- 全新环境部署顺序：schema.sql → schema-community.sql → 本文件（重复列会被 IF NOT EXISTS 跳过）。

ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS assets_deleted_idx ON app.assets (deleted_at);
-- ---------------------------------------------------------------------------
-- V3 增量（2026-11-23）：灵感库与社区拆分（docs/19）
-- 全部只追加，可重复执行；不删除/不改名既有列。
-- ---------------------------------------------------------------------------

-- 1) works 帖子化扩展：post_type 区分作品/图文/文字，其余承载帖子正文与热度。
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS post_type text NOT NULL DEFAULT 'work';
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS image_asset_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS ref_skill_id text;
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS repost_of text;
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS hot_score real NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS works_hot_idx ON app.works (hot_score DESC, created_at DESC);

-- 2) 热榜定时快照：读取不重算，由 maintenance/recompute-hot 一次性写入。
CREATE TABLE IF NOT EXISTS app.hot_rank (
  period text NOT NULL,
  work_id text NOT NULL,
  rank int NOT NULL,
  hot_score real NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (period, work_id)
);
CREATE INDEX IF NOT EXISTS hot_rank_period_rank_idx ON app.hot_rank (period, rank);

-- 3) 用户关注（社区搜用户/主页用；首版仅建表，UI 可后置）。
CREATE TABLE IF NOT EXISTS app.follows (
  follower text NOT NULL,
  followee text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower, followee)
);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON app.follows (followee);
