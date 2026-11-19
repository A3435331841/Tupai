import {
  AppError, fail, errResponse, rows, readJson, requireSession, newId,
  imageSize, sniffImageType, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, MODEL_WHITELIST, RATIOS,
  DAILY_QUOTA_PER_SESSION, DAILY_QUOTA_GLOBAL, MESSAGES,
} from './util.mjs';
import { createKeyScheduler } from './scheduler.mjs';
import { createAgnesProvider } from './agnes.mjs';
import { mockOptimize, mockGenerate } from './mock.mjs';
import { TEMPLATES, ensureSeeded } from './seed.mjs';
import { renderSkillMarkdown } from './skillmd.mjs';
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

function safeCoverUrl(value) {
  return typeof value === 'string' && /^\/api\/v1\/assets\/a_[0-9a-f]{24}\/content$/.test(value) ? value : undefined;
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
    share_token: a.share_token || null, share_expires_at: a.share_expires_at || null, created_at: a.created_at,
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
    ai_generated: true,
    moderation_degraded: Boolean(w.moderation_degraded),
    liked: false,
    image_url: `/api/v1/works/${w.id}/img`, created_at: w.created_at, ...extras,
  };
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 自包含只读画册页（翻页概念借鉴 create-photo-flipbook-ui, MIT；图派自实现轻量版）
// 图片使用相对路径 img/{id}：分享页本身挂在 /functions/v1/app/api/v1/share/{token}/page 下，
// 写死 /api/v1/... 会被平台保留路径拦截导致 404（见 docs/14 F-10）。
function albumPageHtml(title, ids) {
  const pages = ids.map((id, i) => `<figure class="page" style="--i:${i}"><img src="img/${escHtml(id)}" alt="作品 ${i + 1}" loading="lazy"><span class="ai-badge">AI 生成</span><button class="dl" onclick="dl(${i})">保存这张</button><figcaption>${i + 1} / ${ids.length}</figcaption></figure>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escHtml(title)} · 图派画册</title>
<style>
:root{color-scheme:light dark}body{margin:0;font-family:system-ui,sans-serif;background:#f6f3ee;color:#2a2622;display:flex;flex-direction:column;min-height:100vh;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
header{padding:20px;text-align:center}h1{font-size:1.3rem;margin:0}small{color:#8a8178}
.book{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;perspective:1600px}
.stack{position:relative;width:min(86vw,420px);aspect-ratio:3/4;transform-style:preserve-3d}
.page{position:absolute;inset:0;margin:0;background:#fff;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.18);overflow:hidden;transform-origin:left center;transition:transform .6s ease;backface-visibility:hidden;display:flex;flex-direction:column}
.page img{width:100%;height:100%;object-fit:cover;flex:1}.page figcaption{padding:8px;text-align:center;font-size:.8rem;color:#8a8178}
.ai-badge{position:absolute;left:8px;top:8px;z-index:2;border-radius:999px;background:rgba(0,0,0,.5);color:#fff;font-size:11px;line-height:1;padding:5px 8px;letter-spacing:.02em}
.dl{position:absolute;right:8px;bottom:34px;z-index:2;border:0;cursor:pointer;border-radius:999px;background:rgba(255,255,255,.92);color:#2a2622;font-size:11px;line-height:1;padding:6px 10px;text-decoration:none}
.page.flipped{transform:rotateY(-180deg)}
nav{display:flex;gap:12px;justify-content:center;padding:18px}button{font:inherit;padding:10px 22px;border-radius:999px;border:1px solid #d8d0c4;background:#fff;cursor:pointer}
footer{text-align:center;padding:14px;font-size:.75rem;color:#a89f93}
</style></head><body>
<header><h1>${escHtml(title)}</h1><small>图派 TuPai · AI 生成作品集 · 原图不公开</small></header>
<div class="book"><div class="stack" id="stack">${pages}</div></div>
<nav><button id="prev">上一页</button><button id="next">下一页</button></nav>
<footer>结果图均为 AI 生成 · 由图派画册分享（只读链接）</footer>
<script>
const pages=[...document.querySelectorAll('.page')];let cur=0;
function render(){pages.forEach((p,i)=>{p.style.zIndex=pages.length-i;p.classList.toggle('flipped',i<cur);});}
document.getElementById('next').onclick=()=>{if(cur<pages.length){cur++;render();}};
document.getElementById('prev').onclick=()=>{if(cur>0){cur--;render();}};
render();
// 下载时在画布上合成「AI 生成 · 图派」标识，确保保存到本地的文件也带标识
async function dl(i){
  const target=pages[i];if(!target)return;
  const src=target.querySelector('img').src;
  const img=new Image();img.crossOrigin='anonymous';img.src=src;
  try{await img.decode();}catch{window.open(src,'_blank');return;}
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;
  const ctx=c.getContext('2d');ctx.drawImage(img,0,0);
  const fs=Math.max(14,Math.round(c.width*0.026)),pad=Math.max(12,Math.round(c.width*0.022));
  const label='AI 生成 · 图派';
  ctx.font='600 '+fs+'px system-ui,sans-serif';
  const tw=ctx.measureText(label).width;
  ctx.fillStyle='rgba(0,0,0,.55)';
  ctx.fillRect(c.width-pad*2-tw, c.height-pad*2-fs, tw+pad*2, fs+pad);
  ctx.fillStyle='#fff';ctx.textBaseline='middle';
  ctx.fillText(label, c.width-pad-tw, c.height-pad-fs/2);
  const a=document.createElement('a');a.download='tupai-'+(i+1)+'.jpg';a.href=c.toDataURL('image/jpeg',0.92);a.click();
}
</script></body></html>`;
}

export function application({ db, storage, env, fetchImpl }) {
  const scheduler = createKeyScheduler(db, env);
  const agnes = createAgnesProvider(scheduler, fetchImpl);

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

  async function loadWork(id) {
    const found = rows(await db.from('works').select('*').eq('id', id).limit(1));
    if (!found?.length) fail('not_found', 404);
    return found[0];
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
      return Response.json({
        templates: list.map((t) => {
          const meta = TEMPLATES.find((x) => x.id === t.id) || {};
          return {
            id: t.id, title: t.title, description: t.description,
            cover_url: t.cover_asset_id ? publicAssetUrl(t.cover_asset_id) : `/api/v1/templates/${t.id}/cover`,
            prompt: t.prompt, negative_prompt: t.negative_prompt,
            sample_prompt: meta.sample_prompt || null,
            variants: meta.variants || [],
            default_model: t.default_model, ratio: t.ratio, tags: t.tags || [],
          };
        }),
      });
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
      const meta = TEMPLATES.find((x) => x.id === t.id);
      let out = null;
      try {
        out = await agnes.generate({ prompt: meta?.sample_prompt || t.prompt, model: t.default_model, ratio: t.ratio });
      } catch { out = null; }
      if (out && !out.busy) {
        const coverId = newId('a');
        await storeAsset({ id: coverId, sid: 'system', kind: 'reference', visibility: 'public', bytes: out.bytes, mime: out.mime });
        await db.from('templates').update({ cover_asset_id: coverId }).eq('id', t.id).is('cover_asset_id', null);
        return new Response(out.bytes, { headers: { 'content-type': out.mime, 'cache-control': 'public, max-age=86400' } });
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#efe6d8"/><stop offset="1" stop-color="#c9a689"/></linearGradient></defs><rect width="600" height="800" fill="url(#g)"/><text x="300" y="380" font-family="sans-serif" font-size="34" fill="#5c4a35" text-anchor="middle">${t.title}</text><text x="300" y="430" font-family="sans-serif" font-size="18" fill="#7a654c" text-anchor="middle">样片生成中 · 稍后刷新</text></svg>`;
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
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
      const includeDeleted = url.searchParams.get('include_deleted') === '1';
      const limit = vInt(url.searchParams.get('limit'), 'limit', { min: 1, max: 60, fallback: 24 });
      const offset = vInt(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
      let query = db.from('assets').select('*').eq('owner_session', sid).order('created_at', { ascending: false });
      if (!includeDeleted) query = query.is('deleted_at', null);
      if (kind) query = query.eq('kind', kind);
      const all = rows(await query.range(0, 499)) || [];
      let filtered = all;
      if (tag) filtered = filtered.filter((a) => assetTags(a).includes(tag));
      if (q) filtered = filtered.filter((a) => (a.source || '').toLowerCase().includes(q)
        || assetTags(a).some((t) => String(t).toLowerCase().includes(q)) || a.kind.includes(q));
      const page = filtered.slice(offset, offset + limit);
      const summary = {};
      if (!includeDeleted) {
        for (const k of KIND_VALUES) {
          const c = await db.from('assets').select('id', { count: 'exact' }).eq('owner_session', sid).eq('kind', k).is('deleted_at', null).limit(1);
          summary[k] = Number(c.count) || 0;
        }
      }
      return Response.json({
        assets: page.map(assetMeta), total: filtered.length,
        summary,
        next_offset: offset + limit < filtered.length ? offset + limit : null,
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
        const deleted_at = new Date().toISOString();
        const r = await db.from('assets').update({ deleted_at }).eq('id', a.id).eq('owner_session', sid).select();
        if (r.error) fail('internal', 503, '删除失败，请稍后重试');
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
      if (asset.visibility === 'private') {
        const sid = ownerOf(request);
        if (asset.owner_session !== sid) fail('not_found', 404);
      }
      const file = await storage.download(asset.storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      return new Response(file.body, {
        headers: {
          'content-type': asset.content_type,
          'cache-control': asset.visibility === 'private' ? 'private, no-store' : 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        },
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
      if (body?.asset_id) {
        const asset = await loadOwnedAsset(String(body.asset_id), sid);
        inputAssetId = asset.id;
      }
      const dayStart = startOfToday();
      const mine = await db.from('jobs').select('id', { count: 'exact' }).eq('owner_session', sid).eq('mock', false).gte('created_at', dayStart).limit(1);
      if (!mine.error && mine.count >= DAILY_QUOTA_PER_SESSION) fail('quota_exceeded', 429);
      const all = await db.from('jobs').select('id', { count: 'exact' }).eq('mock', false).gte('created_at', dayStart).limit(1);
      if (!all.error && all.count >= DAILY_QUOTA_GLOBAL) fail('provider_busy', 429, '今日站点生成额度已满，明天再来');
      const id = newId('j');
      rows(await db.from('jobs').insert({
        id, owner_session: sid, status: 'queued', prompt, negative_prompt: negativePrompt,
        model, ratio, input_asset_id: inputAssetId, attempts: 0, mock: false,
      }));
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
        for (const id of ids) { const a = await loadOwnedAsset(id, sid); if (a.kind !== 'result') fail('invalid_input', 400, '画册只收录生成作品'); }
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

    const shareMatch = path.match(/^\/api\/v1\/albums\/(al_[0-9a-f]{24})\/share$/);
    if (shareMatch && method === 'POST') {
      const sid = ownerOf(request);
      const album = await loadOwnedAlbum(shareMatch[1], sid);
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
      return Response.json({
        title: album.title, created_at: album.created_at,
        images: albumItems(album).map((id) => `/api/v1/share/${shareView[1]}/img/${id}`),
      });
    }
    const shareImg = path.match(/^\/api\/v1\/share\/([0-9a-f]{32})\/img\/(a_[0-9a-f]{24})$/);
    if (shareImg && method === 'GET') {
      const album = await loadSharedAlbum(shareImg[1]);
      if (!albumItems(album).includes(shareImg[2])) fail('not_found', 404);
      const found = rows(await db.from('assets').select('*').eq('id', shareImg[2]).limit(1));
      if (!found?.length || found[0].kind !== 'result') fail('not_found', 404);
      const file = await storage.download(found[0].storage_key);
      if (!file.ok) fail('internal', 503, '资产读取失败');
      return new Response(file.body, { headers: { 'content-type': found[0].content_type, 'cache-control': 'private, no-store' } });
    }
    const sharePage = path.match(/^\/api\/v1\/share\/([0-9a-f]{32})\/page$/);
    if (sharePage && method === 'GET') {
      const album = await loadSharedAlbum(sharePage[1]);
      const ids = albumItems(album).filter(Boolean);
      return new Response(albumPageHtml(album.title, ids), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
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
      const credit = user.name || '匿名创作者';
      if (typeof body.parent_work_id === 'string' && body.parent_work_id) {
        const pw = await loadWork(body.parent_work_id);
        if (pw.status !== 'published') fail('invalid_input', 400, '来源作品不可 fork');
        if (!pw.allow_fork) fail('invalid_input', 403, '作者已关闭 fork');
        depth = (pw.depth || 0) + 1; parentWork = pw.id; parentSkill = pw.parent_skill_id || pw.id;
      }
      const id = newId('wk');
      const r = await db.from('works').insert({
        id, owner_session: sid, result_asset_id: raid,
        skill_snapshot: { prompt: snap.prompt.slice(0, 4000), negative_prompt: snap.negative_prompt || null, model: snap.model || 'agnes-image-2.5-flash', ratio: snap.ratio || '3:4' },
        title, tags, status: 'published', allow_fork: body.allow_fork !== false,
        parent_work_id: parentWork, parent_skill_id: parentSkill, depth, author_credit: credit,
        moderation_degraded: Boolean(mod.degraded),
      }).select();
      if (r.error) fail('internal', 503, '发布失败，请稍后重试');
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
      const w = await loadWork(workMatch[1]);
      const sid = viewerKey(request);
      const isOwner = Boolean(sid) && w.owner_session === sid;
      if (w.status !== 'published' && !isOwner) fail('not_found', 404);
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
      if (!f?.length) fail('not_found', 404);
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
      const works = await Promise.all(list.map(async (w) => workMeta(w, await workCounts(w))));
      return Response.json({ works });
    }

    if (path === '/api/v1/me/works' && method === 'GET') {
      const sid = ownerOf(request);
      const list = rows(await db.from('works').select('*').eq('owner_session', sid).order('created_at', { ascending: false }).limit(100)) || [];
      const works = await Promise.all(list.map(async (w) => workMeta(w, { ...(await workCounts(w)), is_owner: true })));
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
      const list = rows(await db.from('tasks').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50)) || [];
      const tasks = await Promise.all(list.map(async (t) => {
        const c = await db.from('submissions').select('id', { count: 'exact' }).eq('task_id', t.id).limit(1);
        return {
          id: t.id, theme: t.theme, constraints: t.constraints, owner_id: t.owner_session,
          status: t.status, created_at: t.created_at,
          submission_count: Number(c.count) || 0,
          is_owner: Boolean(viewer) && t.owner_session === viewer,
        };
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
      const works = await Promise.all(subs.map(async (s) => {
        const wf = rows(await db.from('works').select('*').eq('id', s.work_id).limit(1));
        return wf?.length && wf[0].status === 'published' ? workMeta(wf[0]) : null;
      }));
      return Response.json({
        task: {
          id: t.id, theme: t.theme, constraints: t.constraints, status: t.status,
          owner_id: t.owner_session, submission_count: subs.length,
          is_owner: t.owner_session === viewerKey(request),
        },
        works: works.filter(Boolean),
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
      await db.from('works').update({ status: 'published' }).eq('id', w.id).select();
      await db.from('reports').update({ status: 'resolved' }).eq('work_id', w.id).select();
      return Response.json({ ok: true, status: 'published' });
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
      }
      await db.from('works').delete().eq('owner_session', sid);
      await db.from('comments').delete().eq('owner_session', sid);
      await db.from('likes').delete().eq('owner_session', sid);
      await db.from('notifications').delete().eq('owner_session', sid);
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
      return Response.json({ ok: true, assets_purged: assetsPurged, shares_expired: sharesExpired, jobs_purged: jobsPurged });
    }

    // 审核降级人工复核：列出待复核作品，并支持通过/下架
    if (path === '/api/v1/maintenance/review' && method === 'GET') {
      requireMaintenance(request);
      const all = rows(await db.from('works').select('*').eq('status', 'published').limit(500)) || [];
      const items = all.filter((w) => w.moderation_degraded);
      return Response.json({ works: items.map((w) => workMeta(w)) });
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