import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUrl, fetchAssetBlob, downloadBlob, downloadText, ApiRequestError } from '@/lib/api';
import type {
  Candidate, JobResult, ModelInfo, OptimizeResult, Quota, Recommendation, SkillRecord, Template, TupaiSkill,
} from '@/lib/types';
import { AssetImage } from '@/components/AssetImage';
import { CompareSlider } from '@/components/CompareSlider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { NativeSelect } from '@/components/ui/native-select';
import { PublishDialog } from '@/components/PublishDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { BotAvatar } from '@/components/BotAvatar';
import type { AvatarSpec } from '@/components/BotAvatar';
import { AvatarEditorDialog } from '@/components/AvatarEditorDialog';
import { toast } from 'sonner';

type Stage = 'entry' | 'optimizing' | 'ready' | 'generating' | 'result';

type LastJob = {
  job_id: string;
  status: JobResult['status'];
  prompt: string;
  negative_prompt?: string;
  model: string;
  ratio: string;
  asset_id?: string | null;
  result_url?: string;
  result_asset_id?: string;
  error?: string | null;
  created_at: number;
};

const RATIOS = ['3:4', '1:1', '4:3', '16:9', '9:16', '2:3', '3:2'];
// 与首页一致的本地封面映射：优先本地 webp，避免依赖懒生成接口。
const LOCAL_COVERS: Record<string, string> = {
  'film-daily': '/templates/film-daily.webp',
  'night-bright': '/templates/night-bright.webp',
  'clean-portrait': '/templates/clean-portrait.webp',
  'travel-postcard': '/templates/travel-postcard.webp',
  'magazine-cover': '/templates/magazine-cover.webp',
};
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const LAST_JOB_KEY = 'tupai-last-job';

// 默认拟人头像：Grok 风软胶 blob 球 + 双杠眼睛，按角色配色分配造型
const DEFAULT_AVATARS: Record<string, AvatarSpec> = {
  '主脑': { variant: 0, color: '#EA580C' },
  '小光': { variant: 1, color: '#C9982F' },
  '小染': { variant: 4, color: '#7A5AA8' },
  '小词': { variant: 3, color: '#3F8A6B' },
  '小绘': { variant: 6, color: '#3F7FBF' },
  '小忆': { variant: 5, color: '#8A7A6A' },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : '操作失败，请稍后重试';
}

