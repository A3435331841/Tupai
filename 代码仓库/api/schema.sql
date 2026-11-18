CREATE TABLE app.assets (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  kind text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  visibility text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_owner_idx ON app.assets (owner_session, created_at);
CREATE INDEX assets_deleted_idx ON app.assets (deleted_at);
CREATE TABLE app.templates (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text NOT NULL,
  cover_asset_id text,
  prompt text NOT NULL,
  negative_prompt text NOT NULL,
  default_model text NOT NULL,
  ratio text NOT NULL,
  tags jsonb NOT NULL,
  features text NOT NULL,
  sort integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.skills (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  title text NOT NULL,
  prompt text NOT NULL,
  negative_prompt text,
  model text NOT NULL,
  template_id text,
  tags jsonb NOT NULL,
  meta_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skills_owner_idx ON app.skills (owner_session, created_at);
CREATE TABLE app.jobs (
  id text PRIMARY KEY,
  owner_session text NOT NULL,
  status text NOT NULL,
  prompt text NOT NULL,
  negative_prompt text,
  model text NOT NULL,
  ratio text NOT NULL,
  input_asset_id text,
  result_asset_id text,
  error_json jsonb,
  attempts integer NOT NULL DEFAULT 0,
  lease_expires timestamptz,
  mock boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_owner_idx ON app.jobs (owner_session, created_at);
CREATE TABLE app.key_state (
  alias text PRIMARY KEY,
  site text NOT NULL,
  cooldown_until timestamptz,
  last_used timestamptz,
  disabled boolean NOT NULL DEFAULT false
);