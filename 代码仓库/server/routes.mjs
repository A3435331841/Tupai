import {
  AppError, fail, errResponse, rows, readJson, requireSession, newId,
  imageSize, sniffImageType, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, MODEL_WHITELIST, RATIOS,
  DAILY_QUOTA_PER_SESSION, DAILY_QUOTA_GLOBAL, MESSAGES, b64ToBytes, toDataUrl,
} from './util.mjs';
import { buildZip } from './zip.mjs';
import { createHash } from 'node:crypto';
import { createKeyScheduler } from './scheduler.mjs';
import { createAgnesProvider } from './agnes.mjs';
import { createEphemeral } from './ephemeral.mjs';
import { mockOptimize, mockGenerate } from './mock.mjs';
import { TEMPLATES, ensureSeeded } from './seed.mjs';
import { renderSkillMarkdown } from './skillmd.mjs';
import { albumPageHtml as renderAlbumPage, albumStyleIds } from './album-styles.mjs';
import { getUser } from './auth.mjs';
import { vInt, vOneOf, vStr, vStringArray, vId, KIND_VALUES, SORT_VALUES } from './validate.mjs';

const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 3;
const PARSE_WINDOW_MS = 3_600_000;
const PARSE_MAX_PER_HOUR = 10;
const PARSE_MAX_HTML_BYTES = 2 * 1024 * 1024;
// 链接解析限流（进程内；平台单实例足够，多实例时按实例计）
const parseHits = new Map();

function isDouyinHost(hostname) {
  return /(^|\.)douyin\.com$/i.test(hostname || '');
}

function takeParseSlot(key) {
  const now = Date.now();
  const hits = (parseHits.get(key) || []).filter((t) => now - t < PARSE_WINDOW_MS);
  if (hits.length >= PARSE_MAX_PER_HOUR) return false;
  hits.push(now);
  parseHits.set(key, hits);
  if (parseHits.size > 2000) {
    for (const [k, v] of parseHits) if (!v.some((t) => now - t < PARSE_WINDOW_MS)) parseHits.delete(k);
  }
  return true;
}

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function scoreMatch(queryTags, itemTags, features) {
  if (!queryTags?.length) return 0;
  let hit = 0;
  for (const q of queryTags) {
    if (itemTags.some((t) => t === q)) hit += 1;
    else if (itemTags.some((t) => t.includes(q) || q.includes(t))) hit += 0.5;
    else if (features && features.includes(q)) hit += 0.25;
  }
  return hit / queryTags.length;
}

function publicAssetUrl(id) {
  return `/api/v1/assets/${id}/content`;
}