function readLastJob(): LastJob | null {
  try {
    const raw = localStorage.getItem(LAST_JOB_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LastJob;
    if (!parsed?.job_id || !parsed.created_at) return null;
    if (Date.now() - parsed.created_at > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LAST_JOB_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLastJob(job: LastJob) {
  try { localStorage.setItem(LAST_JOB_KEY, JSON.stringify(job)); } catch { /* private mode */ }
}

function clearStoredLastJob() {
  try { localStorage.removeItem(LAST_JOB_KEY); } catch { /* private mode */ }
}

function imageMime(file: File): string {
  const raw = (file.type || '').split(';')[0].trim().toLowerCase();
  if (raw) return raw;
  const ext = file.name.split('.').pop()?.toLowerCase();
  return ({
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif',
  } as Record<string, string>)[ext || ''] || '';
}

async function convertHeic(file: File): Promise<File> {
  // Chromium（桌面/安卓 Chrome）原生不解 HEIC，须用 libheif（heic2any, MIT）解码；按需动态加载
  const { default: heic2any } = await import('heic2any');
  const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  if (!blob || !blob.size) throw new Error('empty conversion');
  return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export default function Studio({ navigate }: { navigate: (to: string) => void }) {
  const [stage, setStage] = useState<Stage>('entry');
  const [tab, setTab] = useState<'image' | 'text'>('image');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [assetId, setAssetId] = useState<string | null>(null);
  const [optimize, setOptimize] = useState<OptimizeResult | null>(null);
  const [prompt, setPrompt] = useState('');
  const [negative, setNegative] = useState('');
  const [currentSummary, setCurrentSummary] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('agnes-image-2.5-flash');
  const [ratio, setRatio] = useState('3:4');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [appliedTemplate, setAppliedTemplate] = useState<Template | null>(null);
  const [appliedVariant, setAppliedVariant] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState(0);
  const [job, setJob] = useState<JobResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [genPhase, setGenPhase] = useState('排队中');
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [lastJob, setLastJob] = useState<LastJob | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillNotes, setSkillNotes] = useState('');
  const [savedSkill, setSavedSkill] = useState<string | null>(null);
  const [mySkillsOpen, setMySkillsOpen] = useState(false);
  const [mySkills, setMySkills] = useState<SkillRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [converting, setConverting] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [parentWorkId, setParentWorkId] = useState<string | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bootRef = useRef('');
  const resultBlobRef = useRef<Blob | null>(null);

  const hasImage = Boolean(file || assetId);
  const currentModel = models.find((m) => m.id === model);
  const canReroll = Boolean(file || assetId || text.trim());
  const appliedVariantData = appliedTemplate?.variants?.find((v) => v.id === appliedVariant);

  const refreshQuota = useCallback(() => {
    api.quota().then(setQuota).catch(() => {});
  }, []);

  useEffect(() => {
    api.models().then((r) => {
      setModels(r.models);
      const def = r.models.find((m) => m.default);
      if (def) setModel(def.id);
    }).catch(() => {});
    api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
    refreshQuota();
    setLastJob(readLastJob());
  }, [refreshQuota]);

  const normalizeModel = useCallback((id?: string) => {
    if (id && models.some((m) => m.id === id)) return id;
    return models.find((m) => m.default)?.id || 'agnes-image-2.5-flash';
  }, [models]);

  const applyTemplateData = useCallback((t: Template, hasImg: boolean, variantId = '') => {
    const variant = hasImg ? t.variants?.find((v) => v.id === variantId) : undefined;
    const nextPrompt = hasImg ? (variant?.prompt || t.prompt) : (t.sample_prompt || t.prompt);
    setPrompt(nextPrompt);
    setNegative((variant?.negative_prompt || t.negative_prompt || ''));
    setModel(t.default_model);
    setRatio(t.ratio || '3:4');
    setAppliedTemplate(t);
    setAppliedVariant(hasImg ? variantId : '');
    setCurrentSummary(t.title + (variant ? ` · ${variant.label}` : ''));
    setPromptDirty(false);
    setSelectedCandidate(0);
    setOptimize({ candidates: [], recommendations: [], mode: hasImg ? 'img2img' : 'txt2img' });
    setJob(null);
    setJobError(null);
    setResultUrl(null);
    resultBlobRef.current = null;
    setStage('ready');
    toast(`已套用「${t.title}${variant ? ' · ' + variant.label : ''}」，参数可继续修改`);
  }, []);

  const adoptFile = useCallback((f: File | null) => {
    const nextPreview = f ? URL.createObjectURL(f) : null;
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return nextPreview;
    });
    setFile(f);
    setAssetId(null);
    setJob(null);
    setJobError(null);
    setResultUrl(null);
    resultBlobRef.current = null;
    if (!f && appliedVariant) setAppliedVariant('');
    if (appliedTemplate && !promptDirty) {
      const nextVariant = f && appliedVariant ? appliedTemplate.variants?.find((v) => v.id === appliedVariant) : undefined;
      setPrompt(f ? (nextVariant?.prompt || appliedTemplate.prompt) : (appliedTemplate.sample_prompt || appliedTemplate.prompt));
      setNegative(nextVariant?.negative_prompt || appliedTemplate.negative_prompt || '');
      setOptimize({ candidates: [], recommendations: [], mode: f ? 'img2img' : 'txt2img' });
    }
  }, [appliedTemplate, appliedVariant, promptDirty]);

  const pickFile = useCallback(async (f: File | null) => {
    if (!f) { adoptFile(null); return; }
    let chosen = f;
    const mime = imageMime(chosen);
    const heic = mime === 'image/heic' || mime === 'image/heif';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mime)) {
      toast.error('仅支持 JPG / PNG / WebP 图片（HEIC 会自动转换）');
      return;
    }
    if (chosen.size > MAX_UPLOAD_BYTES) {
      toast.error('图片超过 15MB 上限');
      return;
    }
    if (heic) {
      setConverting(true);
      try {
        chosen = await convertHeic(chosen);
        if (chosen.size > MAX_UPLOAD_BYTES) throw new Error('too large after convert');
      } catch {
        toast.error('HEIC 转换失败，请先在相册导出为 JPG 后重试');
        return;
      } finally {
        setConverting(false);
      }
    }
    adoptFile(chosen);
  }, [adoptFile]);

  // Deep links: ?demo=night | ?demo=text&text=... | ?template=id（可组合 demo+template）
  useEffect(() => {
    const key = window.location.search;
    if (bootRef.current === key) return;
    bootRef.current = key;
    const q = new URLSearchParams(key);
    const demo = q.get('demo');
    const tplId = q.get('template');
    const assetParam = q.get('asset');
    const forkParam = q.get('fork');
    if (!demo && !tplId && !assetParam && !forkParam) return;
    (async () => {
      if (forkParam && !demo && !tplId && !assetParam) {
        try {
          const f = await api.forkWork(forkParam);
          setPrompt(f.skill_snapshot.prompt);
          setNegative(f.skill_snapshot.negative_prompt || '');
          setModel(normalizeModel(f.skill_snapshot.model));
          if (RATIOS.includes(f.skill_snapshot.ratio)) setRatio(f.skill_snapshot.ratio);
          setParentWorkId(f.parent_work_id);
          setCurrentSummary(`做同款：${f.title}`);
          setPromptDirty(true);
          setOptimize({ candidates: [], recommendations: [], mode: 'txt2img' });
          setStage('ready');
          toast('已继承配方，可上传自己的底图或直接生成，再发布 fork 作品');
        } catch (e) { toast.error(e instanceof ApiRequestError ? e.message : '该作品不可 fork'); }
        return;
      }
      if (assetParam && !demo && !tplId) {
        try {
          const blob = await fetchAssetBlob(`/api/v1/assets/${assetParam}/content`);
          const f = new File([blob], 'library-asset.jpg', { type: blob.type || 'image/jpeg' });
          setTab('image'); setFile(f); setAssetId(assetParam);
          setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
          toast('底图已从资产库就位，点「自动优化提示词」开始');
        } catch { toast.error('底图加载失败或无权访问'); }
        return;
      }
      let tpl: Template | undefined;
      if (tplId) {
        try {
          const r = await api.templates();
          setTemplates(r.templates);
          tpl = r.templates.find((x) => x.id === tplId);
        } catch { /* fall through to direct upload */ }
      }
      if (demo === 'night') {
        try {
          const res = await fetch('/samples/demo-night.jpg');
          if (!res.ok) throw new Error('sample missing');
          const blob = await res.blob();
          const sample = new File([blob], 'demo-night.jpg', { type: 'image/jpeg' });
          setFile(sample);
          setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(sample); });
          setAssetId(null);
          if (tpl) {
            applyTemplateData(tpl, true);
            toast('样例废片 + 夜景提亮模板已就位，可直接生成，也可换图或换一批候选');
          } else {
            setText('把这张暗光聚餐照自然提亮，保留人物和夜晚氛围');
            toast('样例废片已入场，点「自动优化提示词」开始');
          }
        } catch {
          toast.error('样例图加载失败，请直接上传自己的照片');
        }
      } else if (demo === 'text') {
        setTab('text');
        setText(q.get('text') || '想要胶片感的旅行照');
      } else if (tpl) {
        applyTemplateData(tpl, false);
      }
    })();
  }, [applyTemplateData]);

  async function startOptimize(fromReady = false, ideaOverride?: string) {
    const hasImg = Boolean(file || assetId);
    const idea = (ideaOverride ?? text).trim();
    if (!fromReady && tab === 'image' && !hasImg) { toast.error('请先选择一张图片'); return; }
    if (!fromReady && tab === 'text' && !idea) { toast.error('请输入一句话描述'); return; }
    if (fromReady && !hasImg && !idea) { toast.error('请先上传底图，或输入一句话描述'); return; }
    setBusy(true);
    setStage('optimizing');
    setJobError(null);
    try {
      let aid = assetId;
      if (file && !aid) {
        const up = await api.upload(file, 'original');
        aid = up.asset_id;
        setAssetId(aid);
      }
      const r = await api.optimize({
        asset_id: hasImg ? aid || undefined : undefined,
        text: idea || undefined,
        count: 3,
      });
      setOptimize(r);
      const first = r.candidates[0];
      if (first) {
        setPrompt(first.prompt);
        setNegative(first.negative_prompt || '');
        setCurrentSummary(first.summary_zh || first.style_tags?.join(' · ') || 'AI 推荐方案');
      }
      setPromptDirty(false);
      setSelectedCandidate(0);
      setAppliedTemplate(null);
      setAppliedVariant('');
      setStage('ready');
      if (r.mock) toast.warning('AI 服务繁忙，已给出演示候选词；生成将尽快恢复真实出图');
    } catch (e) {
      toast.error(errText(e));
      setStage(fromReady ? 'ready' : 'entry');
    } finally {
      setBusy(false);
    }
  }

  function applyCandidate(c: Candidate, index: number) {
    setPrompt(c.prompt);
    setNegative(c.negative_prompt || '');
    setCurrentSummary(c.summary_zh || c.style_tags?.join(' · ') || '候选方案');
    setSelectedCandidate(index);
    setPromptDirty(false);
    setAppliedTemplate(null);
    setAppliedVariant('');
    toast('候选提示词已填入，可继续编辑');
  }

  function templateFromRec(rec: Recommendation): Template {
    return {
      id: rec.id, title: rec.title, description: rec.description || '',
      cover_url: rec.cover_url, prompt: rec.prompt, negative_prompt: rec.negative_prompt || '',
      sample_prompt: rec.sample_prompt ?? rec.prompt, variants: rec.variants || [],
      default_model: rec.default_model || model, ratio: rec.ratio || '3:4', tags: rec.match_tags || [],
    };
  }

  function applyRecommendation(rec: Recommendation) {
    if (rec.type === 'template') {
      const t = templates.find((x) => x.id === rec.id) || templateFromRec(rec);
      applyTemplateData(t, hasImage);
      return;
    }
    setPrompt(rec.prompt);
    setNegative(rec.negative_prompt || '');
    setModel(normalizeModel(rec.model));
    if (rec.ratio && RATIOS.includes(rec.ratio)) setRatio(rec.ratio);
    setCurrentSummary(rec.title);
    setPromptDirty(false);
    setSelectedCandidate(0);
    setAppliedTemplate(null);
    setAppliedVariant('');
    toast(`已套用「${rec.title}」，参数可继续修改`);
  }

  function applySkillRecord(s: SkillRecord) {
    setPrompt(s.prompt);
    setNegative(s.negative_prompt || '');
    setModel(normalizeModel(s.model));
    if (s.params?.aspect && RATIOS.includes(s.params.aspect)) setRatio(s.params.aspect);
    setCurrentSummary(`我的配方：${s.title}`);
    setPromptDirty(true);
    setSelectedCandidate(0);
    const t = s.template_id ? templates.find((x) => x.id === s.template_id) : undefined;
    setAppliedTemplate(t || null);
    setAppliedVariant('');
    setOptimize({ candidates: [], recommendations: [], mode: hasImage ? 'img2img' : 'txt2img' });
    setJobError(null);
    setStage('ready');
    setMySkillsOpen(false);
    toast(`已套用「${s.title}」，上传或更换底图后即可生成`);
  }

  async function pollJob(jobId: string, meta: LastJob) {
    setStage('generating');
    setJob(null);
    setJobError(null);
    setResultUrl(null);
    resultBlobRef.current = null;
    setGenPhase('排队中');
    setPendingJobId(null);
    const deadline = Date.now() + 120_000;
    let terminal: JobResult | null = null;
    try {
      while (Date.now() < deadline) {
        setGenPhase('分析画面 → 优化提示词 → 生成中（约 8–20 秒）');
        const j = await api.job(jobId);
        if (j.status === 'succeeded' || j.status === 'failed') { terminal = j; break; }
        const running = { ...meta, status: j.status };
        setLastJob(running);
        writeLastJob(running);
        await sleep(2000);
      }
      if (!terminal) {
        setJobError('生成超时：AI 服务可能繁忙，请重试或稍后再来');
        setStage('ready');
        setPendingJobId(jobId);
        const waiting = { ...meta, status: 'running' as const };
        setLastJob(waiting);
        writeLastJob(waiting);
        refreshQuota();
        return;
      }
      setJob(terminal);
      if (terminal.status === 'failed') {
        const message = terminal.error?.message || '生成失败，请重试';
        setJobError(message);
        setStage('ready');
        const failed = { ...meta, status: 'failed' as const, error: message };
        setLastJob(failed);
        writeLastJob(failed);
        refreshQuota();
        return;
      }
      if (terminal.result) {
        const blob = await fetchAssetBlob(terminal.result.url);
        resultBlobRef.current = blob;
        setResultUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        if (terminal.result.mock) toast.warning('演示模式：AI 服务繁忙，本次为占位示意图');
      }
      setStage('result');
      setPendingJobId(null);
      const done = {
        ...meta, status: 'succeeded' as const,
        result_url: terminal.result?.url, result_asset_id: terminal.result?.asset_id, error: null,
      };
      setLastJob(done);
      writeLastJob(done);
      refreshQuota();
    } catch (e) {
      setJobError(errText(e));
      setStage('ready');
    }
  }

  async function runGenerate() {
    if (!prompt.trim()) { toast.error('提示词不能为空'); return; }
    if (quota && quota.remaining <= 0) { toast.error('今日生成次数已用完，明天再来吧'); return; }
    setStage('generating');
    setJob(null);
    setJobError(null);
    setResultUrl(null);
    resultBlobRef.current = null;
    setGenPhase('排队中');
    setPendingJobId(null);
    try {
      let aid = assetId;
      if (file && !aid) {
        setGenPhase('上传底图中…');
        const up = await api.upload(file, 'original');
        aid = up.asset_id;
        setAssetId(aid);
      }
      const created = await api.generate({
        asset_id: aid || undefined,
        prompt: prompt.trim(),
        negative_prompt: negative.trim() || undefined,
        model, ratio,
      });
      const meta: LastJob = {
        job_id: created.job_id, status: 'queued', prompt: prompt.trim(),
        negative_prompt: negative.trim() || undefined, model, ratio,
        asset_id: aid, created_at: Date.now(),
      };
      setLastJob(meta);
      writeLastJob(meta);
      refreshQuota();
      await pollJob(created.job_id, meta);
    } catch (e) {
      setJobError(errText(e));
      setStage('ready');
      refreshQuota();
    }
  }

  async function restoreLastJob() {
    const lj = lastJob;
    if (!lj) return;
    setPrompt(lj.prompt);
    setNegative(lj.negative_prompt || '');
    setModel(normalizeModel(lj.model));
    if (RATIOS.includes(lj.ratio)) setRatio(lj.ratio);
    setPromptDirty(true);
    setCurrentSummary(lj.status === 'succeeded' ? '上次生成的作品' : '上次生成的设置');
    setJobError(null);
    setAppliedTemplate(null);
    setAppliedVariant('');
    try {
      const j = await api.job(lj.job_id);
      if (j.status === 'succeeded' && j.result) {
        const blob = await fetchAssetBlob(j.result.url);
        resultBlobRef.current = blob;
        setResultUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
        setAssetId(lj.asset_id || null);
        if (lj.asset_id) {
          try {
            const before = await fetchAssetBlob(`/api/v1/assets/${lj.asset_id}/content`);
            setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(before); });
          } catch { /* before image gone; result still viewable */ }
        }
        setJob(j);
        setOptimize({ candidates: [], recommendations: [], mode: lj.asset_id ? 'img2img' : 'txt2img' });
        setStage('result');
        const done = { ...lj, status: 'succeeded' as const, result_url: j.result.url, result_asset_id: j.result.asset_id };
        setLastJob(done);
        writeLastJob(done);
      } else if (j.status === 'failed') {
        setJob(j);
        setJobError(j.error?.message || '生成失败，请重试');
        setStage('ready');
        const failed = { ...lj, status: 'failed' as const, error: j.error?.message };
        setLastJob(failed);
        writeLastJob(failed);
      } else {
        const running = { ...lj, status: j.status };
        setLastJob(running);
        writeLastJob(running);
        await pollJob(lj.job_id, running);
      }
    } catch {
      clearStoredLastJob();
      setLastJob(null);
      toast.error('上次生成已失效，已清理');
    }
  }

  function discardLastJob() {
    clearStoredLastJob();
    setLastJob(null);
  }

  async function importLink() {
    if (!linkUrl.trim()) { toast.error('请粘贴抖音图文分享链接'); return; }
    setLinkBusy(true);
    try {
      const r = await api.parseLink(linkUrl.trim());
      const first = r.images[0];
      if (first) {
        const res = await fetch(first.temp_url);
        if (!res.ok) throw new Error('image fetch failed');
        const blob = await res.blob();
        const f = new File([blob], 'douyin-image.jpg', { type: blob.type || 'image/jpeg' });
        setTab('image');
        adoptFile(f);
      }
      if (r.text) setText(r.text);
      setLinkOpen(false); setLinkUrl('');
      toast.success('链接图文已入场，点「自动优化提示词」开始');
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : '链接图文入场失败（可能跨域限制），请手动保存图片后上传');
    } finally { setLinkBusy(false); }
  }

  async function downloadResult() {
    const blob = resultBlobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('decode failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(img, 0, 0);
      const label = 'AI 生成 · 图派 TuPai';
      const fs = Math.max(14, Math.round(canvas.width / 32));
      ctx.font = `${fs}px sans-serif`;
      const w = ctx.measureText(label).width + fs * 1.2;
      const h = fs * 2;
      const x = canvas.width - w - fs;
      const y = canvas.height - h - fs;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, fs / 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + fs * 0.6, y + h / 2);
      const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!out) throw new Error('encode failed');
      downloadBlob(out, `tupai-ai-${Date.now()}.png`);
      toast.success('已下载（含 AI 生成标识）');
    } catch {
      toast.error('下载失败：无法写入 AI 生成标识，请重试');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveSkill() {
    if (!skillTitle.trim()) { toast.error('请给配方起个名字'); return; }
    setBusy(true);
    try {
      const tags = optimize?.candidates?.[selectedCandidate]?.style_tags?.length
        ? optimize.candidates[selectedCandidate].style_tags
        : appliedTemplate?.tags?.slice(0, 6) || [];
      const skill: TupaiSkill = {
        format: 'tupai-skill', version: 1,
        title: skillTitle.trim(),
        prompt: prompt.trim(),
        negative_prompt: negative.trim() || undefined,
        model,
        template_id: appliedTemplate?.id,
        params: { aspect: ratio, size: '1K' },
        notes: skillNotes.trim() || undefined,
        style_tags: tags,
        cover_url: job?.result?.asset_id ? `/api/v1/assets/${job.result.asset_id}/content` : undefined,
        created_at: new Date().toISOString(),
      };
      const r = await api.saveSkill(skill);
      setSavedSkill(r.skill_id);
      setMySkills(null);
      toast.success('配方已保存，可导出 JSON / SKILL.md');
    } catch (e) { toast.error(errText(e)); }
    finally { setBusy(false); }
  }

  async function exportJson() {
    if (!savedSkill) return;
    try {
      const s = await api.skill(savedSkill);
      downloadText(JSON.stringify(s, null, 2), `${s.title || 'tupai-skill'}.json`, 'application/json');
    } catch (e) { toast.error(errText(e)); }
  }

  async function exportMd() {
    if (!savedSkill) return;
    try {
      const md = await api.skillMd(savedSkill);
      downloadText(md, 'SKILL.md', 'text/markdown');
      toast.success('SKILL.md 已导出，可装入 Qoder 等 Agent 工具');
    } catch (e) { toast.error(errText(e)); }
  }

  async function importSkillFile(f: File) {
    try {
      const parsed = JSON.parse(await f.text());
      const s = await api.importSkill(parsed);
      const nextModel = normalizeModel(s.model);
      setPrompt(s.prompt);
      setNegative(s.negative_prompt || '');
      setModel(nextModel);
      if (s.params?.aspect && RATIOS.includes(s.params.aspect)) setRatio(s.params.aspect);
      setCurrentSummary(`已导入配方：${s.title}`);
      setPromptDirty(true);
      setSelectedCandidate(0);
      const t = s.template_id ? templates.find((x) => x.id === s.template_id) : undefined;
      setAppliedTemplate(t || null);
      setAppliedVariant('');
      setOptimize({ candidates: [], recommendations: [], mode: hasImage ? 'img2img' : 'txt2img' });
      setStage('ready');
      setSkillTitle(s.title || '');
      setJobError(null);
      if (nextModel !== s.model) toast.warning('配方中的模型不可用，已切换为默认模型');
      toast.success(`配方「${s.title}」已导入，上传自己的底图即可生成`);
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : '导入失败：不是合法的 tupai-skill JSON');
    }
  }

  function openMySkills() {
    setSkillOpen(false);
    setMySkillsOpen(true);
    setMySkills(null);
    api.skills().then((r) => setMySkills(r.skills)).catch((e) => {
      toast.error(errText(e));
      setMySkills([]);
    });
  }

  function resetAll() {
    if (preview) URL.revokeObjectURL(preview);
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultBlobRef.current = null;
    setStage('entry');
    setTab('image');
    setFile(null);
    setPreview(null);
    setAssetId(null);
    setText('');
    setPrompt('');
    setNegative('');
    setCurrentSummary('');
    setPromptDirty(false);
    setOptimize(null);
    setAppliedTemplate(null);
    setAppliedVariant('');
    setSelectedCandidate(0);
    setJob(null);
    setJobError(null);
    setResultUrl(null);
    setGenPhase('排队中');
    setPendingJobId(null);
    setSkillOpen(false);
    setSkillTitle('');
    setSkillNotes('');
    setSavedSkill(null);
    setMySkillsOpen(false);
    setMySkills(null);
    setModel(models.find((m) => m.default)?.id || 'agnes-image-2.5-flash');
    setRatio('3:4');
    setLastJob(null);
    setParentWorkId(undefined);
    clearStoredLastJob();
  }

  // ===== V3 Bot 编排层：把真实业务状态映射成多 Bot 协作对话 =====
  type ChatTurn = { id: string; from: string; to: string; text: string; memory?: boolean; self?: boolean };
  const [turns, setTurns] = useState<ChatTurn[]>([
    { id: 't0', from: '你', to: '主脑', text: '帮我看看这张能不能改，想做成胶片那种感觉，别太白。', self: true },
    { id: 't1', from: '小光', to: '小染', text: '我这边看完了：逆光、眼神光在，背景乱。你定风格时把我说的「淡化背景」带进去。' },
    { id: 't2', from: '小染', to: '主脑', text: '收到。风格定胶片日常，暖调颗粒留阴影。按他讨厌假白的记忆，别写「磨皮、光滑、白皙」这类词。', memory: true },
    { id: 't3', from: '小词', to: '主脑', text: '写好了，已按小染的约束改过。等你确认就派给小绘。' },
  ]);
  const [userInput, setUserInput] = useState('');
  const [focusBot, setFocusBot] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, AvatarSpec>>(DEFAULT_AVATARS);
  const [editorFor, setEditorFor] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const addTurn = useCallback((turn: Omit<ChatTurn, 'id'>) => {
    setTurns((prev) => [...prev, { ...turn, id: `t${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }]);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns]);

  // 首屏演示态：用真实样例图 + 真实「胶片日常」模板，把编排画布预置到「4/5 步骤完成」
  // 只设置前端展示状态，不落库；用户一上传自己的图/发话即接管真实流程。
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || templates.length === 0 || stage !== 'entry' || file) return;
    seededRef.current = true;
    const tpl = templates.find((t) => t.id === 'film-daily') || templates[0];
    if (!tpl) return;
    fetch('/home/hero-street-raw.webp').then((r) => r.blob()).then((blob) => {
      const sample = new File([blob], 'demo-street.webp', { type: 'image/webp' });
      setFile(sample);
      setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(sample); });
      setText('想要胶片那种感觉，别太白');
      setPrompt(tpl.variants?.[0]?.prompt || tpl.prompt);
      setNegative(tpl.negative_prompt || '');
      setModel(tpl.default_model);
      setAppliedTemplate(tpl);
      setCurrentSummary(tpl.title);
      setOptimize({ candidates: [], recommendations: [], mode: 'img2img' });
      setStage('ready');
    }).catch(() => { seededRef.current = false; });
  }, [templates, stage, file]);

  // 真实状态 → Bot 节点状态
  const botState: Record<string, string> = {
    '主脑': stage === 'entry' ? '编排中' : stage === 'result' ? '已交付' : '编排中',
    '小光': hasImage ? '已完成' : '待命',
    '小染': (appliedTemplate || optimize) ? '已完成' : '待命',
    '小词': prompt.trim() ? '已完成' : '待命',
    '小绘': stage === 'generating' ? '出图中' : stage === 'result' ? '已完成' : '待命',
    '小忆': '常驻',
  };
  const doneSteps = [hasImage, Boolean(appliedTemplate || optimize), Boolean(prompt.trim()), stage === 'result'].filter(Boolean).length;

  // 用户发话：分派任务并触发真实流程
  function sendToBots() {
    const raw = userInput.trim();
    if (!raw) return;
    setUserInput('');
    addTurn({ from: '你', to: '主脑', text: raw, self: true });
    if (hasImage) {
      // 有底图：把这句话当作创作意图，走真实优化
      addTurn({ from: '主脑', to: '小光', text: '小光，先看这张画面的光线、主体和背景。' });
      addTurn({ from: '小光', to: '主脑', text: '收到，正在读取画面结构（逆光 / 眼神光 / 背景杂乱度）…' });
      setText(raw);
      void startOptimize(false, raw);
    } else {
      // 无底图：先定方向，提示用户上传或选风格
      addTurn({ from: '主脑', to: '你', text: '收到。先把想法记下——你可以上传一张照片让我分析，或在下方挑一个风格方向，我来帮你写成提示词。' });
      setText(raw);
    }
  }

  // 风格选择（真实套用模板 / 候选）
  function chooseStyle(t: Template, label?: string) {
    applyTemplateData(t, hasImage, label || '');
    addTurn({ from: '小染', to: '主脑', text: `风格定「${t.title}${label ? ' · ' + label : ''}」，已按你讨厌假白的记忆避开「磨皮、光滑、白皙」这类词。` , memory: true });
    addTurn({ from: '小词', to: '主脑', text: '提示词写好了，已把「背景虚化 / 保留眼神光」写进去。等你确认就派小绘。' });
  }

  // 派单给小绘 = 真实生成
  function dispatchToArtist() {
    if (!prompt.trim()) {
      toast.error('还没有提示词：先上传照片或挑一个风格方向');
      return;
    }
    if (quota && quota.remaining <= 0) {
      toast.error('今日生成次数已用完，明天再来吧');
      return;
    }
    addTurn({ from: '主脑', to: '小绘', text: '方案已确认，派单出图。原图保持私密，只把配方交给小绘。' });
    addTurn({ from: '小绘', to: '主脑', text: '收到，排队中 · 约 15 秒，请稍候…' });
    void runGenerate();
  }

  // 生成阶段推进：真实 job 状态 → bot 播报
  useEffect(() => {
    if (stage === 'generating' && !turns.some((t) => t.text.includes('正在生成'))) {
      addTurn({ from: '小绘', to: '主脑', text: `正在生成：${genPhase}` });
    }
    if (stage === 'result' && !turns.some((t) => t.text.includes('交付成品'))) {
      addTurn({ from: '小绘', to: '主脑', text: '交付成品。主图已带 AI 生成标识，原图始终不公开。' });
      addTurn({ from: '主脑', to: '你', text: '作品好了——右侧可下载、存配方或发布到社区。满意就派单再来一张。' });
    }
  }, [stage, genPhase, turns, addTurn]);

  const styleCovers: Record<string, string> = {
    'film-daily': '/templates/film-daily.webp',
    'night-bright': '/templates/night-bright.webp',
    'clean-portrait': '/templates/clean-portrait.webp',
    'travel-postcard': '/templates/travel-postcard.webp',
    'magazine-cover': '/templates/magazine-cover.webp',
  };

  const pipeline = [
    { name: '小光', role: '看画面', sub: '光线/主体/背景分析', state: botState['小光'], img: preview || (hasImage ? undefined : '/samples/demo-night.jpg'), hint: hasImage ? '已读取画面' : '点击上传照片', action: () => fileRef.current?.click() },
    { name: '小染', role: '定风格', sub: '胶片日常（暖调·颗粒）', state: botState['小染'], img: appliedTemplate ? (styleCovers[appliedTemplate.id] || apiUrl(appliedTemplate.cover_url)) : '/templates/film-daily.webp', hint: appliedTemplate ? appliedTemplate.title : '待挑方向', action: () => setFocusBot('小染') },
    { name: '小词', role: '写提示词', sub: '保留暖光·淡化背景', state: botState['小词'], text: currentSummary ? `${currentSummary} · 保留眼神光/淡化背景` : '等待风格方向', hint: prompt ? '已生成待确认' : '待命', action: () => setFocusBot('小词') },
    { name: '小绘', role: '出图', sub: stage === 'generating' ? '排队中 · 约 15 秒' : '等待派单', state: botState['小绘'], img: resultUrl || undefined, hint: stage === 'result' ? '成品已交付' : '确认后出图', action: dispatchToArtist },
  ];

  const handoff = [
    { name: '小光', state: botState['小光'], text: hasImage ? '画面分析：逆光/眼神光/背景杂乱' : '画面分析：等待上传', icon: '✓', tone: 'done' },
    { name: '小染', state: botState['小染'], text: appliedTemplate ? `风格：${appliedTemplate.title}（暖调颗粒）` : '风格：待挑选', icon: appliedTemplate ? '✓' : '·', tone: appliedTemplate ? 'done' : 'wait' },
    { name: '小词', state: botState['小词'], text: prompt ? '提示词：已生成待确认' : '提示词：等待风格', icon: prompt ? '…' : '·', tone: prompt ? 'run' : 'wait' },
    { name: '小绘', state: botState['小绘'], text: stage === 'result' ? '出图：已交付成品' : stage === 'generating' ? '出图：生成中' : '出图：等待派单', icon: stage === 'result' ? '✓' : stage === 'generating' ? '◌' : '·', tone: stage === 'result' ? 'done' : stage === 'generating' ? 'run' : 'wait' },
  ];

  // ===== 杂志编排台：Bot 元数据 / 焦点 / 进度备注 =====
  const BOT_META: Record<string, { label: string; role: string; summary: string }> = {
    '主脑': { label: '主脑', role: '编排与记忆', summary: '拆解任务，分派给各 Bot' },
    '小光': { label: '小光', role: '看画面', summary: hasImage ? '逆光 · 眼神光 · 背景杂乱' : '等待读取画面' },
    '小染': { label: '小染', role: '定风格', summary: appliedTemplate ? `风格：${appliedTemplate.title}` : '正在收敛胶片方向' },
    '小词': { label: '小词', role: '写提示词', summary: prompt.trim() ? '提示词已生成，待确认' : '等待风格方向' },
    '小绘': { label: '小绘', role: '出图', summary: stage === 'result' ? '成品已交付' : stage === 'generating' ? '排队出图中' : '等待派单' },
    '小忆': { label: '小忆', role: '常驻记忆', summary: '记住你讨厌假白磨皮' },
  };
  const BOT_ORDER = ['主脑', '小光', '小染', '小词', '小绘', '小忆'] as const;
  const focusKey = focusBot && BOT_META[focusBot] ? focusBot : '主脑';
  const curMeta = BOT_META[focusKey];
  const stateDot = (state: string) =>
    state === '已完成' || state === '已交付' ? '#2F7D5B' : state === '待命' || state === '常驻' ? '#C9B89F' : '#B4502A';
  const progressNote = stage === 'result'
    ? '成品已交付，可下载、存为配方或发布到社区。'
    : stage === 'generating'
      ? genPhase
      : '正在衔接各环节产物；已按你的记忆剔除偏白磨皮方案。';
  const metaOf = (name: string) => BOT_META[name] ?? { label: name, role: '', summary: '' };
  const avatarOf = (name: string): AvatarSpec => {
    const known = avatars[name] ?? DEFAULT_AVATARS[name];
    if (known) return known;
    return { variant: 0, color: '#8C7D6C' };
  };
  const motionFor = (name: string): 'idle' | 'busy' =>
    botState[name] === '编排中' || botState[name] === '出图中' ? 'busy' : 'idle';

  return (
    <div className="studio-editorial mx-auto flex w-full max-w-[1440px] min-h-0 flex-col px-5 py-6 sm:px-8 lg:h-full">
      <input ref={importRef} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSkillFile(f); e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ''; if (f) void pickFile(f); }} />

      {/* 页头 */}
      <div className="mb-6 flex shrink-0 flex-wrap items-end gap-4">
        <div>
          <div className="se-eyebrow mb-3 flex items-center gap-3 text-[13px] font-semibold">
            AI 影像风格重塑 <span className="h-px w-14 bg-[#DCCDB8]" />
          </div>
          <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-tight sm:text-[34px]">街拍变胶片 · 任务编排</h1>
        </div>
        <span className="rounded-full bg-[#B4502A]/10 px-2.5 py-1 text-[11px] font-semibold text-[#B4502A]">{doneSteps}/4 步</span>
        <div className="ml-auto flex items-center gap-5">
          <button type="button" className="se-link text-sm" onClick={openMySkills}>我的配方</button>
          <button type="button" className="se-link text-sm" onClick={() => importRef.current?.click()}>导入</button>
          <button type="button" className="se-link text-sm" onClick={() => navigate('/legal')}>隐私与 AI 说明</button>
          {stage !== 'entry' && <button type="button" className="se-link text-sm" onClick={resetAll}>重开</button>}
          <button type="button" className="se-btn-dark px-5 py-2.5 text-sm" onClick={resetAll}>＋ 新任务</button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[264px_minmax(0,1fr)_296px]">
        {/* ===== 左：Bot 会话列表 ===== */}
        <aside className="flex min-w-0 flex-col gap-1.5 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <p className="mb-2 px-1 text-[11px] font-semibold tracking-[.12em] text-[#B3A492]">BOT 团队</p>
          {BOT_ORDER.map((name) => {
            const meta = BOT_META[name];
            const active = focusKey === name;
            return (
              <button key={name} type="button" onClick={() => setFocusBot(active ? null : name)}
                className={`se-conv flex items-center gap-3 px-3 py-2.5 text-left ${active ? 'active' : ''}`}>
                <BotAvatar spec={avatarOf(name)} size={34} motion={motionFor(name)} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold">{meta.label}</span>
                  <span className="block truncate text-[12px] text-[#8C7D6C]">{meta.summary}</span>
                </span>
                <span className="se-dot ml-auto shrink-0" style={{ background: stateDot(botState[name]) }} />
              </button>
            );
          })}
          <div className="mt-auto pt-4 text-[10.5px] leading-4 text-[#8C7D6C]">
            点任一 Bot 进入单独对话；每个节点产物会自动传给下一个 Bot。
          </div>
        </aside>

        {/* ===== 中：对话工作台 ===== */}
        <section className="flex min-w-0 min-h-0 flex-col gap-4">
          {/* 当前会话头 */}
          <div className="se-card flex shrink-0 items-center gap-3 px-5 py-4">
            <BotAvatar spec={avatarOf(focusKey)} size={38} motion={motionFor(focusKey)} />
            <div>
              <div className="text-[15px] font-bold">与{curMeta.label}单独对话</div>
              <div className="text-[12px] text-[#8C7D6C]">{curMeta.role} · {botState[focusKey]}</div>
            </div>
            <span className="ml-auto rounded-full bg-[#7A5AA8]/10 px-3 py-1 text-[11px] font-semibold text-[#7A5AA8]">可直聊</span>
          </div>

          {/* 消息流 */}
          <div className="se-card flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 scrollbar-thin">
            {turns.map((t) => {
              const m = metaOf(t.from);
              return t.self ? (
                <div key={t.id} className="flex justify-end">
                  <div className="se-bubble-user max-w-[66%] px-4 py-3 text-[13px] leading-7">{t.text}</div>
                </div>
              ) : (
                <div key={t.id} className="flex gap-3">
                  <BotAvatar spec={avatarOf(t.from)} size={34} motion={motionFor(t.from)} />
                  <div className="min-w-0">
                    <div className="mb-1 text-[12px] text-[#8C7D6C]">{t.from} → {t.to}</div>
                    <div className={`se-bubble-bot max-w-[70%] px-4 py-3 text-[13px] leading-7 ${t.memory ? 'se-bubble-memory' : ''}`}>
                      {t.memory && <span className="mr-1">🧠</span>}
                      {t.text}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 候选方案 */}
            {optimize?.candidates?.length ? (
              <div>
                <p className="mb-2 text-[12px] font-bold text-[#6B5D52]">候选方案 · 点选套用</p>
                <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
                  {optimize.candidates.map((c, i) => (
                    <button key={i} type="button" onClick={() => applyCandidate(c, i)}
                      className={`se-photo w-32 shrink-0 text-left ${selectedCandidate === i ? 'ring-2 ring-[#B4502A]/40' : ''}`}>
                      <div className="h-20 rounded-sm bg-gradient-to-br from-[#E8B98A] to-[#B4502A]" />
                      <div className="mt-2 truncate text-[12px] font-medium">{c.summary_zh || c.style_tags.join(' · ') || `方案 ${i + 1}`}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {/* 相似推荐 · 一键同款 */}
            {optimize && optimize.recommendations.length > 0 && (
              <div aria-label="相似推荐">
                <p className="mb-2 text-[12px] font-bold text-[#6B5D52]">{optimize.recommendations_fallback ? '试试这些模板' : '相似模板 / Skills'}</p>
                <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
                  {optimize.recommendations.map((rec) => (
                    <button key={rec.type + rec.id} type="button" onClick={() => applyRecommendation(rec)}
                      className="se-photo w-32 shrink-0 text-left">
                      <div className="aspect-[4/3] overflow-hidden rounded-sm bg-[#F1E7D9]">
                        {rec.cover_url
                          ? <AssetImage path={rec.cover_url} alt={`${rec.title} 预览`} className="size-full object-cover" isPublic={!rec.cover_private} />
                          : <div className="grid size-full place-items-center text-[10px] text-[#8C7D6C]">我的配方</div>}
                      </div>
                      <div className="mt-2 truncate text-[12px] font-medium">{rec.title}</div>
                      <span className="mt-1 inline-block rounded-md border border-[#EADCC8] px-2 py-0.5 text-[10px] text-[#6B5D52]">一键同款</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 小染 · 风格模板 */}
            {focusBot === '小染' && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12px] font-bold text-[#6B5D52]">小染 · 挑一个风格方向</p>
                  <button type="button" className="text-[11px] text-[#8C7D6C] hover:text-[#B4502A]" onClick={() => setFocusBot(null)}>收起</button>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
                  {templates.map((t) => (
                    <button key={t.id} type="button" onClick={() => chooseStyle(t)} className="se-photo w-28 shrink-0 text-left" title={`套用 ${t.title}`}>
                      <div className="aspect-[4/3] overflow-hidden rounded-sm">
                        <img src={styleCovers[t.id] || apiUrl(t.cover_url)} alt="" className="size-full object-cover" />
                      </div>
                      <div className="mt-2 truncate text-[12px] font-medium">{t.title}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 小词 · 提示词参数 */}
            {(focusBot === '小词' || prompt.trim() || stage === 'ready' || stage === 'result') && (
              <div className="rounded-2xl border border-[#EADCC8] bg-[#FBF4EC] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[12px] font-bold">小词 · 当前提示词（可改）</p>
                  <span className="flex items-center gap-3">
                    <span className="text-[10px] text-[#8C7D6C]">正向提示词（{prompt.length}/4000）</span>
                    <button type="button" className="text-[11px] text-[#8C7D6C] hover:text-[#B4502A]" onClick={() => setFocusBot(null)}>收起</button>
                  </span>
                </div>
                <Textarea id="prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value.slice(0, 4000)); setPromptDirty(true); }} rows={3} className="text-xs" placeholder="还没有提示词：上传照片或挑一个风格方向" />
                <details className="mt-2"><summary className="cursor-pointer text-[11px] text-muted-foreground">负面提示词（可选）</summary>
                  <Textarea id="negative-prompt" value={negative} onChange={(e) => setNegative(e.target.value.slice(0, 1000))} rows={2} className="mt-1 text-xs" placeholder="磨皮、光滑、白皙 等" /></details>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <NativeSelect className="h-8 text-[11px]" value={model} onChange={(e) => setModel(e.target.value)}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </NativeSelect>
                  <NativeSelect className="h-8 text-[11px]" value={ratio} onChange={(e) => setRatio(e.target.value)}>
                    {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </NativeSelect>
                  <Button size="sm" variant="outline" disabled={!canReroll || busy} onClick={() => void startOptimize(true)}>换一批候选</Button>
                </div>
              </div>
            )}

            {/* 结果操作条 */}
            {stage === 'result' && job?.result && (
              <div className="se-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  {preview && resultUrl ? (
                    <div className="w-36 shrink-0 overflow-hidden rounded-lg border border-border"><CompareSlider before={preview} after={resultUrl} beforeLabel="原图" afterLabel="AI 生成结果" /></div>
                  ) : resultUrl ? <img src={resultUrl} alt="AI 生成结果" className="h-24 rounded-lg border border-border" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">小绘已交付 · {job.result.mock ? '演示占位图' : 'AI 生成成品'}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">模型：{model} · 画幅：{ratio} · 原图不公开</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button size="sm" className="se-btn-dark" onClick={downloadResult}>下载成品</Button>
                      <Button size="sm" variant="outline" onClick={() => { setSkillOpen(true); setSavedSkill(null); setSkillTitle(skillTitle || '我的图派配方'); }}>存为配方</Button>
                      <Button size="sm" variant="outline" onClick={() => setPublishOpen(true)}>发布社区</Button>
                      <Button size="sm" variant="outline" onClick={runGenerate}>再来一张</Button>
                      <Button size="sm" variant="ghost" onClick={() => setStage('ready')}>返回修改</Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {jobError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
                {jobError}
                {pendingJobId ? <Button variant="link" size="sm" onClick={restoreLastJob}>继续等待</Button> : <Button variant="link" size="sm" onClick={runGenerate}>重试</Button>}
              </div>
            )}
            {stage === 'generating' && <p className="text-center text-[12px] text-muted-foreground">{genPhase}</p>}
            <div ref={chatEndRef} />
          </div>

          {/* 输入条 */}
          <div className="se-card flex shrink-0 items-center gap-3 px-4 py-2.5">
            <button type="button" title="上传照片" onClick={() => fileRef.current?.click()} className="text-lg text-[#6B5D52]">＋</button>
            <button type="button" className="se-link text-[12px]" onClick={() => setLinkOpen(true)}>链接</button>
            <span className="text-[#B3A492]">@</span>
            <input value={userInput} onChange={(e) => setUserInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendToBots(); }}
              placeholder="说一句，或 @ 某个 Bot（回车发送）" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70" />
            <button type="button" className="se-link text-[13px]" onClick={sendToBots}>发送</button>
            <button type="button" className="se-btn-dark px-5 py-2.5 text-[13px]" onClick={dispatchToArtist}
              disabled={stage === 'generating' || Boolean(quota && quota.remaining <= 0)}>
              {stage === 'generating' ? '出图…' : '派单给小绘'}
            </button>
          </div>
          {quota && <p className="shrink-0 text-center text-[12px] text-[#B3A492]">今日还可生成 {quota.remaining} 次 · 原图全程私密</p>}
        </section>

        {/* ===== 右：当前 Bot 详情 ===== */}
        <aside className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <div className="se-card flex flex-col items-center p-5 text-center">
            <button
              type="button"
              onClick={() => setEditorFor(focusKey)}
              title="编辑头像"
              className="group relative rounded-full transition-transform hover:scale-105"
            >
              <BotAvatar spec={avatarOf(focusKey)} size={60} motion={motionFor(focusKey)} />
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/0 text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:bg-black/35 group-hover:opacity-100">更换</span>
            </button>
            <div className="mt-4 font-display text-[20px] font-extrabold">{curMeta.label}</div>
            <div className="mt-1 text-[13px] text-[#6B5D52]">{curMeta.role} · {botState[focusKey]}</div>
            <button type="button" className="mt-2 text-[11px] text-[#8C7D6C] hover:text-[#B4502A]" onClick={() => setEditorFor(focusKey)}>
              编辑头像 · 预设 / 生成 / 上传
            </button>
          </div>

          <div className="se-card p-5">
            <p className="mb-4 text-[12px] font-bold tracking-[.1em] text-[#B3A492]">正在进行</p>
            <div className="flex items-center">
              {pipeline.map((node, i) => (
                <Fragment key={node.name}>
                  <div className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="se-dot" style={{
                      background: stateDot(node.state),
                      boxShadow: stateDot(node.state) === '#B4502A' ? '0 0 0 4px rgba(180,80,42,.16)' : undefined,
                    }} />
                    <span className={`text-[11px] ${node.state === '待命' ? 'text-[#B3A492]' : 'font-semibold text-[#1F1A17]'}`}>{node.name}</span>
                  </div>
                  {i < pipeline.length - 1 && <span className="h-px w-3 bg-[#EADFCF]" />}
                </Fragment>
              ))}
            </div>
            <p className="mt-4 text-[12.5px] leading-7 text-[#6B5D52]">{progressNote}</p>
          </div>

          <div className="se-card p-5">
            <p className="mb-3 text-[12px] font-bold tracking-[.1em] text-[#B3A492]">交接产物</p>
            <div className="flex flex-col gap-3">
              {handoff.map((h) => (
                <div key={h.name} className="flex items-start gap-2.5">
                  <span className="se-dot mt-1.5" style={{ background: h.tone === 'done' ? '#2F7D5B' : h.tone === 'run' ? '#B4502A' : '#C9B89F' }} />
                  <span className="min-w-0 text-[12px] leading-5">
                    <b>{h.name}</b>
                    <span className="block text-[#8C7D6C]">{h.text}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="se-bubble-memory rounded-2xl p-4 text-[12.5px] leading-7">
            <b className="text-[#B4502A]">记忆 #07</b>　你讨厌假白磨皮，已把「清透人像」分支去掉，并把「背景虚化」写进提示词。
          </div>

          {lastJob && stage === 'entry' && (
            <div className="se-card p-4">
              <p className="text-[13px] font-medium">{lastJob.status === 'succeeded' ? '上次生成的作品还在' : '上次任务还没完成'}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={restoreLastJob}>查看 / 恢复</Button>
                <Button size="sm" variant="ghost" onClick={discardLastJob}>丢弃</Button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ===== 原有 Dialog 全部保留 ===== */}
      <Dialog open={skillOpen} onOpenChange={setSkillOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>存为 Skills 配方</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label htmlFor="skill-title" className="text-xs">配方名称</Label>
              <Input id="skill-title" value={skillTitle} onChange={(e) => setSkillTitle(e.target.value.slice(0, 100))} className="mt-1" placeholder="例如：夜景提亮·我的聚餐照" /></div>
            <div><Label htmlFor="skill-notes" className="text-xs">备注（可选）</Label>
              <Textarea id="skill-notes" value={skillNotes} onChange={(e) => setSkillNotes(e.target.value.slice(0, 300))} rows={2} className="mt-1" placeholder="适合什么场景、注意什么" /></div>
            {!savedSkill ? <Button className="w-full" disabled={busy} onClick={saveSkill}>保存配方</Button> : (
              <div className="grid gap-2">
                <Button variant="outline" onClick={exportJson}>导出配方 JSON（tupai-skill-v1）</Button>
                <Button variant="outline" onClick={exportMd}>导出 Qoder SKILL.md</Button>
                <Button variant="ghost" onClick={openMySkills}>查看我的配方</Button>
              </div>
            )}
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>

      <Dialog open={mySkillsOpen} onOpenChange={setMySkillsOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>我的配方</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">保存过的配方都在这里；套用后加自己的底图即可生成。</p>
          {mySkills === null && <div className="grid gap-2 py-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>}
          {mySkills && mySkills.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">还没有保存过配方。生成结果后点「存为 Skills 配方」。</p>}
          {mySkills && mySkills.length > 0 && (
            <div className="space-y-2">
              {mySkills.map((s) => (
                <div key={s.skill_id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <div className="size-12 shrink-0 overflow-hidden rounded bg-secondary">
                    {s.cover_url ? <AssetImage path={s.cover_url} alt={`${s.title} 封面`} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">配方</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{s.model} · {s.params?.aspect || '3:4'}{s.notes ? ` · ${s.notes}` : ''}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => applySkillRecord(s)}>套用</Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter />
        </DialogContent>
      </Dialog>

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen}
        resultAssetId={job?.result?.asset_id || ''}
        snapshot={{ prompt, negative_prompt: negative, model, ratio }}
        parentWorkId={parentWorkId}
        onPublished={() => { setParentWorkId(undefined); navigate('/community'); }} />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>粘贴抖音图文链接</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://v.douyin.com/xxxx/" onKeyDown={(e) => { if (e.key === 'Enter') void importLink(); }} />
            <p className="text-xs text-muted-foreground">仅支持单条图文帖；视频请截帧后上传。</p>
            <Button className="w-full" disabled={linkBusy} onClick={() => void importLink()}>{linkBusy ? '解析中…' : '解析并入场'}</Button>
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>

      <AvatarEditorDialog
        open={editorFor !== null}
        botName={editorFor ? metaOf(editorFor).label : ''}
        spec={editorFor ? avatarOf(editorFor) : DEFAULT_AVATARS['主脑']}
        defaultSpec={editorFor ? (DEFAULT_AVATARS[editorFor] ?? DEFAULT_AVATARS['主脑']) : DEFAULT_AVATARS['主脑']}
        onClose={() => setEditorFor(null)}
        onApply={(next) => {
          if (editorFor) setAvatars((prev) => ({ ...prev, [editorFor]: next }));
        }}
      />
    </div>
  );
}
