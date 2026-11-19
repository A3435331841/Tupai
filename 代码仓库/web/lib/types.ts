export interface TemplateVariant {
  id: string;
  label: string;
  prompt: string;
  negative_prompt?: string;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  cover_url: string;
  prompt: string;
  negative_prompt: string;
  sample_prompt?: string | null;
  variants?: TemplateVariant[];
  default_model: string;
  ratio?: string;
  tags: string[];
}

export interface ModelInfo { id: string; label: string; description?: string; default?: boolean }

export interface Candidate { summary_zh?: string; prompt: string; negative_prompt: string; style_tags: string[] }

export interface Recommendation {
  type: 'template' | 'skill';
  id: string;
  title: string;
  description?: string;
  cover_url: string;
  cover_private?: boolean;
  score?: number;
  match_tags?: string[];
  prompt: string;
  negative_prompt?: string;
  model?: string;
  default_model?: string;
  ratio?: string;
  sample_prompt?: string | null;
  variants?: TemplateVariant[];
}

export interface OptimizeResult {
  candidates: Candidate[];
  recommendations: Recommendation[];
  recommendations_fallback?: boolean;
  mode: 'img2img' | 'txt2img';
  mock?: boolean;
}

export interface JobResult {
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result: { asset_id: string; url: string; width: number; height: number; mock?: boolean } | null;
  error: { code: string; message: string } | null;
}

export interface TupaiSkill {
  format: 'tupai-skill';
  version: 1;
  title: string;
  prompt: string;
  negative_prompt?: string;
  model: string;
  template_id?: string;
  params?: { aspect?: string; size?: string };
  notes?: string;
  style_tags?: string[];
  cover_url?: string;
  created_at?: string;
  skill_id?: string;
}

export type SkillRecord = TupaiSkill & { skill_id: string };

export interface Quota {
  session_used: number;
  session_limit: number;
  global_used: number;
  global_limit: number;
  remaining: number;
}

export interface ApiError { code: string; message: string }

export interface AssetMeta {
  id: string;
  kind: 'original' | 'result' | 'reference';
  visibility: string;
  width: number;
  height: number;
  content_type: string;
  bytes: number;
  created_at: string;
  tags: string[];
  source: string | null;
  deleted_at: string | null;
  ai_generated: boolean;
  content_url: string;
}

export interface AssetSummary {
  original?: number;
  result?: number;
  reference?: number;
}

export interface AlbumMeta {
  id: string;
  title: string;
  cover_asset_id: string | null;
  item_ids: string[];
  template_id: string;
  visibility: string;
  render_status: string;
  share_token: string | null;
  share_expires_at: string | null;
  created_at: string;
}

export interface WorkMeta {
  id: string;
  title: string;
  tags: string[];
  status: string;
  allow_fork: boolean;
  parent_work_id: string | null;
  parent_skill_id: string | null;
  depth: number;
  author_credit: string | null;
  author_id: string;
  result_asset_id: string;
  skill_snapshot: { prompt: string; negative_prompt?: string | null; model: string; ratio: string } | null;
  image_url: string;
  created_at: string;
  like_count?: number;
  comment_count?: number;
  fork_count?: number;
  liked?: boolean;
  is_owner?: boolean;
  ai_generated?: boolean;
  moderation_degraded?: boolean;
}

export interface WorkComment {
  id: string;
  body: string;
  author_id: string;
  author_name?: string;
  created_at: string;
}

export interface NotificationItem {
  id: string;
  kind: string;
  work_id: string | null;
  body: string | null;
  read: boolean;
  created_at: string;
}

export interface TaskItem {
  id: string;
  theme: string;
  constraints: string | null;
  owner_id?: string;
  status?: string;
  created_at?: string;
  submission_count?: number;
  is_owner?: boolean;
}

export interface ProfileInfo {
  user_id: string;
  display_name: string;
  bio: string;
  avatar_url: string;
}
export interface ShowcaseSkill {
  id: string;
  title_zh: string;
  category: string;
  desc_zh: string;
  tags: string[];
  prompt: string | null;
  negative_prompt: string | null;
  model: string | null;
  ratio: string;
  pair_count: number;
  cover: { original_url: string; result_url: string } | null;
  sort: number;
}
