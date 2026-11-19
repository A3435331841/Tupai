export class AppError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

export const MESSAGES = {
  invalid_input: '输入有误，请检查后重试',
  quota_exceeded: '今日生成次数已用完，明天再来吧',
  provider_busy: 'AI 服务繁忙，已为你降级或请稍后重试',
  parse_failed: '解析失败，请直接上传图片或文字；视频请截帧上传',
  not_found: '内容不存在或无权访问',
  internal: '服务暂时不可用，请稍后重试',
  login_required: '请先登录后再操作',
  invalid_user_context: '登录状态异常，请重新登录',
};

export function fail(code, status, message) {
  throw new AppError(code, status, message || MESSAGES[code] || code);
}

export function errResponse(error) {
  const code = error instanceof AppError ? error.code : 'internal';
  const status = error instanceof AppError ? error.status : 500;
  const message = error instanceof AppError ? error.message : MESSAGES.internal;
  if (!(error instanceof AppError)) console.error('internal_error', error?.name || 'unknown');
  return Response.json({ error: { code, message } }, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export function rows(result) {
  if (result?.error) fail('internal', 503, '数据服务暂不可用，请稍后重试');
  return result?.data;
}

export async function readJson(request, maxBytes = 65536) {
  const reader = request.body?.getReader();
  if (!reader) fail('invalid_input', 400);
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); fail('invalid_input', 413, '请求体过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('invalid_input', 400, '请求体不是合法 JSON'); }
}

export const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireSession(request) {
  const sid = request.headers.get('x-session-id') || '';
  if (!SESSION_RE.test(sid)) fail('invalid_input', 400, '缺少会话标识，请刷新页面重试');
  return sid.toLowerCase();
}

export function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

export function toDataUrl(bytes, mime) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Minimal PNG/JPEG/WebP dimension probing; returns 0x0 for unknown formats.
export function imageSize(bytes, mime) {
  try {
    if (mime === 'image/png' && bytes.length > 24) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { width: dv.getUint32(16), height: dv.getUint32(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
        }
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
      }
    }
    if (mime === 'image/webp' && bytes.length > 30) {
      const fourcc = String.fromCharCode(...bytes.subarray(12, 16));
      if (fourcc === 'VP8 ') {
        return { width: bytes[26] | (bytes[27] << 8), height: bytes[28] | (bytes[29] << 8) };
      }
      if (fourcc === 'VP8L') {
        const b0 = bytes[21], b1 = bytes[22], b2 = bytes[23], b3 = bytes[24];
        return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
      }
      if (fourcc === 'VP8X') {
        return {
          width: 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)),
          height: 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)),
        };
      }
    }
  } catch { /* fall through */ }
  return { width: 0, height: 0 };
}

// 按文件头（magic bytes）识别真实图片类型；伪造 MIME 的上传无法通过。
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MODEL_WHITELIST = ['agnes-image-2.5-flash', 'agnes-image-2.1-flash'];
export const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'];
export const DAILY_QUOTA_PER_SESSION = 20;
export const DAILY_QUOTA_GLOBAL = 300;