export interface Template {
  id: string;
  title: string;
  description: string;
  cover_url: string;
  prompt: string;
  negative_prompt: string;
  default_model: string;
  ratio?: string;
  tags: string[];
}

export interface ModelInfo { id: string; label: string; default?: boolean }

export interface Candidate { prompt: string; negative_prompt: string; style_tags: string[] }

export interface Recommendation {
  type: 'template' | 'skill';
  id: string;
  title: string;
  cover_url: string;
  score: number;
  prompt: string;
}

export interface OptimizeResult {
  candidates: Candidate[];
  recommendations: Recommendation[];
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
  created_at?: string;
  skill_id?: string;
}

export interface ApiError { code: string; message: string }