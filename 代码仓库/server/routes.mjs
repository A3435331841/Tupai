import {
  AppError, fail, errResponse, rows, readJson, requireSession, newId,
  imageSize, ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, MODEL_WHITELIST, RATIOS,
  DAILY_QUOTA_PER_SESSION, DAILY_QUOTA_GLOBAL, MESSAGES,
} from './util.mjs';
import { createKeyScheduler } from './scheduler.mjs';
import { createAgnesProvider } from './agnes.mjs';
import { mockOptimize, mockGenerate } from './mock.mjs';
import { TEMPLATES, ensureSeeded } from './seed.mjs';
import { renderSkillMarkdown } from './skillmd.mjs';
import { getUser } from './auth.mjs';

const LEASE_MS = 90_000;
const MAX_ATTEMPTS = 3;

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

  async function loadOwnedAsset(id, sid) {
    const found = rows(await db.from('assets').select('*').eq('id', id).limit(1));
    if (!found?.length) fail('not_found', 404);
    const asset = found[0];
    if (asset.visibility === 'private' && asset.owner_session !== sid) fail('not_found', 404);
    return asset;
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
    rows(await db.from('assets').insert({
      id, owner_session: sid, kind, storage_key: storageKey, visibility,
      content_type: mime, bytes: bytes.length, width, height,
    }));
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
    let out;
    try {
      out = await agnes.generate({
        prompt: job.prompt, negativePrompt: job.negative_prompt,
        model: job.model, ratio: job.ratio, baseImage,
      });
    } catch {
      out = { busy: true };
    }
    let mock = false;
    if (out.busy) { out = mockGenerate({ prompt: job.prompt }); mock = true; }
    const resultId = newId('a');
    const stored = await storeAsset({ id: resultId, sid, kind: 'result', visibility: 'private', bytes: out.bytes, mime: out.mime });
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

    if (path === '/api/v1/auth/bind' && method === 'POST') {
      const user = currentUser(request);
      if (!user) fail('login_required', 401);
      const guestSid = requireSession(request);
      const target = 'u:' + user.user_id;
      if (guestSid === target) return Response.json({ migrated: 0, owner_key: target });
      let migrated = 0;
      for (const table of ['assets', 'skills', 'jobs']) {
        const r = await db.from(table).update({ owner_session: target }).eq('owner_session', guestSid).select();
        if (r.error) fail('internal', 503, '绑定迁移失败，请稍后重试');
        migrated += r.data?.length || 0;
      }
      return Response.json({ migrated, owner_key: target });
    }

    if (path === '/api/v1/quota' && method === 'GET') {
      const sid = ownerOf(request);
      const dayStart = startOfToday();
      const mine = await db.from('jobs').select('id', { count: 'exact' }).eq('owner_session', sid).gte('created_at', dayStart).limit(1);
      const all = await db.from('jobs').select('id', { count: 'exact' }).gte('created_at', dayStart).limit(1);
      if (mine.error || all.error) fail('internal', 503, '额度查询失败，请稍后重试');
      const sessionUsed = Number(mine.count) || 0;
      const globalUsed = Number(all.count) || 0;
      return Response.json({
        session_used: sessionUsed, session_limit: DAILY_QUOTA_PER_SESSION,
        global_used: globalUsed, global_limit: DAILY_QUOTA_GLOBAL,
        remaining: Math.max(0, Math.min(DAILY_QUOTA_PER_SESSION - sessionUsed, DAILY_QUOTA_GLOBAL - globalUsed)),
      });
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
      const id = newId('a');
      const stored = await storeAsset({ id, sid, kind, visibility: 'private', bytes, mime });
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
      let count = Number(body?.count ?? 3);
      if (!Number.isInteger(count) || count < 2 || count > 4) count = 3;
      let imageBytes = null, imageMime = null;
      if (assetId) {
        const asset = await loadOwnedAsset(assetId, sid);
        imageBytes = await assetBytes(asset);
        imageMime = asset.content_type;
      }
      let out;
      try { out = await agnes.optimize({ imageBytes, imageMime, text, count }); }
      catch { out = { parseFailed: true }; }
      let mock = false;
      if (out.busy || out.parseFailed || !out.candidates?.length) {
        out = mockOptimize({ text, count });
        mock = true;
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
      const mine = await db.from('jobs').select('id', { count: 'exact' }).eq('owner_session', sid).gte('created_at', dayStart).limit(1);
      if (!mine.error && mine.count >= DAILY_QUOTA_PER_SESSION) fail('quota_exceeded', 429);
      const all = await db.from('jobs').select('id', { count: 'exact' }).gte('created_at', dayStart).limit(1);
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

    if (path === '/api/v1/links/parse' && method === 'POST') {
      fail('parse_failed', 422, '链接解析暂未开放，请直接上传图片或文字；视频请截帧上传');
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