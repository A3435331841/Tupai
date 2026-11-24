-- 图派 TuPai · assets 扩展列迁移（2026-11-18）
-- 背景：二期资产库使用 assets.tags/source/deleted_at，但旧版 schema.sql 未定义，
-- 新环境按旧 DDL 初始化会在资产列表/软删处报错。本文件可安全重复执行。
-- 全新环境部署顺序：schema.sql → schema-community.sql → 本文件（重复列会被 IF NOT EXISTS 跳过）。

ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS assets_deleted_idx ON app.assets (deleted_at);
-- ---------------------------------------------------------------------------
-- V2 增量（2026-11-23）：全部只追加，可重复执行，不删除/不改名既有列。
-- ---------------------------------------------------------------------------

-- 1) 结果资产的水印状态机；默认 none 保证旧行可读。
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS watermark_state text NOT NULL DEFAULT 'none';
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS watermark_version integer;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS watermarked_at timestamptz;
ALTER TABLE app.assets ADD COLUMN IF NOT EXISTS derived_from text;

-- 2) 任务使用的一次性引用：只存哈希与消费时间，不存 URL 明文或字节。
ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS input_ref_hash text;
ALTER TABLE app.jobs ADD COLUMN IF NOT EXISTS input_ref_consumed_at timestamptz;

-- 3) 作品署名快照（逐层，最多 6 层）与截断标记；历史行为空时按指针回填。
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS lineage_credits jsonb;
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS lineage_truncated boolean NOT NULL DEFAULT false;
-- 审核降级标记：发布时写入、人工复核通过后清除（routes.mjs 的 works insert/update）。
ALTER TABLE app.works ADD COLUMN IF NOT EXISTS moderation_degraded boolean NOT NULL DEFAULT false;

-- 4) 一次性引用映射：token 哈希为主键，过期由清理任务回收。
CREATE TABLE IF NOT EXISTS app.temp_refs (
  token_hash text PRIMARY KEY,
  owner_session text NOT NULL,
  host text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'issued',
  job_id text
);
CREATE INDEX IF NOT EXISTS temp_refs_expires_idx ON app.temp_refs (expires_at);
CREATE INDEX IF NOT EXISTS temp_refs_owner_idx ON app.temp_refs (owner_session);

-- 5) 人工复核工单与不可变审计。
CREATE TABLE IF NOT EXISTS app.review_items (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  source text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  reason text,
  report_count integer NOT NULL DEFAULT 0,
  reviewer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS review_items_status_idx ON app.review_items (status, created_at);

CREATE TABLE IF NOT EXISTS app.review_events (
  review_id text NOT NULL,
  action text NOT NULL,
  actor_id text,
  from_status text,
  to_status text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_events_review_idx ON app.review_events (review_id, created_at);

-- 6) 维护任务的幂等执行记录。
CREATE TABLE IF NOT EXISTS app.job_runs (
  idempotency_key text PRIMARY KEY,
  kind text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  result jsonb
);

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
