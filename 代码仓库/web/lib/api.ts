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
  quota: () => request<import('./types').Quota>('GET', '/api/v1/quota'),
  skills: () => request<{ skills: import('./types').SkillRecord[] }>('GET', '/api/v1/skills'),
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
  me: () => request<{ logged_in: boolean; user: { user_id: string; name: string; picture: string } | null; owner_key: string | null }>('GET', '/api/v1/me'),
  bind: () => request<{ migrated: number; owner_key: string }>('POST', '/api/v1/auth/bind', {}),
  assets: (params: { kind?: string; q?: string; tag?: string; include_deleted?: boolean; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.kind) qs.set('kind', params.kind);
    if (params.q) qs.set('q', params.q);
    if (params.tag) qs.set('tag', params.tag);
    if (params.include_deleted) qs.set('include_deleted', '1');
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? '?' + qs.toString() : '';
    return request<{ assets: import('./types').AssetMeta[]; total: number; next_offset: number | null }>('GET', '/api/v1/assets' + suffix);
  },
  asset: (id: string) => request<{ asset: import('./types').AssetMeta }>('GET', `/api/v1/assets/${id}`),
  updateAssetTags: (id: string, tags: string[]) => request<{ asset: import('./types').AssetMeta }>('PATCH', `/api/v1/assets/${id}`, { tags }),
  deleteAsset: (id: string) => request<{ ok: boolean; deleted_at: string }>('DELETE', `/api/v1/assets/${id}`),
  restoreAsset: (id: string) => request<{ asset: import('./types').AssetMeta }>('POST', `/api/v1/assets/${id}/restore`, {}),
  parseLink: (url: string) => request<{ source_url: string; text: string; images: { temp_url: string; expires_at: string }[] }>('POST', '/api/v1/links/parse', { url }),
  albums: () => request<{ albums: import('./types').AlbumMeta[] }>('GET', '/api/v1/albums'),
  createAlbum: (title: string, item_ids: string[]) => request<{ album: import('./types').AlbumMeta }>('POST', '/api/v1/albums', { title, item_ids }),
  updateAlbum: (id: string, patch: { title?: string; item_ids?: string[] }) => request<{ album: import('./types').AlbumMeta }>('PATCH', `/api/v1/albums/${id}`, patch),
  deleteAlbum: (id: string) => request<{ ok: boolean }>('DELETE', `/api/v1/albums/${id}`),
  shareAlbum: (id: string, expires_hours?: number) => request<{ share_token: string; share_page: string; expires_at: string }>('POST', `/api/v1/albums/${id}/share`, { expires_hours }),
  revokeAlbumShare: (id: string) => request<{ ok: boolean }>('DELETE', `/api/v1/albums/${id}/share`),
  feed: (params: { tag?: string; q?: string; sort?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.tag) qs.set('tag', params.tag);
    if (params.q) qs.set('q', params.q);
    if (params.sort) qs.set('sort', params.sort);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.offset) qs.set('offset', String(params.offset));
    const suffix = qs.toString() ? '?' + qs.toString() : '';
    return request<{ works: import('./types').WorkMeta[]; total: number; next_offset: number | null }>('GET', '/api/v1/feed' + suffix);
  },
  work: (id: string) => request<{ work: import('./types').WorkMeta }>('GET', `/api/v1/works/${id}`),
  publishWork: (body: { result_asset_id: string; title: string; tags?: string[]; allow_fork?: boolean; parent_work_id?: string; skill_snapshot: { prompt: string; negative_prompt?: string; model: string; ratio: string } }) =>
    request<{ work: import('./types').WorkMeta }>('POST', '/api/v1/works', body),
  forkWork: (id: string) => request<{ skill_snapshot: { prompt: string; negative_prompt?: string; model: string; ratio: string }; parent_work_id: string; title: string }>('POST', `/api/v1/works/${id}/fork`, {}),
  withdrawWork: (id: string) => request<{ ok: boolean }>('POST', `/api/v1/works/${id}/withdraw`, {}),
  republishWork: (id: string) => request<{ ok: boolean; status: string }>('POST', `/api/v1/works/${id}/publish`, {}),
  deleteWork: (id: string) => request<{ ok: boolean }>('DELETE', `/api/v1/works/${id}`),
  appealWork: (id: string) => request<{ ok: boolean; status: string }>('POST', `/api/v1/works/${id}/appeal`, {}),
  reportWork: (id: string, reason: string) => request<{ ok: boolean }>('POST', `/api/v1/works/${id}/report`, { reason }),
  comments: (id: string) => request<{ comments: { id: string; body: string; author_id: string; created_at: string }[] }>('GET', `/api/v1/works/${id}/comments`),
  addComment: (id: string, body: string) => request<{ comment: { id: string } }>('POST', `/api/v1/works/${id}/comments`, { body }),
  deleteComment: (id: string) => request<{ ok: boolean; hidden?: boolean }>('DELETE', `/api/v1/comments/${id}`),
  like: (id: string) => request<{ liked: boolean }>('POST', `/api/v1/works/${id}/like`, {}),
  tasks: () => request<{ tasks: { id: string; theme: string; constraints: string | null; owner_id: string; created_at: string }[] }>('GET', '/api/v1/tasks'),
  createTask: (theme: string, constraints?: string) => request<{ task: { id: string } }>('POST', '/api/v1/tasks', { theme, constraints }),
  task: (id: string) => request<{ task: { id: string; theme: string; constraints: string | null; status: string }; works: import('./types').WorkMeta[] }>('GET', `/api/v1/tasks/${id}`),
  submitTask: (id: string, work_id: string) => request<{ ok: boolean }>('POST', `/api/v1/tasks/${id}/submissions`, { work_id }),
  notifications: () => request<{ notifications: { id: string; kind: string; work_id: string | null; body: string | null; read: boolean; created_at: string }[] }>('GET', '/api/v1/notifications'),
  readNotification: (id: string) => request<{ ok: boolean }>('POST', `/api/v1/notifications/${id}/read`, {}),
  myWorks: () => request<{ works: import('./types').WorkMeta[] }>('GET', '/api/v1/me/works'),
  userWorks: (id: string) => request<{ works: import('./types').WorkMeta[] }>('GET', `/api/v1/users/${encodeURIComponent(id)}/works`),
  exportMe: () => request<{ exported_at: string; works: unknown[]; skills: unknown[]; albums: unknown[] }>('GET', '/api/v1/me/export'),
  deleteMe: () => request<{ ok: boolean; deleted: boolean }>('DELETE', '/api/v1/me'),
};

// Qoder 平台登录入口（公开站不影响登录；登录后网关向云函数注入已验证身份）
export function loginUrl(returnPath: string = window.location.pathname + window.location.search): string {
  return '/__qoder_auth/start?return_path=' + encodeURIComponent(returnPath);
}

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