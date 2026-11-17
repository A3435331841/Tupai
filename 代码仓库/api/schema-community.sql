-- 图派 TuPai · 社区/画册数据层补齐
-- 配套 api/schema.sql 使用。api/schema.sql 已定义 assets/templates/skills/jobs/key_state 5 表；
-- 本文件补齐 server/routes.mjs 实际使用、但缺失 DDL 的 9 张表。
-- 字段严格按 routes.mjs 的 insert/update 反推，不臆造。
-- 全部使用 IF NOT EXISTS，可安全重复执行，不影响线上已有表。

-- 作品：发布时冗余配方快照与 fork 链（routes.mjs:832-837）
CREATE TABLE IF NOT EXISTS app.works (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  result_asset_id text NOT NULL,
  skill_snapshot jsonb NOT NULL,
  title text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'published',
  allow_fork boolean NOT NULL DEFAULT true,
  parent_work_id text,
  parent_skill_id text,
  depth integer NOT NULL DEFAULT 0,
  author_credit text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS works_status_created_idx ON app.works (status, created_at DESC);
CREATE INDEX IF NOT EXISTS works_owner_idx ON app.works (owner_session, created_at DESC);
CREATE INDEX IF NOT EXISTS works_parent_idx ON app.works (parent_work_id);

-- 画册：item_ids 存 result 资产 id 数组，分享用 token + unlisted（routes.mjs:719-722,762-780）
CREATE TABLE IF NOT EXISTS app.albums (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  title text NOT NULL,
  cover_asset_id text,
  item_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_id text NOT NULL DEFAULT '3d-book',
  visibility text NOT NULL DEFAULT 'private',
  render_status text NOT NULL DEFAULT 'ready',
  share_token text UNIQUE,
  share_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS albums_owner_idx ON app.albums (owner_session, created_at DESC);

-- 点赞：UNIQUE 消除「先查后插」并发竞态（routes.mjs:1000-1002）
CREATE TABLE IF NOT EXISTS app.likes (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  owner_session text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT likes_work_owner_uq UNIQUE (work_id, owner_session)
);
CREATE INDEX IF NOT EXISTS likes_work_idx ON app.likes (work_id);

-- 评论：作者可折叠恶意评论（routes.mjs:960-991）
CREATE TABLE IF NOT EXISTS app.comments (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  owner_session text NOT NULL,
  body text NOT NULL,
  hidden_by_author boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_work_idx ON app.comments (work_id, created_at);

-- 通知（routes.mjs:173,1051-1061）
CREATE TABLE IF NOT EXISTS app.notifications (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  kind text NOT NULL,
  work_id text,
  body text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_owner_idx ON app.notifications (owner_session, read, created_at DESC);

-- 共创任务（routes.mjs:1007-1022）
CREATE TABLE IF NOT EXISTS app.tasks (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  theme text NOT NULL,
  constraints text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON app.tasks (status, created_at DESC);

-- 任务投稿（routes.mjs:1035-1049）
CREATE TABLE IF NOT EXISTS app.submissions (
  id text PRIMARY KEY,
  task_id text NOT NULL,
  work_id text NOT NULL,
  owner_session text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT submissions_task_work_uq UNIQUE (task_id, work_id)
);
CREATE INDEX IF NOT EXISTS submissions_task_idx ON app.submissions (task_id);

-- 举报：同一人对同一作品仅一次（routes.mjs:1063-1080）
CREATE TABLE IF NOT EXISTS app.reports (
  id text PRIMARY KEY,
  work_id text NOT NULL,
  reporter_session text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reports_work_reporter_uq UNIQUE (work_id, reporter_session)
);
CREATE INDEX IF NOT EXISTS reports_work_idx ON app.reports (work_id);

-- 登录用户档案：注销流程 routes.mjs:1127 会 delete，但此前无 DDL
CREATE TABLE IF NOT EXISTS app.profiles (
  user_id text PRIMARY KEY,
  display_name text,
  bio text,
  created_at timestamptz NOT NULL DEFAULT now()
);
