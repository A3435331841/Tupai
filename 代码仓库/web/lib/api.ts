import { sessionId } from './session';
import type { ApiError } from './types';

// Sites reserves /api at the domain root; the platform transport is /functions/v1/app.
// Contract logical paths (/api/v1/*) are preserved as the suffix.
const BASE = '/functions/v1/app';

export class ApiRequestError extends Error {
  code: string;
  status: number;
  constructor(status: number, err?: ApiError) {
    super(err?.message || '网络异常，请稍后重试');
    this.code = err?.code || 'internal';
    this.status = status;
  }
}

export function apiUrl(logicalPath: string): string {
  return BASE + logicalPath;
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { 'X-Session-Id': sessionId() };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) payload = body as FormData;
    else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiRequestError(0, { code: 'network', message: '网络异常，请检查连接后重试' });
  }
  if (!res.ok) {
    let err: ApiError | undefined;
    try { err = (await res.json()).error; } catch { /* non-JSON error body */ }
    throw new ApiRequestError(res.status, err);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return res.text() as unknown as T;
}

export const api = {
  health: () => request<{ ok: boolean; keys_configured: boolean }>('GET', '/api/v1/health'),
  templates: () => request<{ templates: import('./types').Template[] }>('GET', '/api/v1/templates'),
  models: () => request<{ models: import('./types').ModelInfo[] }>('GET', '/api/v1/models'),
  upload: (file: File, kind: 'original' | 'reference' = 'original') => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return request<{ asset_id: string; kind: string; width: number; height: number; preview_url: string }>(
      'POST', '/api/v1/assets', form, true,
    );
  },
  optimize: (body: { asset_id?: string; text?: string; count?: number }) =>
    request<import('./types').OptimizeResult>('POST', '/api/v1/optimize', body),
  generate: (body: { asset_id?: string; prompt: string; negative_prompt?: string; model: string; ratio: string }) =>
    request<{ job_id: string; status: string }>('POST', '/api/v1/jobs/generate', body),
  job: (id: string) => request<import('./types').JobResult>('GET', `/api/v1/jobs/${id}`),
  saveSkill: (skill: import('./types').TupaiSkill) => request<{ skill_id: string }>('POST', '/api/v1/skills', skill),
  importSkill: (skill: unknown) => request<import('./types').TupaiSkill>('POST', '/api/v1/skills/import', skill),
  skill: (id: string) => request<import('./types').TupaiSkill>('GET', `/api/v1/skills/${id}`),
  skillMd: (id: string) => request<string>('GET', `/api/v1/skills/${id}/skill.md`),
};

// Private assets need the session header, so <img src> cannot load them directly.
export async function fetchAssetBlob(logicalPath: string): Promise<Blob> {
  const res = await fetch(apiUrl(logicalPath), {
    headers: { 'X-Session-Id': sessionId() },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new ApiRequestError(res.status);
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function downloadText(text: string, filename: string, mime = 'text/plain') {
  downloadBlob(new Blob([text], { type: `${mime}; charset=utf-8` }), filename);
}