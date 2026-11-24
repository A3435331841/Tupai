// 一次性临时引用：只存 token 哈希，不把图片或直链写入资产表。
// 安全边界：https、域名白名单、拒绝私网/回环、拒绝跨域重定向、20MB / 15s 上限。
import { fail, rows, sniffImageType } from './util.mjs';

const ALLOWED_HOST_SUFFIXES = ['douyinpic.com', 'byteimg.com', 'snssdk.com', 'zjcdn.com'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const TTL_SECONDS = 600;
const STORAGE_PREFIX = 'temp-refs';
const encoder = new TextEncoder();

function hostMatches(hostname, suffix) {
  return hostname === suffix || hostname.endsWith('.' + suffix);
}

function isAllowedHost(hostname) {
  return ALLOWED_HOST_SUFFIXES.some((suffix) => hostMatches(hostname, suffix));
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^169\.254\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

function base64url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function secretBytes(env) {
  const configured = env.get('TEMP_REF_SECRET');
  if (typeof configured === 'string' && configured.length >= 16) {
    return encoder.encode(configured);
  }
  return crypto.getRandomValues(new Uint8Array(32));
}

export function createEphemeral({ db, storage, fetchImpl, env }) {
  const secret = secretBytes(env);
  const keyPromise = crypto.subtle.importKey(
    'raw',
    secret,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function sign(payload) {
    const key = await keyPromise;
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return base64url(new Uint8Array(signature));
  }

  async function issue(url, session) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      fail('parse_failed', 422, '临时链接格式有误');
    }
    if (parsed.protocol !== 'https:') fail('parse_failed', 422, '仅支持 https 图片链接');
    if (isPrivateHost(parsed.hostname)) fail('parse_failed', 422, '拒绝内网或回环地址');
    if (!isAllowedHost(parsed.hostname)) fail('parse_failed', 422, '图片域名不在白名单');
    const expiresAt = Date.now() + TTL_SECONDS * 1000;
    const payload = base64url(encoder.encode(JSON.stringify({ u: parsed.href, e: expiresAt })));
    const token = `${payload}.${await sign(payload)}`;
    const hash = await sha256Hex(token);
    const inserted = await db.from('temp_refs').insert({
      token_hash: hash,
      owner_session: session,
      host: parsed.hostname,
      expires_at: new Date(expiresAt).toISOString(),
      state: 'issued',
      job_id: null,
    });
    if (inserted?.error) fail('internal', 503, '临时引用保存失败，请稍后重试');
    return {
      reference_token: token,
      expires_at: new Date(expiresAt).toISOString(),
      ttl_seconds: TTL_SECONDS,
    };
  }

  async function verify(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) fail('ephemeral_unavailable', 422, '临时引用格式无效');
    if ((await sign(payload)) !== signature) fail('ephemeral_unavailable', 422, '临时引用签名无效');
    let data;
    try {
      data = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    } catch {
      fail('ephemeral_unavailable', 422, '临时引用内容无效');
    }
    if (!data?.u || !data?.e) fail('ephemeral_unavailable', 422, '临时引用内容无效');
    if (Date.now() > Number(data.e)) fail('ephemeral_unavailable', 422, '临时图片已失效，请重新粘贴或上传');
    return String(data.u);
  }

  async function fetchImage(url) {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      let response;
      try {
        response = await fetchImpl(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
      } catch {
        fail('ephemeral_unavailable', 422, '临时图片下载超时或不可达，请重新粘贴或上传');
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) fail('parse_failed', 422, '图片重定向缺少地址');
        let next;
        try {
          next = new URL(location, current);
        } catch {
          fail('parse_failed', 422, '图片重定向地址无效');
        }
        if (next.protocol !== 'https:' || isPrivateHost(next.hostname) || !isAllowedHost(next.hostname)) {
          fail('parse_failed', 422, '图片重定向到非白名单域名');
        }
        current = next.href;
        continue;
      }
      if (!response.ok) fail('ephemeral_unavailable', 422, '临时图片已失效，请重新粘贴或上传');
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > MAX_IMAGE_BYTES) fail('ephemeral_unavailable', 422, '图片超过 20MB，请压缩后手动上传');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_IMAGE_BYTES) fail('ephemeral_unavailable', 422, '图片超过 20MB，请压缩后手动上传');
      const mime = sniffImageType(bytes);
      if (!mime) fail('ephemeral_unavailable', 422, '临时内容不是有效图片');
      return { bytes, mime };
    }
    fail('parse_failed', 422, '图片重定向次数过多');
  }

  async function consume(token, session) {
    const hash = await sha256Hex(token);
    const found = rows(await db.from('temp_refs').select('*').eq('token_hash', hash).limit(1));
    const row = found?.[0];
    if (!row || row.owner_session !== session) fail('ephemeral_unavailable', 422, '临时引用不存在或已失效');
    if (row.state !== 'issued') fail('ephemeral_unavailable', 422, '临时引用已被使用');
    if (Date.now() > new Date(row.expires_at).getTime()) {
      fail('ephemeral_unavailable', 422, '临时图片已失效，请重新粘贴或上传');
    }
    const url = await verify(token);
    const downloaded = await fetchImage(url);
    const storageKey = `${STORAGE_PREFIX}/${hash}`;
    try {
      await storage.upload(storageKey, downloaded.bytes, {
        contentType: downloaded.mime,
        upsert: true,
      });
    } catch {
      fail('internal', 503, '临时图片暂存失败，请稍后重试');
    }
    await db.from('temp_refs').update({ state: 'consumed' }).eq('token_hash', hash).eq('owner_session', session);
    return { hash, storageKey, mime: downloaded.mime };
  }

  async function bindJob(hash, jobId) {
    if (!hash || !jobId) return;
    await db.from('temp_refs').update({ job_id: jobId }).eq('token_hash', hash);
  }

  async function releaseJob(jobId) {
    if (!jobId) return 0;
    const list = rows(await db.from('temp_refs').select('*').eq('job_id', jobId)) || [];
    let removed = 0;
    for (const row of list) {
      try {
        await storage.remove([`${STORAGE_PREFIX}/${row.token_hash}`]);
      } catch { /* best effort */ }
      await db.from('temp_refs').delete().eq('token_hash', row.token_hash);
      removed++;
    }
    return removed;
  }

  async function cleanupExpired() {
    const list = rows(await db.from('temp_refs').select('*')) || [];
    let removed = 0;
    for (const row of list) {
      if (Date.now() <= new Date(row.expires_at).getTime()) continue;
      // 已 consume 的行在 temp-refs/{hash} 留有用户原图副本：即使任务从未执行（不轮询/超期被清）也要回收
      try {
        await storage.remove([`${STORAGE_PREFIX}/${row.token_hash}`]);
      } catch { /* 下一轮再试 */ }
      await db.from('temp_refs').delete().eq('token_hash', row.token_hash);
      removed++;
    }
    return removed;
  }

  return { issue, consume, bindJob, releaseJob, cleanupExpired };
}