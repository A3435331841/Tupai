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
  content_url: string;
}