// 画册 ZIP 内文件的扩展名由 content_type 推导；未知类型按 jpg 兜底
function extFromImageType(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function safeCoverUrl(value) {
  return typeof value === 'string' && /^\/api\/v1\/assets\/a_[0-9a-f]{24}\/content$/.test(value) ? value : undefined;
}

function templateMeta(t) {
  const meta = TEMPLATES.find((x) => x.id === t.id) || {};
  return {
    id: t.id, title: t.title, description: t.description,
    cover_url: t.cover_asset_id ? publicAssetUrl(t.cover_asset_id) : `/api/v1/templates/${t.id}/cover`,
    prompt: t.prompt, negative_prompt: t.negative_prompt,
    sample_prompt: meta.sample_prompt || null,
    variants: meta.variants || [],
    default_model: t.default_model, ratio: t.ratio, tags: t.tags || [],
  };
}

function assetTags(a) {
  if (Array.isArray(a.tags)) return a.tags;
  if (typeof a.tags === 'string') { try { const p = JSON.parse(a.tags); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function assetMeta(a) {
  return {
    id: a.id, kind: a.kind, visibility: a.visibility, width: a.width, height: a.height,
    content_type: a.content_type, bytes: a.bytes, created_at: a.created_at,
    tags: assetTags(a), source: a.source || null, deleted_at: a.deleted_at || null,
    ai_generated: a.kind === 'result',
    content_url: publicAssetUrl(a.id),
  };
}

function albumItems(a) {
  if (Array.isArray(a.item_ids)) return a.item_ids;
  if (typeof a.item_ids === 'string') { try { const p = JSON.parse(a.item_ids); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function albumMeta(a) {
  return {
    id: a.id, title: a.title, cover_asset_id: a.cover_asset_id || null, item_ids: albumItems(a),
    template_id: a.template_id, visibility: a.visibility, render_status: a.render_status,
    share_token: a.share_token || null, share_expires_at: a.share_expires_at || null,
    share_active: shareActive(a), created_at: a.created_at,
  };
}

function shareActive(a) {
  return Boolean(a.share_token) && a.visibility === 'unlisted'
    && (!a.share_expires_at || new Date(a.share_expires_at).getTime() > Date.now());
}

function jsonArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

function workMeta(w, extras = {}) {
  return {
    id: w.id, title: w.title, tags: jsonArr(w.tags), status: w.status, allow_fork: Boolean(w.allow_fork),
    parent_work_id: w.parent_work_id || null, parent_skill_id: w.parent_skill_id || null,
    depth: w.depth || 0, author_credit: w.author_credit || null, author_id: w.owner_session,
    result_asset_id: w.result_asset_id, skill_snapshot: w.skill_snapshot || null,
    lineage_credits: jsonArr(w.lineage_credits),
    lineage_truncated: Boolean(w.lineage_truncated),
    ai_generated: true,
    moderation_degraded: Boolean(w.moderation_degraded),
    liked: false,
    image_url: `/api/v1/works/${w.id}/img`, created_at: w.created_at, ...extras,
  };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 分享图带标识版：原图以 data URI 内嵌进 SVG，右下角叠加半透明黑底白字「AI 生成 · 图派」
function shareWatermarkSvg(bytes, mime, width, height) {
  const w = width || 1024;
  const h = height || 1024;
  const fs = Math.max(14, Math.round(w * 0.026));
  const pad = Math.max(12, Math.round(w * 0.022));
  const label = 'AI 生成 · 图派';
  const textW = Math.round(fs * 6.8);
  const boxW = textW + pad * 2;
  const boxH = fs + pad;
  const x = Math.max(0, w - pad - boxW);
  const y = Math.max(0, h - pad - boxH);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<image href="${toDataUrl(bytes, mime)}" width="${w}" height="${h}"/>`
    + `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="${Math.round(boxH / 2)}" fill="rgba(0,0,0,0.55)"/>`
    + `<text x="${x + pad}" y="${y + boxH / 2}" fill="#ffffff" font-family="system-ui, sans-serif" font-size="${fs}" font-weight="600" dominant-baseline="central">${label}</text>`
    + '</svg>';
}

// ===== 技能演示（种子内容）：每个技能一本画册 + 原图→作品示例对；由维护端点幂等写入，公开只读 =====
const SHOWCASE_OWNER = 'u:showcase-official';

function seedHash(label) {
  return createHash('sha256').update(String(label)).digest('hex');
}

function showcasePairs(s) {
  return jsonArr(s.pairs).filter((p) => p && typeof p.original_id === 'string' && typeof p.result_id === 'string');
}

function showcaseMeta(s, livePairs) {
  const pairs = livePairs || showcasePairs(s);
  return {
    id: s.id, title_zh: s.title_zh, category: s.category || '创意合成', desc_zh: s.desc_zh || '',
    tags: jsonArr(s.tags), prompt: s.prompt || null, negative_prompt: s.negative_prompt || null,
    model: s.model || null, ratio: s.ratio || '3:4',
    pair_count: pairs.length,
    cover: pairs.length ? {
      original_url: `/api/v1/showcase/img/${pairs[0].original_id}`,
      result_url: `/api/v1/showcase/img/${pairs[0].result_id}`,
    } : null,
    sort: s.sort || 0,
  };
}

// 画册多模板渲染（docs/20）：模板实现见 album-styles.mjs，概念参考 MIT 项目但纯自实现。
// 图片用相对路径 img/{id}?watermark=1（深层路径写死 /api/v1 会被平台拦截，见 docs/14 F-10）；
// 下载在画布合成 AI 标识；模板切换由 URL ?style= 驱动，不触碰资产与分享校验。
function albumPageHtml(title, ids, style) {
  return renderAlbumPage(title, ids, style);
}

// 分享失效（过期/撤回/不存在）落地页：纯静态友好提示，不暴露 JSON
function shareExpiredHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>画册链接已失效 · 图派</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#faf7f2;color:#2a2622;font-family:system-ui,sans-serif;padding:24px}
.card{max-width:420px;background:#fff;border:1px solid #eee4d6;border-radius:16px;padding:36px 28px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.06)}
h1{font-family:"Songti SC","SimSun",serif;font-size:1.5rem;margin:0 0 14px}
p{color:#7a6f63;line-height:1.7;margin:0 0 22px}
a{color:#2a2622;text-decoration:none;border-bottom:1px solid #cbbb9f;padding-bottom:2px}
</style></head><body>
<div class="card"><h1>画册链接已失效</h1><p>该分享链接可能已过期或被作者撤回。<br>你可以回到图派首页，继续浏览其他画册与作品。</p><a href="../../../../">回到图派首页</a></div>
</body></html>`;
}

export function application({ db, storage, env, fetchImpl }) {
  const scheduler = createKeyScheduler(db, env);
  const agnes = createAgnesProvider(scheduler, fetchImpl);
  const ephemeral = createEphemeral({ db, storage, fetchImpl, env });
  const downloadTickets = new Map();

  // 登录用户归属 u:<user_id>（跨设备稳定）；游客回退会话标识。SDK 仅校验格式，
  // 伪造防护依赖平台网关 ingress（剥离浏览器 x-qoder-* 并注入已验证上下文）。
  function currentUser(request) {
    try { return getUser(request); }
    catch (e) { fail(e.code || 'invalid_user_context', e.status || 403); }
  }
  function ownerOf(request) {
    const user = currentUser(request);
    if (user) return 'u:' + user.user_id;
    return requireSession(request);
  }

  // allowDeleted 仅供回收站恢复/预览使用；其余入口（发布、生成、入册、打标）一律拒绝软删资产。
  async function loadOwnedAsset(id, sid, { allowDeleted = false } = {}) {
    const found = rows(await db.from('assets').select('*').eq('id', id).limit(1));
    if (!found?.length) fail('not_found', 404);
    const asset = found[0];
    if (asset.owner_session !== sid) fail('not_found', 404);
    if (!allowDeleted && asset.deleted_at) fail('not_found', 404, '资产已移入回收站');
    return asset;
  }

  async function loadOwnedAlbum(id, sid) {
    const found = rows(await db.from('albums').select('*').eq('id', id).limit(1));
    if (!found?.length) fail('not_found', 404);
    const album = found[0];
    if (album.owner_session !== sid) fail('not_found', 404);
    return album;
  }

  async function loadSharedAlbum(token) {
    const found = rows(await db.from('albums').select('*').eq('share_token', token).limit(1));
    if (!found?.length) fail('not_found', 404);
    const album = found[0];
    if (!shareActive(album)) fail('not_found', 404, '分享链接已失效或被撤回');
    return album;
  }

  // 分享页只展示仍存活（未软删、kind==='result'）的条目：一次查询过滤，保持画册原顺序
  async function liveAlbumIds(album) {
    const ids = albumItems(album).filter(Boolean);
    if (!ids.length) return [];
    const alive = rows(await db.from('assets').select('id, kind, deleted_at').in('id', ids)) || [];
    const keep = new Set(alive.filter((a) => a.kind === 'result' && !a.deleted_at).map((a) => a.id));
    return ids.filter((id) => keep.has(id));
  }

  // 演示对存活过滤：一次查询全部 pair 资产，只保留原图与结果都未软删的 pair
  async function liveShowcasePairs(skills) {
    const allIds = new Set();
    for (const s of skills) for (const p of showcasePairs(s)) { allIds.add(p.original_id); allIds.add(p.result_id); }
    const alive = new Set();
    if (allIds.size) {
      const list = rows(await db.from('assets').select('id, kind, deleted_at').in('id', [...allIds])) || [];
      for (const a of list) if (!a.deleted_at) alive.add(a.id);
    }
    const out = new Map();
    for (const s of skills) {
      out.set(s.id, showcasePairs(s).filter((p) => alive.has(p.original_id) && alive.has(p.result_id)));
    }
    return out;
  }

  // /showcase/img 白名单：进程内 30 秒缓存，避免每张演示图都全表扫描
  let showcaseAllowed = { at: 0, ids: new Set() };
  async function showcaseAllowedIds() {
    if (Date.now() - showcaseAllowed.at > 30_000) {
      const list = rows(await db.from('showcase_skills').select('*').limit(500)) || [];
      const ids = new Set();
      for (const pairs of (await liveShowcasePairs(list)).values()) {
        for (const p of pairs) { ids.add(p.original_id); ids.add(p.result_id); }
      }
      showcaseAllowed = { at: Date.now(), ids };
    }
    return showcaseAllowed.ids;
  }

  async function loadWork(id) {
    const found = rows(await db.from('works').select('*').eq('id', id).limit(1));
    if (!found?.length) fail('not_found', 404);
    return found[0];
  }

  async function buildLineageCredits(startWork) {
    const credits = [];
    const seen = new Set();
    let current = startWork;
    while (current) {
      if (seen.has(current.id)) fail('invalid_input', 400, '谱系存在循环引用，已拒绝写入');
      seen.add(current.id);
      if (credits.length >= 6) return { credits, truncated: true };
      credits.push({
        work_id: current.id,
        author_credit: current.author_credit || '匿名创作者',
        depth: current.depth || 0,
        withdrawn: current.status === 'withdrawn',
      });
      if (!current.parent_work_id) return { credits, truncated: false };
      const found = rows(await db.from('works').select('*').eq('id', current.parent_work_id).limit(1));
      current = found?.[0] || null;
    }
    return { credits, truncated: false };
  }

  async function createReviewItem({ workId, source, reason, reportCount = 0 }) {
    const existing = rows(
      await db.from('review_items').select('*').eq('work_id', workId).eq('source', source).limit(1),
    )?.[0];
    if (existing) return existing;
    const id = newId('rv');
    const inserted = await db.from('review_items').insert({
      id, work_id: workId, source, status: 'queued',
      reason: reason || null, report_count: reportCount,
      reviewer_id: null, decided_at: null,
    });
    if (inserted?.error) fail('internal', 503, '复核工单创建失败，请稍后重试');
    await db.from('review_events').insert({
      review_id: id, action: 'created', actor_id: null,
      from_status: null, to_status: 'queued', reason: reason || null,
    });
    return { id, work_id: workId, source, status: 'queued' };
  }

  function requireReviewer(request) {
    requireMaintenance(request);
    const reviewer = (request.headers.get('x-reviewer-id') || '').trim();
    if (!reviewer) fail('not_found', 404);
    return reviewer;
  }

  async function notify(owner, kind, workId, body) {
    if (!owner) return;
    await db.from('notifications').insert({ id: newId('nt'), owner_session: owner, kind, work_id: workId || null, body: body || null, read: false }).select();
  }

  const BANNED = /色情|裸体|裸露|性交|血腥|暴力|恐怖|尸体|枪支|毒品|赌博|反动|法轮|未成年/i;
  async function moderateWork({ title, tags, imageBytes, imageMime }) {
    if (BANNED.test([title, ...(tags || [])].join(' '))) return { ok: false, reason: '标题或标签含违规内容' };
    const s = await agnes.safety({ imageBytes, imageMime });
    if (s.busy || s.parseFailed) return { ok: true, degraded: true };
    if (s.safe === false) return { ok: false, reason: s.reason || '图片未通过安全审核' };
    return { ok: true };
  }

  function viewerKey(request) {
    const user = currentUser(request);
    if (user) return 'u:' + user.user_id;
    return (request.headers.get('x-session-id') || '').toLowerCase() || null;
  }

  function requireMaintenance(request) {
    const token = env.get('MAINTENANCE_TOKEN');
    if (!token || request.headers.get('x-maintenance-token') !== token) fail('not_found', 404);
  }

  async function workCounts(w) {
    const lc = await db.from('likes').select('id', { count: 'exact' }).eq('work_id', w.id).limit(1);
    const cc = await db.from('comments').select('id', { count: 'exact' }).eq('work_id', w.id).eq('hidden_by_author', false).limit(1);
    const fc = await db.from('works').select('id', { count: 'exact' }).eq('parent_work_id', w.id).limit(1);
    return { like_count: Number(lc.count) || 0, comment_count: Number(cc.count) || 0, fork_count: Number(fc.count) || 0 };
  }

  async function likedBy(workId, viewer) {
    if (!viewer) return false;
    const r = await db.from('likes').select('id').eq('work_id', workId).eq('owner_session', viewer).limit(1);
    return Boolean(rows(r)?.length);
  }

  // 列表页批量统计，避免每件作品 4 次查询的 N+1
  async function batchMeta(works, viewer) {
    if (!works.length) return [];
    const ids = works.map((w) => w.id);
    const [likeRes, commentRes, forkRes, mineRes] = await Promise.all([
      db.from('likes').select('*').in('work_id', ids).limit(5000),
      db.from('comments').select('*').in('work_id', ids).eq('hidden_by_author', false).limit(5000),
      db.from('works').select('*').in('parent_work_id', ids).limit(5000),
      viewer ? db.from('likes').select('*').in('work_id', ids).eq('owner_session', viewer).limit(5000) : Promise.resolve({ data: [] }),
    ]);
    const tally = (list, key) => {
      const m = new Map();
      for (const r of list || []) m.set(r[key], (m.get(r[key]) || 0) + 1);
      return m;
    };
    const likes = tally(rows(likeRes), 'work_id');
    const comments = tally(rows(commentRes), 'work_id');
    const forks = tally(rows(forkRes), 'parent_work_id');
    const mine = new Set((rows(mineRes) || []).map((r) => r.work_id));
    return works.map((w) => workMeta(w, {
      like_count: likes.get(w.id) || 0,
      comment_count: comments.get(w.id) || 0,
      fork_count: forks.get(w.id) || 0,
      liked: mine.has(w.id),
      is_owner: Boolean(viewer) && w.owner_session === viewer,
    }));
  }

  async function displayNameOf(ownerKey) {
    if (!ownerKey || !ownerKey.startsWith('u:')) return null;
    const r = await db.from('profiles').select('*').eq('user_id', ownerKey).limit(1);
    return rows(r)?.[0]?.display_name || null;
  }

  // 首次互动时落一条资料，让评论/作品能显示真实昵称，而不是「社区用户」
  async function ensureProfile(user) {
    if (!user) return;
    const key = 'u:' + user.user_id;
    const exists = rows(await db.from('profiles').select('*').eq('user_id', key).limit(1))?.length;
    if (!exists) await db.from('profiles').insert({ user_id: key, display_name: user.name || '创作者', bio: '' }).select();
  }

  async function assetBytes(asset) {
    const res = await storage.download(asset.storage_key);
    if (!res.ok) fail('internal', 503, '资产读取失败，请稍后重试');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > MAX_UPLOAD_BYTES) fail('invalid_input', 413, '图片过大');
    return buf;
  }

  async function storeAsset({ id, sid, kind, visibility, bytes, mime }) {
    const storageKey = `${kind === 'result' ? 'results' : 'assets'}/${id}`;
    await storage.upload(storageKey, bytes, { contentType: mime, upsert: false });
    const { width, height } = imageSize(bytes, mime);
    try {
      rows(await db.from('assets').insert({
        id, owner_session: sid, kind, storage_key: storageKey, visibility,
        content_type: mime, bytes: bytes.length, width, height,
      }));
    } catch (e) {
      // 元数据写入失败时回滚已上传对象，避免产生孤儿存储
      try { await storage.remove([storageKey]); } catch { /* best effort */ }
      throw e;
    }
    return { id, width, height };
  }

  function jobJson(job, resultAsset) {
    return {
      job_id: job.id,
      status: job.status,
      result: job.status === 'succeeded' && resultAsset ? {
        asset_id: resultAsset.id,
        url: publicAssetUrl(resultAsset.id),
        width: resultAsset.width,
        height: resultAsset.height,
        mock: Boolean(job.mock),
        ai_generated: true,
      } : null,
      error: job.error_json || null,
    };
  }

  async function executeJob(job, sid) {
    let baseImage = null;
    if (job.input_asset_id) {
      const asset = await loadOwnedAsset(job.input_asset_id, sid);
      baseImage = { bytes: await assetBytes(asset), mime: asset.content_type };
    } else if (job.input_ref_hash) {
      let file;
      try {
        file = await storage.download(`temp-refs/${job.input_ref_hash}`);
      } catch {
        fail('ephemeral_unavailable', 422, '临时图片已失效，请重新粘贴或上传');
      }
      if (!file?.ok) fail('ephemeral_unavailable', 422, '临时图片已失效，请重新粘贴或上传');
      baseImage = {
        bytes: new Uint8Array(await file.arrayBuffer()),
        mime: file.headers?.get?.('content-type') || 'image/jpeg',
      };
    }
    // 只有明确的上游繁忙/超时才降级演示图；网络/解析/下载失败按失败处理，不计配额。
    const out = await agnes.generate({
      prompt: job.prompt, negativePrompt: job.negative_prompt,
      model: job.model, ratio: job.ratio, baseImage,
    });
    const mock = Boolean(out.busy);
    const result = mock ? mockGenerate({ prompt: job.prompt }) : out;
    const resultId = newId('a');
    const stored = await storeAsset({ id: resultId, sid, kind: 'result', visibility: 'private', bytes: result.bytes, mime: result.mime });
    rows(await db.from('jobs').update({
      status: 'succeeded', result_asset_id: resultId, mock, lease_expires: null, error_json: null,
    }).eq('id', job.id));
    await ephemeral.releaseJob(job.id);
    return { ...job, status: 'succeeded', result_asset_id: resultId, mock, _result: stored };
  }

  async function handle(request) {
    const pathname = new URL(request.url).pathname;
    const idx = pathname.indexOf('/api/v1');
    if (idx < 0) fail('not_found', 404);
    const path = pathname.slice(idx);
    const method = request.method;

    if (path === '/api/v1/health' && method === 'GET') {
      return Response.json({ ok: true, service: 'tupai', keys_configured: scheduler.configured() });
    }

    if (path === '/api/v1/templates' && method === 'GET') {
      await ensureSeeded(db);
      const list = rows(await db.from('templates').select('*').order('sort', { ascending: true }).limit(50)) || [];
      return Response.json({ templates: list.map(templateMeta) });
    }

    const templateMatch = path.match(/^\/api\/v1\/templates\/([a-z0-9-]+)$/);
    if (templateMatch && method === 'GET') {
      await ensureSeeded(db);
      const found = rows(await db.from('templates').select('*').eq('id', templateMatch[1]).limit(1));
      if (!found?.length) fail('not_found', 404);
      return Response.json({ template: templateMeta(found[0]) });
    }

    const coverMatch = path.match(/^\/api\/v1\/templates\/([a-z0-9-]+)\/cover$/);
    if (coverMatch && method === 'GET') {
      await ensureSeeded(db);
      const found = rows(await db.from('templates').select('*').eq('id', coverMatch[1]).limit(1));
      if (!found?.length) fail('not_found', 404);
      const t = found[0];
      if (t.cover_asset_id) {
        const asset = (rows(await db.from('assets').select('*').eq('id', t.cover_asset_id).limit(1)) || [])[0];
        if (asset) {
          const file = await storage.download(asset.storage_key);
          if (file.ok) {
            return new Response(file.body, {
              headers: { 'content-type': asset.content_type, 'cache-control': 'public, max-age=86400' },
            });
          }
        }
      }
      // 无封面时只返回占位图：绝不在请求路径上触发真实出图（首页会预载全部模板封面）
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe6d8"/><stop offset="1" stop-color="#c9a689"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><text x="300" y="380" font-family="sans-serif" font-size="34" fill="#5c4a35" text-anchor="middle">${t.title}</text><text x="300" y="430" font-family="sans-serif" font-size="18" fill="#7a654c" text-anchor="middle">样片生成中 · 稍后刷新</text></svg>`;
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' } });
    }

    if (path === '/api/v1/models' && method === 'GET') {
      return Response.json({
        models: [
          { id: 'agnes-image-2.5-flash', label: 'Agnes Image 2.5', description: '默认推荐', default: true },
          { id: 'agnes-image-2.1-flash', label: 'Agnes Image 2.1', description: '备选对比' },
        ],
      });
    }

    if (path === '/api/v1/me' && method === 'GET') {
      const user = currentUser(request);
      const owner_key = user ? 'u:' + user.user_id : (request.headers.get('x-session-id') || '').toLowerCase() || null;
      return Response.json({
        logged_in: Boolean(user),
        user: user ? { user_id: user.user_id, name: user.name, picture: user.picture } : null,
        owner_key,
      });
    }

    if (path === '/api/v1/me/profile' && method === 'GET') {
      const user = currentUser(request);
      if (!user) fail('login_required', 401);
      const key = 'u:' + user.user_id;
      const row = rows(await db.from('profiles').select('*').eq('user_id', key).limit(1))?.[0] || null;
      return Response.json({
        profile: {
          user_id: key,
          display_name: row?.display_name || user.name || '创作者',
          bio: row?.bio || '',
          avatar_url: user.picture || '',
        },
      });
    }
    if (path === '/api/v1/me/profile' && method === 'PATCH') {
      const user = currentUser(request);
      if (!user) fail('login_required', 401);
      const key = 'u:' + user.user_id;
      const body = await readJson(request);
      const patch = {};
      if (body.display_name !== undefined) patch.display_name = vStr(body.display_name, 'display_name', { max: 30, required: true });
      if (body.bio !== undefined) patch.bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 200) : '';
      if (!Object.keys(patch).length) fail('invalid_input', 400, '没有可更新的字段');
      const exists = rows(await db.from('profiles').select('*').eq('user_id', key).limit(1))?.length;
      const r = exists
        ? await db.from('profiles').update(patch).eq('user_id', key).select()
        : await db.from('profiles').insert({ user_id: key, ...patch }).select();
      if (r.error) fail('internal', 503, '保存资料失败');
      // 改名后同步本人作品的署名，避免历史作品仍显示旧昵称
      if (patch.display_name && patch.display_name.trim()) {
        await db.from('works').update({ author_credit: patch.display_name }).eq('owner_session', key);
      }
      const row = rows(r)?.[0] || {};
      return Response.json({
        profile: { user_id: key, display_name: row.display_name || user.name, bio: row.bio || '', avatar_url: user.picture || '' },
      });
    }

    if (path === '/api/v1/auth/bind' && method === 'POST') {
      const user = currentUser(request);
      if (!user) fail('login_required', 401);
      const guestSid = requireSession(request);
      const target = 'u:' + user.user_id;
      if (guestSid === target) return Response.json({ migrated: 0, owner_key: target });
      let migrated = 0;
      for (const table of ['assets', 'skills', 'jobs', 'albums']) {
        const r = await db.from(table).update({ owner_session: target }).eq('owner_session', guestSid).select();
        if (r.error) fail('internal', 503, '绑定迁移失败，请稍后重试');
        migrated += r.data?.length || 0;
      }
      return Response.json({ migrated, owner_key: target });
    }

    if (path === '/api/v1/quota' && method === 'GET') {
      const sid = ownerOf(request);
      const dayStart = startOfToday();
      const mine = await db.from('jobs').select('id', { count: 'exact' }).eq('owner_session', sid).eq('mock', false).gte('created_at', dayStart).limit(1);
      const all = await db.from('jobs').select('id', { count: 'exact' }).eq('mock', false).gte('created_at', dayStart).limit(1);
      if (mine.error || all.error) fail('internal', 503, '额度查询失败，请稍后重试');
      const sessionUsed = Number(mine.count) || 0;
      const globalUsed = Number(all.count) || 0;
      return Response.json({
        session_used: sessionUsed, session_limit: DAILY_QUOTA_PER_SESSION,
        global_used: globalUsed, global_limit: DAILY_QUOTA_GLOBAL,
        remaining: Math.max(0, Math.min(DAILY_QUOTA_PER_SESSION - sessionUsed, DAILY_QUOTA_GLOBAL - globalUsed)),
      });
    }

    if (path === '/api/v1/assets' && method === 'GET') {
      const sid = ownerOf(request);
      const url = new URL(request.url);
      const kind = url.searchParams.get('kind') ? vOneOf(url.searchParams.get('kind'), 'kind', KIND_VALUES) : '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const tag = (url.searchParams.get('tag') || '').trim();
      const onlyDeleted = url.searchParams.get('only_deleted') === '1';
      const includeDeleted = !onlyDeleted && url.searchParams.get('include_deleted') === '1';
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 60, fallback: 24 });
      const offset = vInt(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
      // 无搜索/标签/回收站条件时分页下推数据库，不再受内存 500 条上限约束
      const dbPaged = !q && !tag && !onlyDeleted;
      let page, total;
      if (dbPaged) {
        // count 与本页共用同一组过滤条件，保证 total 与分页口径一致
        const applyAssetFilters = (query) => {
          let next = query.eq('owner_session', sid);
          if (!includeDeleted) next = next.is('deleted_at', null);
          if (kind) next = next.eq('kind', kind);
          return next;
        };
        const counted = await applyAssetFilters(db.from('assets').select('id', { count: 'exact' })).limit(1);
        if (counted.error) fail('internal', 503, '数据服务暂不可用，请稍后重试');
        total = Number(counted.count) || 0;
        page = rows(await applyAssetFilters(db.from('assets').select('*'))
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)) || [];
      } else {
        // 搜索 / 标签筛选 / 回收站视图仍需内存过滤：最多取 500 条作为该视图的规模上限
        let query = db.from('assets').select('*').eq('owner_session', sid).order('created_at', { ascending: false });
        if (!includeDeleted && !onlyDeleted) query = query.is('deleted_at', null);
        if (kind) query = query.eq('kind', kind);
        const all = rows(await query.range(0, 499)) || [];
        let filtered = all;
        if (onlyDeleted) filtered = filtered.filter((a) => Boolean(a.deleted_at));
        if (tag) filtered = filtered.filter((a) => assetTags(a).includes(tag));
        if (q) filtered = filtered.filter((a) => (a.source || '').toLowerCase().includes(q)
          || assetTags(a).some((t) => String(t).toLowerCase().includes(q)) || a.kind.includes(q));
        total = filtered.length;
        page = filtered.slice(offset, offset + limit);
      }
      // summary 始终按「未删除」统计，回收站视图与常规视图口径一致
      const summary = {};
      for (const k of KIND_VALUES) {
        const c = await db.from('assets').select('id', { count: 'exact' }).eq('owner_session', sid).eq('kind', k).is('deleted_at', null).limit(1);
        summary[k] = Number(c.count) || 0;
      }
      return Response.json({
        assets: page.map(assetMeta), total,
        summary,
        next_offset: offset + limit < total ? offset + limit : null,
      });
    }

    const assetMetaMatch = path.match(/^\/api\/v1\/assets\/(a_[0-9a-f]{24})$/);
    if (assetMetaMatch && method === 'GET') {
      const sid = ownerOf(request);
      const a = await loadOwnedAsset(assetMetaMatch[1], sid);
      return Response.json({ asset: assetMeta(a) });
    }

    if (assetMetaMatch && method === 'PATCH') {
      const sid = ownerOf(request);
      const a = await loadOwnedAsset(assetMetaMatch[1], sid);
      const body = await readJson(request);
      if (!Array.isArray(body.tags)) fail('invalid_input', 400, 'tags 须为数组');
      const tags = body.tags.slice(0, 12).map((t) => String(t).slice(0, 40)).filter(Boolean);
      const r = await db.from('assets').update({ tags }).eq('id', a.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '打标失败，请稍后重试');
      return Response.json({ asset: assetMeta(r.data[0]) });
    }

    if (assetMetaMatch && method === 'DELETE') {
      const sid = ownerOf(request);
      const purge = new URL(request.url).searchParams.get('purge') === '1';
      const a = await loadOwnedAsset(assetMetaMatch[1], sid, { allowDeleted: purge });
      if (!purge) {
        // 已发布作品的结果图不能软删，否则社区出现「有作品无图」
        const published = rows(await db.from('works').select('id').eq('result_asset_id', a.id).eq('status', 'published').limit(1));
        if (published?.length) fail('invalid_input', 409, '该结果已发布为作品，请先撤回或删除作品');
        const deleted_at = new Date().toISOString();
        const r = await db.from('assets').update({ deleted_at }).eq('id', a.id).eq('owner_session', sid).select();
        if (r.error) fail('internal', 503, '删除失败，请稍后重试');
        // 软删后同步移除画册引用，避免分享页/画册残留已删除条目；画册清空时保留但不删
        const albums = rows(await db.from('albums').select('*').eq('owner_session', sid).limit(200)) || [];
        for (const al of albums) {
          const ids = albumItems(al);
          if (!ids.includes(a.id)) continue;
          const next = ids.filter((x) => x !== a.id);
          await db.from('albums').update({ item_ids: next, cover_asset_id: next[0] || null }).eq('id', al.id).eq('owner_session', sid);
        }
        return Response.json({ ok: true, deleted_at });
      }
      // 彻底删除：只允许清理已在回收站的资产，且不得破坏已发布作品
      if (!a.deleted_at) fail('invalid_input', 400, '请先移入回收站，再彻底删除');
      const used = rows(await db.from('works').select('*').eq('result_asset_id', a.id).limit(1));
      if (used?.length) fail('invalid_input', 409, '该资产已关联作品，请先删除作品');
      try { await storage.remove([a.storage_key]); } catch { fail('internal', 503, '存储删除失败，请稍后重试'); }
      const r = await db.from('assets').delete().eq('id', a.id).eq('owner_session', sid);
      if (r.error) fail('internal', 503, '删除失败，请稍后重试');
      // 同步清理画册引用，避免分享页出现空页
      const albums = rows(await db.from('albums').select('*').eq('owner_session', sid).limit(200)) || [];
      for (const al of albums) {
        const ids = albumItems(al);
        if (!ids.includes(a.id)) continue;
        const next = ids.filter((x) => x !== a.id);
        if (next.length) await db.from('albums').update({ item_ids: next, cover_asset_id: next[0] }).eq('id', al.id);
        else await db.from('albums').delete().eq('id', al.id);
      }
      return Response.json({ ok: true, purged: true });
    }

    const restoreMatch = path.match(/^\/api\/v1\/assets\/(a_[0-9a-f]{24})\/restore$/);
    if (restoreMatch && method === 'POST') {
      const sid = ownerOf(request);
      const a = await loadOwnedAsset(restoreMatch[1], sid, { allowDeleted: true });
      const r = await db.from('assets').update({ deleted_at: null }).eq('id', a.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '恢复失败，请稍后重试');
      return Response.json({ asset: assetMeta(r.data[0]) });
    }

    if (path === '/api/v1/assets' && method === 'POST') {
      const sid = ownerOf(request);
      let form;
      try { form = await request.formData(); } catch { fail('invalid_input', 400, '上传格式有误'); }
      const file = form.get('file');
      const kind = String(form.get('kind') || 'original');
      if (!['original', 'reference'].includes(kind)) fail('invalid_input', 400, 'kind 不合法');
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') fail('invalid_input', 400, '缺少图片文件');
      const mime = (file.type || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_TYPES.includes(mime)) fail('invalid_input', 415, '仅支持 JPG / PNG / WebP 图片');
      if (file.size > MAX_UPLOAD_BYTES) fail('invalid_input', 413, '图片超过 15MB 上限');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) fail('invalid_input', 413, '图片大小不合法');
      const sniffed = sniffImageType(bytes);
      if (!sniffed || sniffed !== mime) fail('invalid_input', 415, '文件内容不是有效的 JPG / PNG / WebP 图片');
      const { width, height } = imageSize(bytes, sniffed);
      if (!width || !height) fail('invalid_input', 415, '无法解析图片尺寸，请更换图片后重试');
      const id = newId('a');
      const stored = await storeAsset({ id, sid, kind, visibility: 'private', bytes, mime: sniffed });
      return Response.json({
        asset_id: id, kind, width: stored.width, height: stored.height,
        preview_url: publicAssetUrl(id),
      }, { status: 201 });
    }

    const contentMatch = path.match(/^\/api\/v1\/assets\/(a_[0-9a-f]{24})\/content$/);
    if (contentMatch && method === 'GET') {
      const found = rows(await db.from('assets').select('*').eq('id', contentMatch[1]).limit(1));
      if (!found?.length) fail('not_found', 404);
      const asset = found[0];
      // 回收站中的资产不再提供图片字节，前端用占位图展示；恢复后才可再次读取
      if (asset.deleted_at) fail('not_found', 404, '资产已移入回收站');
      const url = new URL(request.url);
      const ticket = url.searchParams.get('ticket');
      const watermarkMode = url.searchParams.get('watermark');
      if (ticket) {
        const entry = downloadTickets.get(ticket);
        if (!entry || entry.assetId !== asset.id) fail('not_found', 404);
        if (entry.used) fail('not_found', 410, '下载地址已使用，请重新获取');
        if (Date.now() > entry.expires) fail('not_found', 410, '下载地址已过期');
        if (asset.visibility === 'private' && ownerOf(request) !== entry.owner) fail('not_found', 403);
        entry.used = true;
      }
      if (asset.visibility === 'private') {
        const sid = ownerOf(request);
        if (asset.owner_session !== sid) fail('not_found', 404);
      }
      const file = await storage.download(asset.storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      const forcedWatermark = Boolean(ticket) || watermarkMode === 'required' || watermarkMode === '1';
      if (!forcedWatermark) {
        return new Response(file.body, {
          headers: {
            'content-type': asset.content_type,
            'cache-control': asset.visibility === 'private' ? 'private, no-store' : 'public, max-age=86400',
            'x-content-type-options': 'nosniff',
          },
        });
      }
      if ((asset.watermark_state || 'none') === 'failed') {
        fail('watermark_unavailable', 409, '该图片的 AI 标识生成失败，已拒绝下载');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { width, height } = imageSize(bytes, asset.content_type);
      if ((asset.watermark_state || 'none') !== 'svg_wrapped') {
        await db.from('assets').update({
          watermark_state: 'svg_wrapped', watermark_version: 1,
          watermarked_at: new Date().toISOString(),
        }).eq('id', asset.id);
      }
      return new Response(shareWatermarkSvg(bytes, asset.content_type, width, height), {
        headers: {
          'content-type': 'image/svg+xml',
          'cache-control': 'private, no-store',
          'x-watermark-state': 'svg_wrapped',
          'x-content-type-options': 'nosniff',
        },
      });
    }

    const downloadTicketMatch = path.match(/^\/api\/v1\/assets\/(a_[0-9a-f]{24})\/download-ticket$/);
    if (downloadTicketMatch && method === 'POST') {
      const sid = ownerOf(request);
      const asset = await loadOwnedAsset(downloadTicketMatch[1], sid);
      if (asset.kind !== 'result') fail('invalid_input', 400, '仅结果图支持下载授权');
      const ticket = crypto.randomUUID().replace(/-/g, '');
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      downloadTickets.set(ticket, {
        assetId: asset.id, owner: sid, expires: Date.now() + 60_000, used: false,
      });
      return Response.json({
        ticket,
        url: `${publicAssetUrl(asset.id)}?watermark=required&ticket=${ticket}`,
        expires_at: expiresAt,
      });
    }

    if (path === '/api/v1/optimize' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
      const assetId = typeof body?.asset_id === 'string' ? body.asset_id : '';
      if (!text && !assetId) fail('invalid_input', 400, '请上传图片或输入文字');
      const count = vInt(body?.count, 'count', { min: 2, max: 4, fallback: 3 });
      let imageBytes = null, imageMime = null;
      if (assetId) {
        const asset = await loadOwnedAsset(assetId, sid);
        imageBytes = await assetBytes(asset);
        imageMime = asset.content_type;
      }
      let out;
      try { out = await agnes.optimize({ imageBytes, imageMime, text, count }); }
      catch { fail('provider_busy', 503, '风格分析服务暂时不可用，请稍后重试或手动输入提示词'); }
      if (out.parseFailed || !out.candidates?.length) {
        // 上游返回不可解析时不再静默伪装成成功，避免用户误以为得到了真实分析
        if (!out.busy) fail('provider_busy', 503, '风格分析结果解析失败，请重试');
      }
      // 仅上游繁忙/超时降级为演示候选，且不计入生成配额
      const mock = Boolean(out.busy);
      if (mock) out = mockOptimize({ text, count });
      if (assetId && out.candidates?.length) {
        const autoTags = [...new Set((out.tags || []).concat(out.candidates.flatMap((c) => c.style_tags || [])))].slice(0, 12);
        if (autoTags.length) await db.from('assets').update({ tags: autoTags }).eq('id', assetId).eq('owner_session', sid).select();
      }
      await ensureSeeded(db);
      const templates = rows(await db.from('templates').select('*').limit(50)) || [];
      const skills = rows(await db.from('skills').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(50)) || [];
      const queryTags = out.tags || [];
      const overlapTags = (itemTags) => queryTags.filter((q) => (itemTags || []).some((t) => t === q || t.includes(q) || q.includes(t)));
      const templateItems = templates.map((t) => {
        const meta = TEMPLATES.find((x) => x.id === t.id) || {};
        return {
          type: 'template', id: t.id, title: t.title, description: t.description,
          cover_url: t.cover_asset_id ? publicAssetUrl(t.cover_asset_id) : `/api/v1/templates/${t.id}/cover`,
          prompt: t.prompt, negative_prompt: t.negative_prompt,
          sample_prompt: meta.sample_prompt || null, variants: meta.variants || [],
          default_model: t.default_model, ratio: t.ratio,
          match_tags: overlapTags(t.tags || []),
          score: scoreMatch(queryTags, t.tags || [], t.features),
        };
      });
      const skillItems = skills.map((s) => {
        const meta = s.meta_json || {};
        const cover = safeCoverUrl(meta.cover_url) || '';
        return {
          type: 'skill', id: s.id, title: s.title, description: meta.notes || '我的配方',
          cover_url: cover, cover_private: Boolean(cover),
          prompt: s.prompt, negative_prompt: s.negative_prompt || '',
          model: s.model, ratio: meta.params?.aspect || '3:4',
          match_tags: overlapTags(s.tags || []),
          score: scoreMatch(queryTags, s.tags || [], ''),
        };
      });
      let recommendations = [...templateItems, ...skillItems]
        .filter((x) => x.score >= 0.15)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => ({ ...x, score: Math.round(x.score * 100) / 100 }));
      const recommendationsFallback = recommendations.length === 0;
      if (recommendationsFallback) recommendations = templateItems.slice(0, 5);
      return Response.json({
        candidates: out.candidates,
        recommendations,
        recommendations_fallback: recommendationsFallback,
        mode: assetId ? 'img2img' : 'txt2img',
        ...(mock ? { mock: true } : {}),
      });
    }

    if (path === '/api/v1/jobs/generate' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt || prompt.length > 4000) fail('invalid_input', 400, '提示词不能为空且不超过 4000 字');
      const negativePrompt = typeof body?.negative_prompt === 'string' ? body.negative_prompt.slice(0, 1000) : null;
      const model = typeof body?.model === 'string' && body.model ? body.model : 'agnes-image-2.5-flash';
      if (!MODEL_WHITELIST.includes(model)) fail('invalid_input', 400, '模型不在可用列表');
      const ratio = typeof body?.ratio === 'string' && body.ratio ? body.ratio : '3:4';
      if (!RATIOS.includes(ratio)) fail('invalid_input', 400, '画幅比例不合法');
      let inputAssetId = null;
      let inputRefHash = null;
      const referenceToken = typeof body?.reference_token === 'string' ? body.reference_token.trim() : '';
      if (body?.asset_id && referenceToken) fail('reference_conflict', 400, 'asset_id 与 reference_token 只能二选一');
      if (body?.asset_id) {
        const asset = await loadOwnedAsset(String(body.asset_id), sid);
        inputAssetId = asset.id;
      }
      const dayStart = startOfToday();
      const mine = await db.from('jobs').select('id', { count: 'exact' }).eq('owner_session', sid).eq('mock', false).gte('created_at', dayStart).limit(1);
      if (!mine.error && mine.count >= DAILY_QUOTA_PER_SESSION) fail('quota_exceeded', 429);
      const all = await db.from('jobs').select('id', { count: 'exact' }).eq('mock', false).gte('created_at', dayStart).limit(1);
      if (!all.error && all.count >= DAILY_QUOTA_GLOBAL) fail('provider_busy', 429, '今日站点生成额度已满，明天再来');
      if (referenceToken) {
        const consumed = await ephemeral.consume(referenceToken, sid);
        inputRefHash = consumed.hash;
      }
      const id = newId('j');
      rows(await db.from('jobs').insert({
        id, owner_session: sid, status: 'queued', prompt, negative_prompt: negativePrompt,
        model, ratio, input_asset_id: inputAssetId, input_ref_hash: inputRefHash,
        attempts: 0, mock: false,
      }));
      if (inputRefHash) await ephemeral.bindJob(inputRefHash, id);
      return Response.json({ job_id: id, status: 'queued' }, { status: 202 });
    }

    const jobMatch = path.match(/^\/api\/v1\/jobs\/(j_[0-9a-f]{24})$/);
    if (jobMatch && method === 'GET') {
      const sid = ownerOf(request);
      const found = rows(await db.from('jobs').select('*').eq('id', jobMatch[1]).eq('owner_session', sid).limit(1));
      if (!found?.length) fail('not_found', 404);
      let job = found[0];
      const now = Date.now();
      const leaseExpired = !job.lease_expires || new Date(job.lease_expires).getTime() <= now;
      const claimable = (job.status === 'queued' || (job.status === 'running' && leaseExpired)) && job.attempts < MAX_ATTEMPTS;
      if (claimable) {
        const claimed = rows(await db.from('jobs').update({
          status: 'running', lease_expires: new Date(now + LEASE_MS).toISOString(), attempts: job.attempts + 1,
        }).eq('id', job.id).eq('status', job.status).eq('attempts', job.attempts).select());
        if (claimed?.length) {
          try {
            job = await executeJob({ ...job, attempts: job.attempts + 1 }, sid);
          } catch (e) {
            const code = e instanceof AppError ? e.code : 'internal';
            const message = e instanceof AppError ? e.message : MESSAGES.internal;
            rows(await db.from('jobs').update({
              status: 'failed', lease_expires: null, error_json: { code, message },
            }).eq('id', job.id));
            job = { ...job, status: 'failed', error_json: { code, message } };
            await ephemeral.releaseJob(job.id);
          }
        }
      } else if (job.status === 'running' && leaseExpired && job.attempts >= MAX_ATTEMPTS) {
        rows(await db.from('jobs').update({
          status: 'failed', lease_expires: null,
          error_json: { code: 'provider_busy', message: '生成多次超时，请稍后重试' },
        }).eq('id', job.id));
        job = { ...job, status: 'failed', error_json: { code: 'provider_busy', message: '生成多次超时，请稍后重试' } };
      }
      let resultAsset = null;
      if (job.status === 'succeeded' && job.result_asset_id) {
        resultAsset = (rows(await db.from('assets').select('*').eq('id', job.result_asset_id).limit(1)) || [])[0] || null;
      }
      return Response.json(jobJson(job, resultAsset));
    }

    function validateSkill(body) {
      if (!body || typeof body !== 'object') fail('invalid_input', 422, '配方不是合法 JSON 对象');
      if (body.format !== 'tupai-skill') fail('invalid_input', 422, '缺少 format 字段（应为 tupai-skill）');
      if (body.version !== 1) fail('invalid_input', 422, 'version 必须为 1');
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.length > 100) fail('invalid_input', 422, '缺少 title 字段');
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 4000) fail('invalid_input', 422, '缺少 prompt 字段');
      if (typeof body.model !== 'string' || !body.model.trim() || body.model.length > 100) fail('invalid_input', 422, '缺少 model 字段');
      if (!MODEL_WHITELIST.includes(body.model)) fail('invalid_input', 422, 'model 不在支持列表中');
      if (body.params && typeof body.params === 'object') {
        if (body.params.aspect && !RATIOS.includes(body.params.aspect)) fail('invalid_input', 422, '画幅不受支持');
      }
      if (body.style_tags !== undefined) {
        if (!Array.isArray(body.style_tags) || body.style_tags.some((t) => typeof t !== 'string')) {
          fail('invalid_input', 422, 'style_tags 必须是字符串数组');
        }
      }
    }

    if (path === '/api/v1/skills' && method === 'GET') {
      const sid = ownerOf(request);
      const list = rows(await db.from('skills').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(50)) || [];
      return Response.json({
        skills: list.map((s) => {
          const meta = s.meta_json || {};
          return {
            ...meta, skill_id: s.id, title: s.title, prompt: s.prompt,
            negative_prompt: s.negative_prompt || '',
            model: s.model, template_id: s.template_id || meta.template_id,
            style_tags: s.tags || [], cover_url: safeCoverUrl(meta.cover_url) || '',
            created_at: meta.created_at || s.created_at,
          };
        }),
      });
    }

    if (path === '/api/v1/skills' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      validateSkill(body);
      const id = newId('s');
      const meta = { ...body };
      const cover = safeCoverUrl(body.cover_url);
      if (cover) meta.cover_url = cover; else delete meta.cover_url;
      rows(await db.from('skills').insert({
        id, owner_session: sid, title: body.title.trim(), prompt: body.prompt,
        negative_prompt: typeof body.negative_prompt === 'string' ? body.negative_prompt : null,
        model: body.model, template_id: typeof body.template_id === 'string' ? body.template_id : null,
        tags: Array.isArray(body.style_tags) ? body.style_tags.slice(0, 12) : [], meta_json: meta,
      }));
      return Response.json({ skill_id: id }, { status: 201 });
    }

    if (path === '/api/v1/skills/import' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      validateSkill(body);
      const id = newId('s');
      const meta = { ...body };
      const cover = safeCoverUrl(body.cover_url);
      if (cover) meta.cover_url = cover; else delete meta.cover_url;
      rows(await db.from('skills').insert({
        id, owner_session: sid, title: body.title.trim(), prompt: body.prompt,
        negative_prompt: typeof body.negative_prompt === 'string' ? body.negative_prompt : null,
        model: body.model, template_id: typeof body.template_id === 'string' ? body.template_id : null,
        tags: Array.isArray(body.style_tags) ? body.style_tags.slice(0, 12) : [], meta_json: meta,
      }));
      return Response.json({ ...meta, skill_id: id });
    }

    const skillMatch = path.match(/^\/api\/v1\/skills\/(s_[0-9a-f]{24})(\/skill\.md)?$/);
    if (skillMatch && method === 'GET') {
      const sid = ownerOf(request);
      const found = rows(await db.from('skills').select('*').eq('id', skillMatch[1]).eq('owner_session', sid).limit(1));
      if (!found?.length) fail('not_found', 404);
      const skill = found[0];
      if (skillMatch[2]) {
        return new Response(renderSkillMarkdown({ ...skill.meta_json, title: skill.title, tags: skill.tags }), {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return Response.json({ ...skill.meta_json, skill_id: skill.id });
    }
    if (skillMatch && !skillMatch[2] && method === 'PATCH') {
      const sid = ownerOf(request);
      const found = rows(await db.from('skills').select('*').eq('id', skillMatch[1]).eq('owner_session', sid).limit(1));
      if (!found?.length) fail('not_found', 404);
      const skill = found[0];
      const body = await readJson(request);
      const patch = {};
      const meta = { ...(skill.meta_json || {}) };
      if (body.title !== undefined) { patch.title = vStr(body.title, 'title', { max: 100, required: true }); meta.title = patch.title; }
      if (body.prompt !== undefined) { patch.prompt = vStr(body.prompt, 'prompt', { max: 4000, required: true }); meta.prompt = patch.prompt; }
      if (body.negative_prompt !== undefined) {
        patch.negative_prompt = typeof body.negative_prompt === 'string' ? body.negative_prompt.slice(0, 1000) : null;
        meta.negative_prompt = patch.negative_prompt;
      }
      if (body.model !== undefined) {
        if (!MODEL_WHITELIST.includes(body.model)) fail('invalid_input', 422, 'model 不在支持列表中');
        patch.model = body.model; meta.model = body.model;
      }
      if (body.style_tags !== undefined) {
        patch.tags = vStringArray(body.style_tags, 'style_tags', { max: 12, itemMax: 40 });
        meta.style_tags = patch.tags;
      }
      if (body.notes !== undefined) meta.notes = typeof body.notes === 'string' ? body.notes.slice(0, 300) : '';
      if (!Object.keys(patch).length && body.notes === undefined) fail('invalid_input', 400, '没有可更新的字段');
      patch.meta_json = meta;
      const r = await db.from('skills').update(patch).eq('id', skill.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '更新配方失败');
      return Response.json({ ...meta, skill_id: skill.id });
    }
    if (skillMatch && !skillMatch[2] && method === 'DELETE') {
      const sid = ownerOf(request);
      const found = rows(await db.from('skills').select('*').eq('id', skillMatch[1]).eq('owner_session', sid).limit(1));
      if (!found?.length) fail('not_found', 404);
      const r = await db.from('skills').delete().eq('id', found[0].id).eq('owner_session', sid);
      if (r.error) fail('internal', 503, '删除配方失败');
      return Response.json({ ok: true });
    }

    if (path === '/api/v1/assets/temp-ref' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      const tempUrl = typeof body?.temp_url === 'string' ? body.temp_url.trim() : '';
      if (!tempUrl) fail('invalid_input', 400, '缺少 temp_url');
      return Response.json(await ephemeral.issue(tempUrl, sid));
    }

    if (path === '/api/v1/links/parse' && method === 'POST') {
      const sid = ownerOf(request);
      if (!takeParseSlot(sid)) fail('quota_exceeded', 429, '解析太频繁，请稍后再试');
      const body = await readJson(request);
      const raw = typeof body?.url === 'string' ? body.url.trim() : '';
      let u;
      try { u = new URL(raw); } catch { fail('parse_failed', 422, '链接格式有误，请粘贴抖音图文分享链接'); }
      if (!isDouyinHost(u.hostname)) fail('parse_failed', 422, '仅支持抖音图文链接；其他平台请手动上传图片或文字');
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
      let finalUrl = raw, html = '';
      try {
        const res = await fetchImpl(raw, { headers: { 'User-Agent': ua, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        finalUrl = res.url || raw;
        // 跟随重定向后必须复核 host，避免被 30x 带到内网或其他域名
        let finalHost = '';
        try { finalHost = new URL(finalUrl).hostname; } catch { /* ignore */ }
        if (!isDouyinHost(finalHost)) fail('parse_failed', 422, '链接跳转到了非抖音页面，已停止解析');
        if (/\/video\//.test(finalUrl)) fail('parse_failed', 422, '这是视频链接，请截帧后上传图片');
        const declared = Number(res.headers.get('content-length') || 0);
        if (declared > PARSE_MAX_HTML_BYTES) fail('parse_failed', 422, '页面过大，请手动上传图片或文字');
        html = await res.text();
        if (html.length > PARSE_MAX_HTML_BYTES) fail('parse_failed', 422, '页面过大，请手动上传图片或文字');
      } catch (e) {
        if (e instanceof AppError) throw e;
        fail('parse_failed', 422, '链接访问失败（可能被风控拦截），请直接上传图片或文字');
      }
      //  best-effort 提取图文：仅取抖音 CDN 图片 URL，不持久化（用后即焚，返回临时直链）
      const matches = [...html.matchAll(/https?:\/\/[^"'\s\\<>]+?\.(?:jpeg|jpg|png|webp)[^"'\s\\<>]*/g)].map((m) => m[0]);
      const images = [...new Set(matches.filter((x) => /douyinpic|byteimg|snssdk|zjcdn/.test(x)))].slice(0, 9);
      const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const text = titleM ? titleM[1].replace(/\s*-\s*抖音.*$/, '').trim().slice(0, 500) : '';
      if (!images.length) fail('parse_failed', 422, '未能从链接提取图文（可能风控或为视频），请手动上传图片或文字');
      const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      return Response.json({ source_url: finalUrl, text, images: images.map((url) => ({ temp_url: url, expires_at })) });
    }

    if (path === '/api/v1/albums' && method === 'POST') {
      const sid = ownerOf(request);
      const body = await readJson(request);
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
      if (!title) fail('invalid_input', 400, '请给画册起个名字');
      const ids = [...new Set(vStringArray(body.item_ids, 'item_ids', { max: 50, itemMax: 80 }))].map((id) => vId(id, 'item_ids', 'a'));
      if (!ids.length) fail('invalid_input', 400, '请至少选择一张作品');
      for (const id of ids) {
        const a = await loadOwnedAsset(id, sid);
        if (a.kind !== 'result') fail('invalid_input', 400, '画册只收录生成作品，不含原图');
      }
      const id = newId('al');
      const r = await db.from('albums').insert({
        id, owner_session: sid, title, cover_asset_id: ids[0], item_ids: ids,
        template_id: '3d-book', visibility: 'private', render_status: 'ready',
      }).select();
      if (r.error) fail('internal', 503, '创建画册失败，请稍后重试');
      return Response.json({ album: albumMeta(r.data[0]) }, { status: 201 });
    }

    if (path === '/api/v1/albums' && method === 'GET') {
      const sid = ownerOf(request);
      const list = rows(await db.from('albums').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(100)) || [];
      return Response.json({ albums: list.map(albumMeta) });
    }

    const albumMatch = path.match(/^\/api\/v1\/albums\/(al_[0-9a-f]{24})$/);
    if (albumMatch && method === 'GET') {
      const sid = ownerOf(request);
      return Response.json({ album: albumMeta(await loadOwnedAlbum(albumMatch[1], sid)) });
    }
    if (albumMatch && method === 'PATCH') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(albumMatch[1], sid);
      const body = await readJson(request);
      const patch = {};
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 100);
      if (Array.isArray(body.item_ids)) {
        const ids = [...new Set(vStringArray(body.item_ids, 'item_ids', { max: 50, itemMax: 80 }))].map((id) => vId(id, 'item_ids', 'a'));
        if (!ids.length) fail('invalid_input', 400, '请至少保留一张作品');
        const before = albumItems(album);
        for (const id of ids) {
          // 已软删但仍留在本画册的条目允许保留；新加入的已删资产仍报 400
          const a = await loadOwnedAsset(id, sid, { allowDeleted: true });
          if (a.deleted_at && !before.includes(id)) fail('invalid_input', 400, '资产已移入回收站，无法加入画册');
          if (a.kind !== 'result') fail('invalid_input', 400, '画册只收录生成作品');
        }
        patch.item_ids = ids; patch.cover_asset_id = ids[0];
      }
      const r = await db.from('albums').update(patch).eq('id', album.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '更新失败，请稍后重试');
      return Response.json({ album: albumMeta(r.data[0]) });
    }
    if (albumMatch && method === 'DELETE') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(albumMatch[1], sid);
      const r = await db.from('albums').delete().eq('id', album.id).eq('owner_session', sid);
      if (r.error) fail('internal', 503, '删除失败，请稍后重试');
      return Response.json({ ok: true });
    }

    // 画册 ZIP 导出：仅所有者；打包仍存活的作品图，store 模式（不压缩），零第三方依赖
    const exportMatch = path.match(/^\/api\/v1\/albums\/(al_[0-9a-f]{24})\/export\.zip$/);
    if (exportMatch && method === 'GET') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(exportMatch[1], sid);
      const ids = await liveAlbumIds(album);
      if (!ids.length) fail('invalid_input', 400, '画册暂无作品，无法导出');
      const files = [];
      for (const id of ids) {
        const asset = (rows(await db.from('assets').select('*').eq('id', id).limit(1)) || [])[0];
        if (!asset) continue;
        let file;
        try { file = await storage.download(asset.storage_key); } catch { continue; }
        if (!file?.ok) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        files.push({ name: `${String(files.length + 1).padStart(2, '0')}-${id}.${extFromImageType(asset.content_type)}`, bytes });
      }
      // 全部下载失败时按空画册处理，避免返回 0 条目的空包
      if (!files.length) fail('invalid_input', 400, '画册暂无作品，无法导出');
      const zip = buildZip(files);
      return new Response(zip, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="tupai-album.zip"; filename*=UTF-8''${encodeURIComponent(album.title)}.zip`,
          'cache-control': 'private, no-store',
        },
      });
    }

    const shareMatch = path.match(/^\/api\/v1\/albums\/(al_[0-9a-f]{24})\/share$/);
    if (shareMatch && method === 'POST') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(shareMatch[1], sid);
      // 空画册（或全部条目已软删）不可分享，避免分享出空页
      const liveIds = await liveAlbumIds(album);
      if (!liveIds.length) fail('invalid_input', 400, '画册暂无作品，无法分享');
      const body = await readJson(request).catch(() => ({}));
      const hours = vInt(body.expires_hours, 'expires_hours', { min: 1, max: 24 * 30, fallback: 24 * 7 });
      const token = crypto.randomUUID().replace(/-/g, '');
      const expires = new Date(Date.now() + hours * 3600 * 1000).toISOString();
      const r = await db.from('albums').update({ visibility: 'unlisted', share_token: token, share_expires_at: expires }).eq('id', album.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '生成分享链接失败');
      return Response.json({ share_token: token, share_page: `/api/v1/share/${token}/page`, expires_at: expires });
    }
    if (shareMatch && method === 'DELETE') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(shareMatch[1], sid);
      const r = await db.from('albums').update({ visibility: 'private', share_token: null, share_expires_at: null }).eq('id', album.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '撤回失败');
      return Response.json({ ok: true });
    }

    const shareView = path.match(/^\/api\/v1\/share\/([0-9a-f]{32})$/);
    if (shareView && method === 'GET') {
      const album = await loadSharedAlbum(shareView[1]);
      const ids = await liveAlbumIds(album);
      return Response.json({
        title: album.title, created_at: album.created_at,
        images: ids.map((id) => `/api/v1/share/${shareView[1]}/img/${id}`),
      });
    }
    const shareImg = path.match(/^\/api\/v1\/share\/([0-9a-f]{32})\/img\/(a_[0-9a-f]{24})$/);
    if (shareImg && method === 'GET') {
      const album = await loadSharedAlbum(shareImg[1]);
      if (!albumItems(album).includes(shareImg[2])) fail('not_found', 404);
      const found = rows(await db.from('assets').select('*').eq('id', shareImg[2]).limit(1));
      if (!found?.length || found[0].kind !== 'result' || found[0].deleted_at) fail('not_found', 404);
      const asset = found[0];
      const watermark = new URL(request.url).searchParams.get('watermark') === '1';
      const file = await storage.download(asset.storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      // 默认保持原始字节与原 content-type；?watermark=1 才返回带角标的 SVG 包装
      if (!watermark) {
        return new Response(file.body, { headers: { 'content-type': asset.content_type, 'cache-control': 'private, no-store' } });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { width, height } = imageSize(bytes, asset.content_type);
      return new Response(shareWatermarkSvg(bytes, asset.content_type, width, height), {
        headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store' },
      });
    }
    const sharePage = path.match(/^\/api\/v1\/share\/([0-9a-f]{32})\/page$/);
    if (sharePage && method === 'GET') {
      let album;
      try {
        album = await loadSharedAlbum(sharePage[1]);
      } catch (e) {
        // 过期/撤回/不存在时给友好 HTML 落地页，而不是 JSON 错误信封
        if (e instanceof AppError && e.status === 404) {
          return new Response(shareExpiredHtml(), { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
        }
        throw e;
      }
      const ids = await liveAlbumIds(album);
      // 多模板：?style=hardcover|editorial|cards|film（非法值回退默认，见 album-styles.mjs）
      const styleParam = new URL(request.url).searchParams.get('style') || '';
      const style = albumStyleIds().includes(styleParam) ? styleParam : 'hardcover';
      return new Response(albumPageHtml(album.title, ids, style), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
    }

    // ---- 技能演示（公开只读）：社区「技能」区按画册呈现每个技能的原图→作品示例 ----
    if (path === '/api/v1/showcase/skills' && method === 'GET') {
      const list = rows(await db.from('showcase_skills').select('*').limit(500)) || [];
      const live = await liveShowcasePairs(list);
      const skills = list
        .filter((s) => (live.get(s.id) || []).length > 0)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0))
        .map((s) => showcaseMeta(s, live.get(s.id)));
      return Response.json({ skills });
    }
    const showcaseSkillMatch = path.match(/^\/api\/v1\/showcase\/skills\/([a-z0-9][a-z0-9-]{0,63})$/);
    if (showcaseSkillMatch && method === 'GET') {
      const found = rows(await db.from('showcase_skills').select('*').eq('id', showcaseSkillMatch[1]).limit(1));
      if (!found?.length) fail('not_found', 404);
      const s = found[0];
      const livePairs = (await liveShowcasePairs([s])).get(s.id) || [];
      if (!livePairs.length) fail('not_found', 404);
      const album = s.album_id ? rows(await db.from('albums').select('*').eq('id', s.album_id).limit(1))?.[0] : null;
      return Response.json({
        skill: showcaseMeta(s, livePairs),
        pairs: livePairs.map((p) => ({
          original_url: `/api/v1/showcase/img/${p.original_id}`,
          result_url: `/api/v1/showcase/img/${p.result_id}`,
          result_asset_id: p.result_id,
        })),
        album: album && shareActive(album)
          ? { share_token: album.share_token, share_page: `/api/v1/share/${album.share_token}/page` }
          : null,
      });
    }
    // 展示图仅限种子对中登记过、且原图与结果都未软删的资产（原图语料为公开授权图片）；用户资产不出现在其中
    const showcaseImgMatch = path.match(/^\/api\/v1\/showcase\/img\/(a_[0-9a-f]{24})$/);
    if (showcaseImgMatch && method === 'GET') {
      const allowed = await showcaseAllowedIds();
      if (!allowed.has(showcaseImgMatch[1])) fail('not_found', 404);
      const found = rows(await db.from('assets').select('*').eq('id', showcaseImgMatch[1]).limit(1));
      if (!found?.length || found[0].deleted_at) fail('not_found', 404);
      const file = await storage.download(found[0].storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      return new Response(file.body, { headers: { 'content-type': found[0].content_type, 'cache-control': 'public, max-age=300' } });
    }

    if (path === '/api/v1/works' && method === 'POST') {
      const user = currentUser(request);
      if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const body = await readJson(request);
      const title = typeof body.title === 'string' ? body.title.trim().slice(0, 100) : '';
      if (!title) fail('invalid_input', 400, '请给作品起个标题');
      const raid = typeof body.result_asset_id === 'string' ? body.result_asset_id : '';
      const asset = await loadOwnedAsset(raid, sid);
      if (asset.kind !== 'result') fail('invalid_input', 400, '只能发布生成作品，原图不公开');
      const snap = body.skill_snapshot || {};
      if (typeof snap.prompt !== 'string' || !snap.prompt.trim()) fail('invalid_input', 400, '缺少配方提示词');
      const tags = vStringArray(body.tags, 'tags', { max: 12, itemMax: 40 });
      const bytes = await assetBytes(asset);
      const mod = await moderateWork({ title, tags, imageBytes: bytes, imageMime: asset.content_type });
      if (!mod.ok) fail('invalid_input', 422, mod.reason);
      let depth = 0, parentWork = null, parentSkill = null;
      let lineageCredits = [];
      let lineageTruncated = false;
      const credit = user.name || '匿名创作者';
      if (typeof body.parent_work_id === 'string' && body.parent_work_id) {
        const pw = await loadWork(body.parent_work_id);
        if (pw.status !== 'published') fail('invalid_input', 400, '来源作品不可 fork');
        if (!pw.allow_fork) fail('invalid_input', 403, '作者已关闭 fork');
        depth = (pw.depth || 0) + 1; parentWork = pw.id; parentSkill = pw.parent_skill_id || pw.id;
        const built = await buildLineageCredits(pw);
        lineageCredits = built.credits;
        lineageTruncated = built.truncated;
      }
      const id = newId('wk');
      const r = await db.from('works').insert({
        id, owner_session: sid, result_asset_id: raid,
        skill_snapshot: { prompt: snap.prompt.slice(0, 4000), negative_prompt: snap.negative_prompt || null, model: snap.model || 'agnes-image-2.5-flash', ratio: snap.ratio || '3:4' },
        title, tags, status: 'published', allow_fork: body.allow_fork !== false,
        parent_work_id: parentWork, parent_skill_id: parentSkill, depth, author_credit: credit,
        lineage_credits: lineageCredits, lineage_truncated: lineageTruncated,
        moderation_degraded: Boolean(mod.degraded),
      }).select();
      if (r.error) fail('internal', 503, '发布失败，请稍后重试');
      if (mod.degraded) {
        await createReviewItem({
          workId: id, source: 'moderation_degraded',
          reason: '审核服务降级，发布需人工复核',
        });
      }
      if (parentWork) {
        const pw = await loadWork(parentWork);
        if (pw.owner_session !== sid) await notify(pw.owner_session, 'fork', id, `${credit} fork 了你的作品`);
      }
      return Response.json({ work: workMeta(r.data[0]) }, { status: 201 });
    }

    if (path === '/api/v1/feed' && method === 'GET') {
      const url = new URL(request.url);
      const tag = url.searchParams.get('tag') || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const sort = vOneOf(url.searchParams.get('sort') || 'new', 'sort', SORT_VALUES);
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 48, fallback: 24 });
      const offset = vInt(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
      // 最新且无筛选时：总数与分页直接下推数据库，不受内存 500 条上限约束
      if (!tag && !q && sort === 'new') {
        const counted = await db.from('works').select('id', { count: 'exact' }).eq('status', 'published').limit(1);
        if (counted.error) fail('internal', 503, '数据服务暂不可用，请稍后重试');
        const total = Number(counted.count) || 0;
        const page = rows(await db.from('works').select('*').eq('status', 'published')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1)) || [];
        const works = await batchMeta(page, viewerKey(request));
        return Response.json({ works, total, next_offset: offset + limit < total ? offset + limit : null });
      }
      // 搜索/热榜视图需内存过滤与排序：最多取 500 条作为社区当前规模上限
      const all = rows(await db.from('works').select('*').eq('status', 'published').order('created_at', { ascending: false }).range(0, 499)) || [];
      let filtered = all;
      if (tag) filtered = filtered.filter((w) => jsonArr(w.tags).includes(tag));
      if (q) filtered = filtered.filter((w) => w.title.toLowerCase().includes(q)
        || (w.author_credit || '').toLowerCase().includes(q)
        || jsonArr(w.tags).some((t) => String(t).toLowerCase().includes(q))
        || String(w.skill_snapshot?.prompt || '').toLowerCase().includes(q));
      if (sort === 'hot') {
        // 一次取回点赞做内存计数，按热度排序，避免逐作品查询
        const allLikes = rows(await db.from('likes').select('*').limit(20000)) || [];
        const heat = new Map();
        for (const l of allLikes) heat.set(l.work_id, (heat.get(l.work_id) || 0) + 1);
        filtered.sort((a, b) => (heat.get(b.id) || 0) - (heat.get(a.id) || 0));
      }
      const page = filtered.slice(offset, offset + limit);
      const works = await batchMeta(page, viewerKey(request));
      return Response.json({ works, total: filtered.length, next_offset: offset + limit < filtered.length ? offset + limit : null });
    }

    const workMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})$/);
    if (workMatch && method === 'GET') {
      let w = await loadWork(workMatch[1]);
      const sid = viewerKey(request);
      const isOwner = Boolean(sid) && w.owner_session === sid;
      if (w.status !== 'published' && !isOwner) fail('not_found', 404);
      if ((!Array.isArray(w.lineage_credits) || !w.lineage_credits.length) && w.parent_work_id) {
        try {
          const parent = await loadWork(w.parent_work_id);
          const built = await buildLineageCredits(parent);
          w = { ...w, lineage_credits: built.credits, lineage_truncated: built.truncated };
        } catch { /* 历史断链时保留空谱系，不阻断详情 */ }
      }
      return Response.json({ work: workMeta(w, { ...(await workCounts(w)), is_owner: isOwner, liked: await likedBy(w.id, sid) }) });
    }
    if (workMatch && method === 'PATCH') {
      const sid = ownerOf(request);
      const w = await loadWork(workMatch[1]);
      if (w.owner_session !== sid) fail('not_found', 404);
      const body = await readJson(request);
      const patch = {};
      if (body.title !== undefined) {
        const title = vStr(body.title, 'title', { max: 100, required: true });
        if (BANNED.test(title)) fail('invalid_input', 422, '标题含违规内容');
        patch.title = title;
      }
      if (body.tags !== undefined) patch.tags = vStringArray(body.tags, 'tags', { max: 12, itemMax: 40 });
      if (body.allow_fork !== undefined) {
        if (typeof body.allow_fork !== 'boolean') fail('invalid_input', 400, 'allow_fork 必须是布尔值');
        patch.allow_fork = body.allow_fork;
      }
      if (!Object.keys(patch).length) fail('invalid_input', 400, '没有可更新的字段');
      const r = await db.from('works').update(patch).eq('id', w.id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '更新失败，请稍后重试');
      const updated = r.data[0];
      return Response.json({ work: workMeta(updated, {
        ...(await workCounts(updated)), is_owner: true, liked: await likedBy(updated.id, viewerKey(request)),
      }) });
    }
    if (workMatch && method === 'DELETE') {
      const sid = ownerOf(request);
      const w = await loadWork(workMatch[1]);
      if (w.owner_session !== sid) fail('not_found', 404);
      const r = await db.from('works').update({ status: 'removed' }).eq('id', w.id).select();
      if (r.error) fail('internal', 503);
      // 作品下架后，其他用户收到的相关通知一并清理，避免点开即 404
      await db.from('notifications').delete().eq('work_id', w.id);
      // 保留 fork 指针与 author_credit/depth，子作品仍能显示来源；上游不可见时由前端提示「已撤回」
      return Response.json({ ok: true });
    }

    const workImg = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/img$/);
    if (workImg && method === 'GET') {
      const w = await loadWork(workImg[1]);
      if (w.status !== 'published') {
        const sid = viewerKey(request);
        if (!sid || w.owner_session !== sid) fail('not_found', 404);
      }
      const f = rows(await db.from('assets').select('*').eq('id', w.result_asset_id).limit(1));
      if (!f?.length || f[0].deleted_at) fail('not_found', 404);
      const file = await storage.download(f[0].storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      return new Response(file.body, { headers: { 'content-type': f[0].content_type, 'cache-control': 'public, max-age=60' } });
    }

    const forkMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/fork$/);
    if (forkMatch && method === 'POST') {
      const w = await loadWork(forkMatch[1]);
      if (w.status !== 'published') fail('invalid_input', 400, '作品不可 fork');
      if (!w.allow_fork) fail('invalid_input', 403, '作者已关闭 fork');
      return Response.json({ skill_snapshot: w.skill_snapshot, parent_work_id: w.id, parent_skill_id: w.parent_skill_id || w.id, depth: (w.depth || 0) + 1, title: w.title });
    }

    const withdrawMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/withdraw$/);
    if (withdrawMatch && method === 'POST') {
      const sid = ownerOf(request);
      const w = await loadWork(withdrawMatch[1]);
      if (w.owner_session !== sid) fail('not_found', 404);
      const r = await db.from('works').update({ status: 'withdrawn' }).eq('id', w.id).select();
      if (r.error) fail('internal', 503);
      return Response.json({ ok: true, status: 'withdrawn' });
    }

    const republishMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/publish$/);
    if (republishMatch && method === 'POST') {
      const sid = ownerOf(request);
      const w = await loadWork(republishMatch[1]);
      if (w.owner_session !== sid) fail('not_found', 404);
      if (w.status === 'published') return Response.json({ ok: true, status: 'published' });
      if (w.status !== 'withdrawn') fail('invalid_input', 400, '仅撤回的作品可重新发布');
      const f = rows(await db.from('assets').select('*').eq('id', w.result_asset_id).limit(1));
      if (f?.length) {
        const bytes = await assetBytes(f[0]);
        const mod = await moderateWork({ title: w.title, tags: jsonArr(w.tags), imageBytes: bytes, imageMime: f[0].content_type });
        if (!mod.ok) fail('invalid_input', 422, mod.reason);
      }
      const r = await db.from('works').update({ status: 'published' }).eq('id', w.id).select();
      if (r.error) fail('internal', 503);
      return Response.json({ ok: true, status: 'published' });
    }

    const userWorks = path.match(/^\/api\/v1\/users\/([^/]+)\/works$/);
    if (userWorks && method === 'GET') {
      const owner = decodeURIComponent(userWorks[1]);
      const list = rows(await db.from('works').select('*').eq('owner_session', owner).eq('status', 'published').order('created_at', { ascending: false }).limit(60)) || [];
      const works = await batchMeta(list, viewerKey(request));
      return Response.json({ works });
    }

    if (path === '/api/v1/me/works' && method === 'GET') {
      const sid = ownerOf(request);
      const list = rows(await db.from('works').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(100)) || [];
      const works = await batchMeta(list, viewerKey(request));
      return Response.json({ works });
    }

    async function rateLimit(owner, table, windowMs, max) {
      const since = new Date(Date.now() - windowMs).toISOString();
      const c = await db.from(table).select('id', { count: 'exact' }).eq('owner_session', owner).gte('created_at', since).limit(1);
      if ((Number(c.count) || 0) >= max) fail('quota_exceeded', 429, '操作太频繁，请稍后再试');
    }

    const cwMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/comments$/);
    if (cwMatch && method === 'GET') {
      const w = await loadWork(cwMatch[1]);
      if (w.status !== 'published') { const sid = viewerKey(request); if (!sid || w.owner_session !== sid) fail('not_found', 404); }
      const url = new URL(request.url);
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 100, fallback: 50 });
      const offset = vInt(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
      const list = rows(await db.from('comments').select('*').eq('work_id', w.id).eq('hidden_by_author', false).order('created_at', { ascending: true }).range(offset, offset + limit)) || [];
      const hasMore = list.length > limit;
      const page = list.slice(0, limit);
      const names = new Map();
      for (const author of new Set(page.map((c) => c.owner_session))) names.set(author, await displayNameOf(author));
      return Response.json({
        comments: page.map((c) => ({
          id: c.id, body: c.body, author_id: c.owner_session,
          author_name: names.get(c.owner_session) || (c.owner_session?.startsWith('u:') ? '社区用户' : '匿名用户'),
          created_at: c.created_at,
        })),
        has_more: hasMore,
        next_offset: offset + limit,
      });
    }
    if (cwMatch && method === 'POST') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const w = await loadWork(cwMatch[1]); if (w.status !== 'published') fail('not_found', 404);
      await rateLimit(sid, 'comments', 3600_000, 20);
      await ensureProfile(user);
      const body = await readJson(request);
      const text = typeof body.body === 'string' ? body.body.trim().slice(0, 500) : '';
      if (!text) fail('invalid_input', 400, '评论不能为空');
      if (BANNED.test(text)) fail('invalid_input', 422, '评论含违规内容');
      const id = newId('cm');
      const r = await db.from('comments').insert({ id, work_id: w.id, owner_session: sid, body: text, hidden_by_author: false }).select();
      if (r.error) fail('internal', 503);
      if (w.owner_session !== sid) await notify(w.owner_session, 'comment', w.id, `${user.name || '有人'} 评论了你的作品`);
      const authorName = (await displayNameOf(sid)) || '我';
      return Response.json({ comment: { id, body: text, author_id: sid, author_name: authorName, created_at: r.data[0].created_at } }, { status: 201 });
    }

    const cmMatch = path.match(/^\/api\/v1\/comments\/(cm_[0-9a-f]{24})$/);
    if (cmMatch && method === 'DELETE') {
      const sid = ownerOf(request);
      const f = rows(await db.from('comments').select('*').eq('id', cmMatch[1]).limit(1));
      if (!f?.length) fail('not_found', 404);
      const c = f[0];
      if (c.owner_session === sid) { await db.from('comments').delete().eq('id', c.id); return Response.json({ ok: true }); }
      const w = await loadWork(c.work_id);
      if (w.owner_session === sid) { await db.from('comments').update({ hidden_by_author: true }).eq('id', c.id).select(); return Response.json({ ok: true, hidden: true }); }
      fail('not_found', 404);
    }

    const likeMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/like$/);
    if (likeMatch && method === 'POST') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const w = await loadWork(likeMatch[1]); if (w.status !== 'published') fail('not_found', 404);
      const ex = rows(await db.from('likes').select('*').eq('work_id', w.id).eq('owner_session', sid).limit(1));
      let liked;
      if (ex?.length) { await db.from('likes').delete().eq('id', ex[0].id); liked = false; }
      else {
        await db.from('likes').insert({ id: newId('lk'), work_id: w.id, owner_session: sid }).select();
        liked = true;
        if (w.owner_session !== sid) await notify(w.owner_session, 'like', w.id, null);
      }
      const c = await db.from('likes').select('id', { count: 'exact' }).eq('work_id', w.id).limit(1);
      return Response.json({ liked, like_count: Number(c.count) || 0 });
    }

    if (path === '/api/v1/tasks' && method === 'GET') {
      const viewer = viewerKey(request);
      const url = new URL(request.url);
      const includeClosed = url.searchParams.get('include_closed') === '1';
      // 默认仅 open；include_closed=1 时追加本人发起的已关闭任务
      const raw = includeClosed
        ? rows(await db.from('tasks').select('*').order('created_at', { ascending: false }).limit(50)) || []
        : rows(await db.from('tasks').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50)) || [];
      const list = includeClosed ? raw.filter((t) => t.status === 'open' || t.owner_session === viewer) : raw;
      // 一次取回本页任务的投稿，避免逐任务 count 的 N+1
      const taskIds = list.map((t) => t.id);
      const allSubs = taskIds.length
        ? rows(await db.from('submissions').select('id, task_id').in('task_id', taskIds).limit(2000)) || []
        : [];
      const submCount = new Map();
      for (const s of allSubs) submCount.set(s.task_id, (submCount.get(s.task_id) || 0) + 1);
      const tasks = list.map((t) => ({
        id: t.id, theme: t.theme, constraints: t.constraints, owner_id: t.owner_session,
        status: t.status, created_at: t.created_at,
        submission_count: submCount.get(t.id) || 0,
        is_owner: Boolean(viewer) && t.owner_session === viewer,
      }));
      return Response.json({ tasks });
    }
    if (path === '/api/v1/tasks' && method === 'POST') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      await rateLimit(sid, 'tasks', 86400_000, 5);
      const body = await readJson(request);
      const theme = typeof body.theme === 'string' ? body.theme.trim().slice(0, 100) : '';
      if (!theme) fail('invalid_input', 400, '请给任务一个主题');
      const id = newId('tk');
      const r = await db.from('tasks').insert({ id, owner_session: sid, theme, constraints: typeof body.constraints === 'string' ? body.constraints.slice(0, 500) : null, status: 'open' }).select();
      if (r.error) fail('internal', 503);
      return Response.json({ task: { id, theme, status: 'open' } }, { status: 201 });
    }
    const taskMatch = path.match(/^\/api\/v1\/tasks\/(tk_[0-9a-f]{24})$/);
    if (taskMatch && method === 'GET') {
      const f = rows(await db.from('tasks').select('*').eq('id', taskMatch[1]).limit(1));
      if (!f?.length) fail('not_found', 404);
      const t = f[0];
      const subs = rows(await db.from('submissions').select('*').eq('task_id', t.id).limit(100)) || [];
      // 一次批量取回投稿作品，避免逐条查询
      const workIds = subs.map((s) => s.work_id).filter(Boolean);
      const workRows = workIds.length
        ? rows(await db.from('works').select('*').in('id', workIds).limit(100)) || []
        : [];
      const published = workRows.filter((w) => w.status === 'published');
      // 一次补齐点赞/评论/fork 计数与本人态，避免每件作品多次查询
      const works = await batchMeta(published, viewerKey(request));
      return Response.json({
        task: {
          id: t.id, theme: t.theme, constraints: t.constraints, status: t.status,
          owner_id: t.owner_session, submission_count: subs.length,
          is_owner: t.owner_session === viewerKey(request),
        },
        works,
      });
    }
    if (taskMatch && method === 'PATCH') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const tf = rows(await db.from('tasks').select('*').eq('id', taskMatch[1]).limit(1));
      if (!tf?.length) fail('not_found', 404);
      if (tf[0].owner_session !== sid) fail('not_found', 404);
      const body = await readJson(request);
      const status = vOneOf(body.status, 'status', ['open', 'closed']);
      const r = await db.from('tasks').update({ status }).eq('id', tf[0].id).eq('owner_session', sid).select();
      if (r.error) fail('internal', 503, '更新任务失败');
      return Response.json({ task: { id: tf[0].id, theme: tf[0].theme, status } });
    }
    const subMatch = path.match(/^\/api\/v1\/tasks\/(tk_[0-9a-f]{24})\/submissions$/);
    if (subMatch && method === 'POST') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const tf = rows(await db.from('tasks').select('*').eq('id', subMatch[1]).limit(1));
      if (!tf?.length || tf[0].status !== 'open') fail('not_found', 404);
      const body = await readJson(request);
      const w = await loadWork(body.work_id);
      if (w.owner_session !== sid || w.status !== 'published') fail('invalid_input', 400, '请提交自己已发布的作品');
      const ex = rows(await db.from('submissions').select('*').eq('task_id', tf[0].id).eq('work_id', w.id).limit(1));
      if (ex?.length) return Response.json({ ok: true, already: true });
      await db.from('submissions').insert({ id: newId('sb'), task_id: tf[0].id, work_id: w.id, owner_session: sid }).select();
      if (tf[0].owner_session !== sid) await notify(tf[0].owner_session, 'submission', w.id, `${user.name || '有人'} 提交了你的任务`);
      return Response.json({ ok: true }, { status: 201 });
    }
    const subDel = path.match(/^\/api\/v1\/tasks\/(tk_[0-9a-f]{24})\/submissions\/(wk_[0-9a-f]{24})$/);
    if (subDel && method === 'DELETE') {
      const user = currentUser(request); if (!user) fail('login_required', 401);
      const sid = 'u:' + user.user_id;
      const tf = rows(await db.from('tasks').select('*').eq('id', subDel[1]).limit(1));
      if (!tf?.length) fail('not_found', 404);
      const sb = rows(await db.from('submissions').select('*').eq('task_id', subDel[1]).eq('work_id', subDel[2]).limit(1));
      if (!sb?.length) fail('not_found', 404);
      // 投稿人可自行撤回；任务发起人可移除不当投稿
      if (sb[0].owner_session !== sid && tf[0].owner_session !== sid) fail('not_found', 404);
      await db.from('submissions').delete().eq('id', sb[0].id);
      return Response.json({ ok: true });
    }

    if (path === '/api/v1/notifications' && method === 'GET') {
      const sid = ownerOf(request);
      const list = rows(await db.from('notifications').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(50)) || [];
      const unreadRes = await db.from('notifications').select('id', { count: 'exact' }).eq('owner_session', sid).eq('read', false).limit(1);
      return Response.json({
        notifications: list.map((n) => ({ id: n.id, kind: n.kind, work_id: n.work_id, body: n.body, read: n.read, created_at: n.created_at })),
        unread: Number(unreadRes.count) || 0,
      });
    }
    if (path === '/api/v1/notifications/read-all' && method === 'POST') {
      const sid = ownerOf(request);
      const r = await db.from('notifications').update({ read: true }).eq('owner_session', sid).eq('read', false).select();
      if (r.error) fail('internal', 503, '操作失败，请稍后重试');
      return Response.json({ ok: true, updated: rows(r)?.length || 0 });
    }
    const ntMatch = path.match(/^\/api\/v1\/notifications\/(nt_[0-9a-f]{24})\/read$/);
    if (ntMatch && method === 'POST') {
      const sid = ownerOf(request);
      const r = await db.from('notifications').update({ read: true }).eq('id', ntMatch[1]).eq('owner_session', sid).select();
      if (!rows(r)?.length) fail('not_found', 404);
      return Response.json({ ok: true });
    }

    const rpMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/report$/);
    if (rpMatch && method === 'POST') {
      // 举报允许游客参与，但必须带会话标识并限流，防止匿名刷举报
      const user = currentUser(request);
      const reporter = user ? 'u:' + user.user_id : requireSession(request);
      await rateLimit(reporter, 'reports', 3600_000, 5);
      const w = await loadWork(rpMatch[1]);
      if (w.status !== 'published') fail('not_found', 404);
      const body = await readJson(request);
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
      if (!reason) fail('invalid_input', 400, '请说明举报原因');
      const dup = rows(await db.from('reports').select('*').eq('work_id', w.id).eq('reporter_session', reporter).limit(1));
      if (dup?.length) return Response.json({ ok: true, already: true });
      await db.from('reports').insert({ id: newId('rp'), work_id: w.id, reporter_session: reporter, reason, status: 'pending' }).select();
      const cnt = await db.from('reports').select('id', { count: 'exact' }).eq('work_id', w.id).limit(1);
      if ((Number(cnt.count) || 0) >= 3 && w.status === 'published') {
        await db.from('works').update({ status: 'removed' }).eq('id', w.id).select();
        await createReviewItem({
          workId: w.id, source: 'report_threshold', reason,
          reportCount: Number(cnt.count) || 3,
        });
        await notify(w.owner_session, 'removed', w.id, '作品因多次举报被下架，可申诉');
      }
      return Response.json({ ok: true });
    }
    const apMatch = path.match(/^\/api\/v1\/works\/(wk_[0-9a-f]{24})\/appeal$/);
    if (apMatch && method === 'POST') {
      const sid = ownerOf(request);
      const w = await loadWork(apMatch[1]);
      if (w.owner_session !== sid) fail('not_found', 404);
      if (w.status !== 'removed') fail('invalid_input', 400, '仅被下架作品可申诉');
      const f = rows(await db.from('assets').select('*').eq('id', w.result_asset_id).limit(1));
      let ok = true;
      if (f?.length) {
        const bytes = await assetBytes(f[0]);
        const mod = await moderateWork({ title: w.title, tags: jsonArr(w.tags), imageBytes: bytes, imageMime: f[0].content_type });
        ok = mod.ok;
      }
      if (!ok) fail('invalid_input', 422, '申诉未通过审核');
      const existingAppeal = rows(
        await db.from('review_items').select('*').eq('work_id', w.id).eq('source', 'appeal').limit(1),
      )?.[0];
      if (existingAppeal && existingAppeal.status !== 'decided') {
        return Response.json({ ok: true, status: w.status, review_status: existingAppeal.status });
      }
      await db.from('works').update({ status: 'published' }).eq('id', w.id).select();
      await db.from('reports').update({ status: 'resolved' }).eq('work_id', w.id).select();
      const appeal = await createReviewItem({
        workId: w.id, source: 'appeal', reason: '作者申诉，等待人工复核',
      });
      await db.from('review_items').update({ status: 'in_review' }).eq('id', appeal.id);
      return Response.json({ ok: true, status: 'published', review_status: 'in_review' });
    }

    if (path === '/api/v1/me/export' && method === 'GET') {
      const sid = ownerOf(request);
      const works = rows(await db.from('works').select('*').eq('owner_session', sid).limit(500)) || [];
      const skills = rows(await db.from('skills').select('*').eq('owner_session', sid).limit(500)) || [];
      const albums = rows(await db.from('albums').select('*').eq('owner_session', sid).limit(200)) || [];
      const assets = rows(await db.from('assets').select('*').eq('owner_session', sid).limit(2000)) || [];
      const comments = rows(await db.from('comments').select('*').eq('owner_session', sid).limit(1000)) || [];
      const likes = rows(await db.from('likes').select('*').eq('owner_session', sid).limit(2000)) || [];
      const tasks = rows(await db.from('tasks').select('*').eq('owner_session', sid).limit(200)) || [];
      const submissions = rows(await db.from('submissions').select('*').eq('owner_session', sid).limit(1000)) || [];
      const notifications = rows(await db.from('notifications').select('*').eq('owner_session', sid).limit(1000)) || [];
      const profile = rows(await db.from('profiles').select('*').eq('user_id', sid).limit(1))?.[0] || null;
      return Response.json({
        exported_at: new Date().toISOString(),
        profile,
        assets: assets.map(assetMeta),
        works: works.map(workMeta),
        skills,
        albums: albums.map(albumMeta),
        comments,
        likes,
        tasks,
        submissions,
        notifications,
      });
    }
    if (path === '/api/v1/me' && method === 'DELETE') {
      const sid = ownerOf(request);
      const works = rows(await db.from('works').select('*').eq('owner_session', sid).limit(1000)) || [];
      for (const w of works) {
        await db.from('comments').delete().eq('work_id', w.id);
        await db.from('likes').delete().eq('work_id', w.id);
        await db.from('reports').delete().eq('work_id', w.id);
        await db.from('submissions').delete().eq('work_id', w.id);
        // 他人收到的相关通知属于跨实体残留，随作品一并清理
        await db.from('notifications').delete().eq('work_id', w.id);
      }
      await db.from('works').delete().eq('owner_session', sid);
      await db.from('comments').delete().eq('owner_session', sid);
      await db.from('likes').delete().eq('owner_session', sid);
      await db.from('notifications').delete().eq('owner_session', sid);
      await db.from('reports').delete().eq('reporter_session', sid);
      await db.from('submissions').delete().eq('owner_session', sid);
      await db.from('tasks').delete().eq('owner_session', sid);
      await db.from('albums').delete().eq('owner_session', sid);
      await db.from('skills').delete().eq('owner_session', sid);
      await db.from('jobs').delete().eq('owner_session', sid);
      const assets = rows(await db.from('assets').select('*').eq('owner_session', sid).limit(2000)) || [];
      let storageFailed = 0;
      for (const a of assets) { try { await storage.remove([a.storage_key]); } catch { storageFailed += 1; } }
      await db.from('assets').delete().eq('owner_session', sid);
      await db.from('profiles').delete().eq('user_id', sid);
      // 存储对象删除失败时如实返回 partial，便于后续清理，不再静默吞掉
      return Response.json({ ok: true, deleted: true, storage_failed: storageFailed, partial: storageFailed > 0 });
    }

    if (path === '/api/v1/maintenance/cleanup' && method === 'POST') {
      requireMaintenance(request);
      const runKey = `cleanup:${new Date().toISOString().slice(0, 10)}`;
      const priorRun = rows(await db.from('job_runs').select('*').eq('idempotency_key', runKey).limit(1))?.[0];
      if (priorRun?.finished_at) {
        return Response.json({ ok: true, already_ran: true, result: priorRun.result });
      }
      await db.from('job_runs').insert({
        idempotency_key: runKey, kind: 'cleanup',
        started_at: new Date().toISOString(), finished_at: null, result: null,
      });
      const now = Date.now();
      const assetCutoff = new Date(now - 7 * 86400_000).toISOString();
      const jobCutoff = new Date(now - 30 * 86400_000).toISOString();
      let assetsPurged = 0, sharesExpired = 0, jobsPurged = 0;
      const assets = rows(await db.from('assets').select('*').limit(1000)) || [];
      for (const a of assets) {
        if (!a.deleted_at || a.deleted_at > assetCutoff) continue;
        try { await storage.remove([a.storage_key]); } catch { /* 下一轮再试 */ }
        await db.from('assets').delete().eq('id', a.id);
        assetsPurged += 1;
      }
      const albums = rows(await db.from('albums').select('*').limit(1000)) || [];
      for (const al of albums) {
        if (!al.share_token || !al.share_expires_at || al.share_expires_at > new Date(now).toISOString()) continue;
        await db.from('albums').update({ visibility: 'private', share_token: null, share_expires_at: null }).eq('id', al.id);
        sharesExpired += 1;
      }
      const jobs = rows(await db.from('jobs').select('*').limit(2000)) || [];
      for (const j of jobs) {
        if (!j.created_at || j.created_at > jobCutoff) continue;
        await db.from('jobs').delete().eq('id', j.id);
        jobsPurged += 1;
      }
      const tempRefsPurged = await ephemeral.cleanupExpired();
      const summary = {
        assets_purged: assetsPurged, shares_expired: sharesExpired,
        jobs_purged: jobsPurged, temp_refs_purged: tempRefsPurged,
      };
      await db.from('job_runs').update({
        finished_at: new Date().toISOString(), result: summary,
      }).eq('idempotency_key', runKey);
      return Response.json({ ok: true, ...summary });
    }

    // 审核降级人工复核：列出待复核作品，并支持通过/下架
    if (path === '/api/v1/maintenance/review' && method === 'GET') {
      requireMaintenance(request);
      const all = rows(await db.from('works').select('*').eq('status', 'published').limit(500)) || [];
      const items = all.filter((w) => w.moderation_degraded);
      for (const w of items) {
        await createReviewItem({
          workId: w.id, source: 'moderation_degraded',
          reason: '补偿扫描：审核降级待人工复核',
        });
      }
      return Response.json({ works: items.map((w) => workMeta(w)) });
    }

    if (path === '/api/v1/maintenance/reviews' && method === 'GET') {
      requireMaintenance(request);
      const url = new URL(request.url);
      const status = url.searchParams.get('status') || 'queued';
      const items = rows(
        await db.from('review_items').select('*').eq('status', status)
          .order('created_at', { ascending: true }).limit(200),
      ) || [];
      return Response.json({
        reviews: items.map((item) => ({
          id: item.id, work_id: item.work_id, source: item.source,
          status: item.status, reason: item.reason,
          report_count: item.report_count, reviewer_id: item.reviewer_id,
          created_at: item.created_at, decided_at: item.decided_at,
        })),
      });
    }

    const reviewClaim = path.match(/^\/api\/v1\/maintenance\/reviews\/(rv_[0-9a-f]{24})\/claim$/);
    if (reviewClaim && method === 'POST') {
      const reviewer = requireReviewer(request);
      const found = rows(await db.from('review_items').select('*').eq('id', reviewClaim[1]).limit(1))?.[0];
      if (!found) fail('not_found', 404);
      if (found.status !== 'queued') fail('invalid_input', 409, '工单已被领取或已处置');
      await db.from('review_items')
        .update({ status: 'in_review', reviewer_id: reviewer })
        .eq('id', found.id).eq('status', 'queued');
      await db.from('review_events').insert({
        review_id: found.id, action: 'claim', actor_id: reviewer,
        from_status: 'queued', to_status: 'in_review', reason: null,
      });
      return Response.json({
        ok: true,
        review: { ...found, status: 'in_review', reviewer_id: reviewer },
      });
    }

    const reviewDecide = path.match(/^\/api\/v1\/maintenance\/reviews\/(rv_[0-9a-f]{24})\/decide$/);
    if (reviewDecide && method === 'POST') {
      const reviewer = requireReviewer(request);
      const body = await readJson(request);
      const action = vOneOf(body.action, 'action', ['approve', 'remove', 'hold']);
      const found = rows(await db.from('review_items').select('*').eq('id', reviewDecide[1]).limit(1))?.[0];
      if (!found) fail('not_found', 404);
      if (found.status === 'decided') fail('invalid_input', 409, '工单已处置');
      if (action === 'remove') {
        await db.from('works').update({ status: 'removed' }).eq('id', found.work_id);
      } else if (action === 'approve') {
        await db.from('works')
          .update({ status: 'published', moderation_degraded: false })
          .eq('id', found.work_id);
      }
      const toStatus = action === 'hold' ? 'in_review' : 'decided';
      await db.from('review_items').update({
        status: toStatus, reviewer_id: reviewer,
        decided_at: action === 'hold' ? null : new Date().toISOString(),
      }).eq('id', found.id);
      await db.from('review_events').insert({
        review_id: found.id, action, actor_id: reviewer,
        from_status: found.status, to_status: toStatus, reason: body.reason || null,
      });
      return Response.json({
        ok: true,
        review: { ...found, status: toStatus, reviewer_id: reviewer },
      });
    }
    const reviewMatch = path.match(/^\/api\/v1\/maintenance\/works\/(wk_[0-9a-f]{24})\/review$/);
    if (reviewMatch && method === 'POST') {
      requireMaintenance(request);
      const w = await loadWork(reviewMatch[1]);
      const body = await readJson(request);
      const action = vOneOf(body.action, 'action', ['approve', 'remove']);
      if (action === 'approve') {
        await db.from('works').update({ moderation_degraded: false }).eq('id', w.id).select();
        return Response.json({ ok: true, status: w.status });
      }
      const r = await db.from('works').update({ status: 'removed', moderation_degraded: false }).eq('id', w.id).select();
      if (r.error) fail('internal', 503);
      await notify(w.owner_session, 'removed', w.id, '作品未通过人工复核，已下架；可在「我的作品」发起申诉');
      return Response.json({ ok: true, status: 'removed' });
    }

    // ---- 技能演示种子：维护令牌批量写入（幂等，可分批重复调用） ----
    if (path === '/api/v1/maintenance/seed-showcase' && method === 'POST') {
      requireMaintenance(request);
      const body = await readJson(request, 48 * 1024 * 1024);
      const out = { skills: 0, templates: 0, assets: 0, pairs: 0, albums: 0, skipped_pairs: 0 };

      // 1) 技能元数据（更新时保留已存在的 pairs / album_id）+ 同步模板表（创作台可直接套用）
      for (const s of Array.isArray(body.skills) ? body.skills : []) {
        const id = vStr(s.id, 'skills.id', { max: 64 });
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id)) fail('invalid_input', 400, `skills.id 不合法: ${id}`);
        const row = {
          title_zh: vStr(s.title_zh, 'skills.title_zh', { max: 40 }),
          category: vStr(s.category, 'skills.category', { max: 20 }),
          desc_zh: vStr(s.desc_zh, 'skills.desc_zh', { max: 120 }),
          tags: Array.isArray(s.tags) ? s.tags.map((t) => String(t).slice(0, 20)).slice(0, 8) : [],
          prompt: vStr(s.prompt, 'skills.prompt', { max: 4000 }),
          negative_prompt: typeof s.negative_prompt === 'string' ? s.negative_prompt.slice(0, 1000) : null,
          model: MODEL_WHITELIST.includes(s.model) ? s.model : 'agnes-image-2.5-flash',
          ratio: RATIOS.includes(s.ratio) ? s.ratio : '3:4',
          sort: vInt(s.sort, 'skills.sort', { min: 0, max: 100000, fallback: 0 }),
        };
        const existing = rows(await db.from('showcase_skills').select('*').eq('id', id).limit(1))?.[0];
        if (existing) {
          await db.from('showcase_skills').update(row).eq('id', id);
        } else {
          rows(await db.from('showcase_skills').insert({ id, ...row, pairs: [], album_id: null }).select());
        }
        out.skills += 1;
        await db.from('templates').insertIfAbsent({
          id, title: row.title_zh, description: row.desc_zh, cover_asset_id: null,
          prompt: row.prompt, negative_prompt: row.negative_prompt, default_model: row.model,
          ratio: row.ratio, tags: row.tags, features: '', sort: 1000 + row.sort,
        }, { onConflict: 'id' });
        out.templates += 1;
      }

      // 2) 原图→作品对（base64 上传；资产 id 由 skill+slot 决定，重复调用幂等跳过）
      for (const p of Array.isArray(body.pairs) ? body.pairs : []) {
        const skillId = vStr(p.skill_id, 'pairs.skill_id', { max: 64 });
        const slot = vInt(p.slot, 'pairs.slot', { min: 0, max: 999, required: true });
        const skill = rows(await db.from('showcase_skills').select('*').eq('id', skillId).limit(1))?.[0];
        if (!skill) fail('invalid_input', 400, `未知技能 ${skillId}`);
        const current = showcasePairs(skill);
        if (current.length > slot) {
          out.skipped_pairs += 1;
          // 已写入过的配对：顺带回填模板封面（为空时），让重复调用也能修复历史数据
          if (slot === 0) {
            await db.from('templates').update({ cover_asset_id: current[0].result_id }).eq('id', skillId).is('cover_asset_id', null);
          }
          continue;
        }
        if (current.length !== slot) fail('invalid_input', 400, `pairs.slot 必须顺续：当前 ${current.length}，收到 ${slot}`);
        for (const item of [p.original, p.result]) {
          if (!item || typeof item.b64 !== 'string' || !item.b64) fail('invalid_input', 400, 'pairs 缺少 original/result b64');
        }
        const pair = {};
        for (const [key, item] of [['original', p.original], ['result', p.result]]) {
          const bytes = b64ToBytes(item.b64);
          if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES) fail('invalid_input', 413, '图片过大或为空');
          const sniffed = sniffImageType(bytes);
          if (!sniffed || !ALLOWED_IMAGE_TYPES.includes(sniffed)) fail('invalid_input', 415, '仅支持 JPG / PNG / WebP 图片');
          const { width, height } = imageSize(bytes, sniffed);
          if (!width || !height) fail('invalid_input', 415, '无法解析图片尺寸');
          const id = 'a_' + seedHash(`showcase|${skillId}|${key}|${slot}`).slice(0, 24);
          const storageKey = `${key === 'result' ? 'results' : 'assets'}/${id}`;
          await storage.upload(storageKey, bytes, { contentType: sniffed, upsert: true });
          const already = rows(await db.from('assets').select('id').eq('id', id).limit(1))?.length;
          if (!already) {
            rows(await db.from('assets').insert({
              id, owner_session: SHOWCASE_OWNER, kind: key === 'result' ? 'result' : 'original',
              storage_key: storageKey, visibility: 'private', content_type: sniffed,
              bytes: bytes.length, width, height,
              tags: ['技能演示', skillId.slice(0, 30)], source: 'showcase-seed',
            }));
            out.assets += 1;
          }
          pair[`${key}_id`] = id;
        }
        await db.from('showcase_skills').update({ pairs: [...current, pair] }).eq('id', skillId);
        // 模板封面回填：仅在为空时写入第一张作品图（可重复调用，幂等）
        await db.from('templates').update({ cover_asset_id: pair.result_id }).eq('id', skillId).is('cover_asset_id', null);
        out.pairs += 1;
      }

      // 3) 画册定稿：每技能一本（item_ids=作品序，稳定 share_token，长期 unlisted 只读）
      for (const skillId of Array.isArray(body.albums) ? body.albums : []) {
        const sid = vStr(skillId, 'albums[]', { max: 64 });
        const skill = rows(await db.from('showcase_skills').select('*').eq('id', sid).limit(1))?.[0];
        if (!skill) fail('invalid_input', 400, `未知技能 ${sid}`);
        const resultIds = showcasePairs(skill).map((x) => x.result_id);
        if (!resultIds.length) continue;
        const aid = 'al_' + seedHash(`showcase-album|${sid}`).slice(0, 24);
        const token = seedHash(`showcase-share|${sid}`).slice(0, 32);
        const albumRow = {
          id: aid, owner_session: SHOWCASE_OWNER, title: `${skill.title_zh} · 技能示例`,
          cover_asset_id: resultIds[0], item_ids: resultIds, template_id: '3d-book',
          visibility: 'unlisted', render_status: 'ready', share_token: token, share_expires_at: null,
        };
        const exists = rows(await db.from('albums').select('id').eq('id', aid).limit(1))?.length;
        if (exists) await db.from('albums').update(albumRow).eq('id', aid);
        else rows(await db.from('albums').insert(albumRow).select());
        await db.from('showcase_skills').update({ album_id: aid }).eq('id', sid);
        out.albums += 1;
      }
      return Response.json({ ok: true, ...out });
    }


    // ===== 灵感库与社区拆分（docs/19）=====

    // 灵感库首页聚合：官方技能 / 图片参考 / 公开配方的数量与入口。
    if (path === '/api/v1/inspiration/overview' && method === 'GET') {
      const showcase = rows(await db.from('showcase_skills').select('*').limit(500)) || [];
      const skills = rows(await db.from('skills').select('*').limit(1000)) || [];
      const refs = rows(await db.from('assets').select('*').eq('kind', 'reference').limit(1000)) || [];
      const publicSkills = skills.filter((s) => (s.visibility || 'private') === 'public');
      const categories = {};
      for (const s of showcase) {
        const c = s.category || '未分类';
        categories[c] = (categories[c] || 0) + 1;
      }
      return Response.json({
        counts: {
          skills: showcase.length,
          references: refs.filter((a) => !a.deleted_at).length,
          recipes: publicSkills.length,
        },
        categories,
      });
    }

    // 图片参考列表：来自公开授权语料/模板封面（assets.kind=reference），按标签/关键词筛选。
    if (path === '/api/v1/inspiration/references' && method === 'GET') {
      const url = new URL(request.url);
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const tag = url.searchParams.get('tag') || '';
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 48, fallback: 24 });
      const offset = vInt(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
      let all = (rows(await db.from('assets').select('*').eq('kind', 'reference').limit(2000)) || [])
        .filter((a) => !a.deleted_at);
      if (tag) all = all.filter((a) => jsonArr(a.tags).includes(tag));
      if (q) all = all.filter((a) => jsonArr(a.tags).some((t) => String(t).toLowerCase().includes(q)));
      const page = all.slice(offset, offset + limit);
      const items = page.map((a) => ({
        id: a.id,
        url: `/api/v1/assets/${a.id}/content`,
        tags: jsonArr(a.tags),
        width: a.width || null,
        height: a.height || null,
      }));
      return Response.json({ items, total: all.length, next_offset: offset + limit < all.length ? offset + limit : null });
    }

    // 图片参考详情：大图 + 标签 + 同类推荐（同标签的其他参考）。
    const refMatch = path.match(/^\/api\/v1\/inspiration\/references\/(a_[0-9a-f]{24})$/);
    if (refMatch && method === 'GET') {
      const found = rows(await db.from('assets').select('*').eq('id', refMatch[1]).limit(1))?.[0];
      if (!found || found.deleted_at || found.kind !== 'reference') fail('not_found', 404);
      const tags = jsonArr(found.tags);
      const all = rows(await db.from('assets').select('*').eq('kind', 'reference').limit(2000)) || [];
      const related = all
        .filter((a) => a.id !== found.id && !a.deleted_at && jsonArr(a.tags).some((t) => tags.includes(t)))
        .slice(0, 12)
        .map((a) => ({ id: a.id, url: `/api/v1/assets/${a.id}/content`, tags: jsonArr(a.tags) }));
      return Response.json({
        reference: {
          id: found.id, url: `/api/v1/assets/${found.id}/content`, tags,
          width: found.width || null, height: found.height || null,
          content_type: found.content_type || null,
        },
        related,
      });
    }

    // 灵感库公开配方列表：复用 skills 表，按 visibility 过滤（用户确认用现有字段）。
    if (path === '/api/v1/inspiration/recipes' && method === 'GET') {
      const url = new URL(request.url);
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const all = rows(await db.from('skills').select('*').limit(1000)) || [];
      let list = all.filter((s) => (s.visibility || 'private') === 'public');
      if (q) list = list.filter((s) => (s.title || '').toLowerCase().includes(q)
        || jsonArr(s.style_tags).some((t) => String(t).toLowerCase().includes(q)));
      const items = list.map((s) => ({
        skill_id: s.skill_id,
        title: s.title,
        prompt: s.prompt,
        model: s.model,
        ratio: s.params?.aspect || '3:4',
        cover_url: s.cover_url || null,
        style_tags: jsonArr(s.style_tags),
        created_at: s.created_at || null,
      }));
      return Response.json({ items, total: items.length });
    }

    // 灵感库技能列表：官方 showcase 技能 + 类目筛选（复用现有数据源）。
    if (path === '/api/v1/inspiration/skills' && method === 'GET') {
      const url = new URL(request.url);
      const category = url.searchParams.get('category') || '';
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const list = rows(await db.from('showcase_skills').select('*').limit(500)) || [];
      const live = await liveShowcasePairs(list);
      let skills = list
        .filter((s) => (live.get(s.id) || []).length > 0)
        .sort((a, b) => (a.sort || 0) - (b.sort || 0));
      if (category) skills = skills.filter((s) => s.category === category);
      if (q) skills = skills.filter((s) => (s.title_zh || '').toLowerCase().includes(q)
        || (s.desc_zh || '').toLowerCase().includes(q)
        || jsonArr(s.tags).some((t) => String(t).toLowerCase().includes(q)));
      return Response.json({ skills: skills.map((s) => showcaseMeta(s, live.get(s.id))) });
    }

    // 热榜：只读定时快照（不重算）。period 固定 '7d'。
    if (path === '/api/v1/hot' && method === 'GET') {
      const url = new URL(request.url);
      const period = vOneOf(url.searchParams.get('period') || '7d', 'period', ['24h', '7d']);
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 50, fallback: 20 });
      const snap = (rows(await db.from('hot_rank').select('*').eq('period', period).limit(100)) || [])
        .sort((a, b) => a.rank - b.rank).slice(0, limit);
      const computedAt = snap[0]?.computed_at || null;
      const works = [];
      for (const row of snap) {
        const w = await loadWork(row.work_id);
        if (w && w.status === 'published') {
          works.push({ ...workMeta(w, await workCounts(w)), rank: row.rank, hot_score: row.hot_score });
        }
      }
      return Response.json({ period, computed_at: computedAt, works });
    }

    // 定时重算热榜：维护端点，一次性写入快照。热度 = 3赞 + 2评 + 转发 − 时间衰减(72h 半衰)。
    if (path === '/api/v1/maintenance/recompute-hot' && method === 'POST') {
      requireMaintenance(request);
      const all = rows(await db.from('works').select('*').eq('status', 'published').limit(2000)) || [];
      const likes = rows(await db.from('likes').select('*').limit(20000)) || [];
      const comments = rows(await db.from('comments').select('*').limit(20000)) || [];
      const likeCount = new Map(), commentCount = new Map();
      for (const l of likes) likeCount.set(l.work_id, (likeCount.get(l.work_id) || 0) + 1);
      for (const c of comments) if (!c.hidden_by_author) commentCount.set(c.work_id, (commentCount.get(c.work_id) || 0) + 1);
      const nowMs = Date.now();
      const scored = all.map((w) => {
        const ageH = w.created_at ? Math.max(0, (nowMs - new Date(w.created_at).getTime()) / 3600000) : 0;
        const decay = Math.exp(-ageH / 72);
        const raw = 3 * (likeCount.get(w.id) || 0) + 2 * (commentCount.get(w.id) || 0) + (w.repost_of ? 1 : 0);
        return { id: w.id, score: Math.round(raw * decay * 1000) / 1000 };
      }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 200);
      const periods = ['24h', '7d'];
      for (const period of periods) {
        // 先清旧快照（fakeDb 与生产均支持的 delete().eq）
        await db.from('hot_rank').delete().eq('period', period);
        const limitN = period === '24h' ? 20 : 50;
        const picked = scored.filter((x) => {
          const w = all.find((ww) => ww.id === x.id);
          if (!w?.created_at) return false;
          const hours = (nowMs - new Date(w.created_at).getTime()) / 3600000;
          return period === '24h' ? hours <= 24 : hours <= 168;
        }).slice(0, limitN);
        for (let i = 0; i < picked.length; i++) {
          rows(await db.from('hot_rank').insert({
            period, work_id: picked[i].id, rank: i + 1, hot_score: picked[i].score,
            computed_at: new Date().toISOString(),
          }).select());
        }
      }
      return Response.json({ ok: true, computed: scored.length, periods });
    }

    // 社区统一搜索：帖子（关键词/标签）与用户（昵称/ID）分栏。
    if (path === '/api/v1/search' && method === 'GET') {
      const url = new URL(request.url);
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const type = vOneOf(url.searchParams.get('type') || 'post', 'type', ['post', 'user']);
      if (!q) return Response.json({ items: [], total: 0, type });
      if (type === 'user') {
        const profiles = rows(await db.from('profiles').select('*').limit(1000)) || [];
        const items = profiles.filter((p) => (p.display_name || p.nickname || p.name || '').toLowerCase().includes(q)
          || (p.user_id || p.id || '').toLowerCase().includes(q))
          .slice(0, 30)
          .map((p) => ({ id: p.user_id || p.id, name: p.display_name || p.nickname || p.name || '', avatar: p.avatar_asset_id || null }));
        return Response.json({ items, total: items.length, type });
      }
      const all = rows(await db.from('works').select('*').eq('status', 'published').order('created_at', { ascending: false }).limit(500)) || [];
      const items = all.filter((w) => (w.title || '').toLowerCase().includes(q)
        || (w.body || '').toLowerCase().includes(q)
        || jsonArr(w.tags).some((t) => String(t).toLowerCase().includes(q)))
        .slice(0, 30);
      const works = await batchMeta(items, viewerKey(request));
      return Response.json({ items: works, total: works.length, type });
    }

    fail('not_found', 404);
  }

  return async (ctx) => {
    try {
      return await handle(ctx.request);
    } catch (error) {
      return errResponse(error);
    }
  };
}