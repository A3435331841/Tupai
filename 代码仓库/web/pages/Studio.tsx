import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fetchAssetBlob, downloadBlob, downloadText, ApiRequestError } from '@/lib/api';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
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
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const LAST_JOB_KEY = 'tupai-last-job';
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
    if (!demo && !tplId && !assetParam) return;
    (async () => {
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

  async function startOptimize(fromReady = false) {
    const hasImg = Boolean(file || assetId);
    const idea = text.trim();
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
    clearStoredLastJob();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">创作台</h1>
        <Badge variant="secondary">{hasImage ? '图生图 · 有底图' : '文生图 · 纯文字'}</Badge>
        {optimize?.mock && <Badge variant="outline">演示候选</Badge>}
        {converting && <Badge variant="outline">HEIC 转换中…</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void importSkillFile(f); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ''; if (f) void pickFile(f); }} />
          <Button variant="outline" size="sm" onClick={openMySkills}>我的配方</Button>
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>导入 Skills 配方</Button>
          {stage !== 'entry' && <Button variant="ghost" size="sm" onClick={resetAll}>重新开始</Button>}
        </div>
      </div>

      {stage === 'entry' && lastJob && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {lastJob.status === 'succeeded' ? '上次生成的作品还在' : lastJob.status === 'failed' ? '上次生成失败了' : '上次生成还没完成'}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {new Date(lastJob.created_at).toLocaleString('zh-CN')} · {lastJob.model} · {lastJob.ratio}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={restoreLastJob}>
                {lastJob.status === 'succeeded' ? '查看上次作品' : lastJob.status === 'failed' ? '恢复上次设置' : '继续上次生成'}
              </Button>
              <Button size="sm" variant="ghost" onClick={discardLastJob}>丢弃</Button>
            </div>
          </div>
        </Card>
      )}

      {stage === 'entry' && (
        <Card className="p-5">
          <Tabs value={tab} onValueChange={(v) => { const next = v as 'image' | 'text'; setTab(next); if (next === 'text') adoptFile(null); }}>
            <TabsList>
              <TabsTrigger value="image">上传图片</TabsTrigger>
              <TabsTrigger value="text">输入文字</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'image' ? (
            <div className="mt-4">
              {!preview ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void pickFile(f); }}
                  className="flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 p-6 text-sm text-muted-foreground hover:border-primary/50"
                >
                  <span className="text-3xl">📷</span>
                  点击选择或拖拽图片到此处
                  <span className="text-xs">JPG / PNG / WebP / HEIC · ≤15MB · 原图全程私密，仅本会话可见</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-start gap-4">
                  <img src={preview} alt="原图预览" className="max-h-56 rounded-lg border border-border object-contain" />
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" onClick={() => adoptFile(null)}>清除重选</Button>
                    <p className="max-w-48 text-xs text-muted-foreground">可以补一句想法（可选），例如「想要胶片感」</p>
                    <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="可选：一句话描述想要的感觉" className="max-w-64" rows={3} />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-4">
              <Label htmlFor="idea">一句话描述你想要的画面</Label>
              <Textarea id="idea" value={text} onChange={(e) => setText(e.target.value)} rows={4}
                placeholder="例如：想要胶片感的旅行照，傍晚暖光，人物自然" className="mt-2" />
              <p className="mt-2 text-xs text-muted-foreground">纯文字入口走文生图；生成前可随时补底图。</p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={busy || converting} onClick={() => void startOptimize(false)}>自动优化提示词</Button>
            <span className="text-xs text-muted-foreground">不会写提示词没关系：系统产出 2–4 条中文摘要候选 + 相似模板推荐</span>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setLinkOpen(true)}>粘贴抖音链接</Button>
          </div>
        </Card>
      )}

      {stage === 'optimizing' && (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            正在分析{tab === 'image' ? '画面' : '意图'}并优化提示词（约 3–10 秒）…
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        </Card>
      )}

      {(stage === 'ready' || stage === 'generating') && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="min-w-0 space-y-4">
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">底图</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">有底图走图生图；不上传也可直接文生图。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                    {preview ? '更换底图' : '上传底图'}
                  </Button>
                  {preview && <Button size="sm" variant="ghost" onClick={() => adoptFile(null)}>移除</Button>}
                </div>
              </div>
              {preview ? (
                <img src={preview} alt="底图预览" className="mt-3 max-h-48 rounded-lg border border-border object-contain" />
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-3 flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border bg-secondary/30 p-4 text-sm text-muted-foreground hover:border-primary/50"
                >
                  加一张你的照片（推荐图生图）
                  <span className="text-xs">没有照片也可以继续用当前提示词直接生成</span>
                </button>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={!canReroll || busy} onClick={() => void startOptimize(true)}>
                  换一批候选
                </Button>
                <span className="text-[11px] text-muted-foreground">对候选不满意时，用当前底图/文字重新生成候选；不会丢失底图。</span>
              </div>
            </Card>

            {(templates.length > 0 || appliedTemplate) && (
              <Card className="p-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="min-w-40">
                    <Label className="text-xs" htmlFor="template-select">套用模板</Label>
                    <NativeSelect id="template-select" className="mt-1 w-full" value={appliedTemplate?.id || ''}
                      onChange={(e) => {
                        const t = templates.find((x) => x.id === e.target.value);
                        if (t) applyTemplateData(t, hasImage);
                        else { setAppliedTemplate(null); setAppliedVariant(''); toast('已取消模板关联，当前提示词保留'); }
                      }}>
                      <option value="">不套用模板</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      {appliedTemplate && !templates.some((t) => t.id === appliedTemplate.id) && (
                        <option value={appliedTemplate.id}>{appliedTemplate.title}</option>
                      )}
                    </NativeSelect>
                  </div>
                  {appliedTemplate?.variants?.length ? (
                    <div className="min-w-36">
                      <Label className="text-xs" htmlFor="variant-select">模板变体</Label>
                      <NativeSelect id="variant-select" className="mt-1 w-full" value={appliedVariant}
                        disabled={!hasImage}
                        onChange={(e) => applyTemplateData(appliedTemplate, hasImage, e.target.value)}>
                        <option value="">默认</option>
                        {appliedTemplate.variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </NativeSelect>
                    </div>
                  ) : null}
                </div>
                {appliedTemplate && !hasImage && (
                  <p className="mt-2 text-xs text-muted-foreground">当前用「套用后示意」文生图提示词；加一张底图后会自动切换为图生图版本，变体也会解锁。</p>
                )}
                {appliedTemplate && hasImage && appliedVariantData && (
                  <p className="mt-2 text-xs text-muted-foreground">已选变体：{appliedVariantData.label}（图生图）。</p>
                )}
              </Card>
            )}

            {optimize && optimize.candidates.length > 0 && (
              <section aria-label="候选提示词">
                <h2 className="mb-2 text-sm font-semibold">候选提示词 · 点选后可在右侧高级编辑</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {optimize.candidates.map((c, i) => (
                    <Card key={i} className={`cursor-pointer p-3 text-xs transition-colors hover:border-primary/60 ${prompt === c.prompt ? 'border-primary ring-1 ring-primary/40' : ''}`}>
                      <button className="w-full text-left" onClick={() => applyCandidate(c, i)}>
                        <div className="mb-1 flex flex-wrap gap-1">
                          {(c.style_tags || []).slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                        </div>
                        <p className="mb-1 font-medium">{c.summary_zh || c.style_tags?.join(' · ') || '候选方案'}</p>
                        <p className="line-clamp-3 text-muted-foreground">{c.prompt}</p>
                      </button>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {optimize && optimize.recommendations.length > 0 && (
              <section aria-label="相似推荐">
                <h2 className="mb-2 text-sm font-semibold">
                  {optimize.recommendations_fallback ? '没有完全匹配的，试试这些模板' : '相似模板 / Skills · 一键同款'}
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                  {optimize.recommendations.map((rec) => (
                    <Card key={rec.type + rec.id} className="w-44 shrink-0 overflow-hidden p-0">
                      <div className="aspect-[3/4] w-full bg-secondary">
                        {rec.cover_url
                          ? <AssetImage path={rec.cover_url} alt={`${rec.title} 预览`} className="size-full object-cover" isPublic={!rec.cover_private} />
                          : <div className="grid size-full place-items-center text-xs text-muted-foreground">我的配方</div>}
                      </div>
                      <div className="p-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-semibold">{rec.title}</span>
                          <Badge variant="secondary" className="shrink-0 text-[10px]">{rec.type === 'template' ? '模板' : '配方'}</Badge>
                        </div>
                        {rec.match_tags?.length ? (
                          <p className="mt-1 text-[10px] text-primary">匹配：{rec.match_tags.slice(0, 3).join(' · ')}</p>
                        ) : <p className="mt-1 text-[10px] text-muted-foreground">推荐试试</p>}
                        {rec.description && <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{rec.description}</p>}
                        <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full text-xs" onClick={() => applyRecommendation(rec)}>一键同款</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}

            {jobError && (
              <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
                {jobError}
                {pendingJobId
                  ? <Button variant="link" size="sm" onClick={restoreLastJob}>继续等待</Button>
                  : <Button variant="link" size="sm" onClick={runGenerate}>重试</Button>}
              </Card>
            )}
          </div>

          <Card className="h-fit p-4 lg:sticky lg:top-20">
            <h2 className="text-sm font-semibold">当前方案与参数</h2>
            {currentSummary && (
              <p data-testid="current-summary" className="mt-2 rounded-md bg-secondary/60 p-2 text-xs text-foreground">
                {currentSummary}{promptDirty ? '（已手动修改）' : ''}
              </p>
            )}
            <Label className="mt-3 text-xs" htmlFor="prompt">{`正向提示词（${prompt.length}/4000）`}</Label>
            <p className="mt-0.5 text-[10px] text-muted-foreground">高级编辑：英文提示词；上方中文摘要用于快速判断</p>
            <Textarea id="prompt" value={prompt} onChange={(e) => { setPrompt(e.target.value.slice(0, 4000)); setPromptDirty(true); }} rows={8} className="mt-1 text-xs" />
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">负面提示词（可选）</summary>
              <Textarea value={negative} onChange={(e) => setNegative(e.target.value.slice(0, 1000))} rows={3} className="mt-2 text-xs" placeholder="不想要的伪影，如 plastic skin, text" />
            </details>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs" htmlFor="model">模型</Label>
                <NativeSelect id="model" value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 w-full">
                  {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </NativeSelect>
                {currentModel?.description && <p className="mt-1 text-[10px] text-muted-foreground">{currentModel.description}</p>}
              </div>
              <div>
                <Label className="text-xs" htmlFor="ratio">画幅</Label>
                <NativeSelect id="ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} className="mt-1 w-full">
                  {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </NativeSelect>
              </div>
            </div>
            <Button className="mt-4 w-full" size="lg" disabled={stage === 'generating' || converting || Boolean(quota && quota.remaining <= 0)} onClick={runGenerate}>
              {stage === 'generating' ? '生成中…' : quota && quota.remaining <= 0 ? '今日额度已用完' : '生成作品'}
            </Button>
            {quota && (
              <p className="mt-2 text-center text-[11px] text-muted-foreground">今日还可生成 {quota.remaining} 次</p>
            )}
            {stage === 'generating' && (
              <div className="mt-3 space-y-2">
                <Skeleton className="aspect-[3/4] w-full rounded-lg" />
                <p className="text-center text-xs text-muted-foreground">{genPhase}</p>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
              改环境不改主体；不满意可再生成 3–5 次。结果带 AI 生成标识，原图不公开。
            </p>
          </Card>
        </div>
      )}

      {stage === 'result' && job?.result && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card className="overflow-hidden p-0">
            {preview && resultUrl ? (
              <CompareSlider before={preview} after={resultUrl} />
            ) : resultUrl ? (
              <div className="relative">
                <img src={resultUrl} alt="AI 生成结果" className="block w-full" />
                <span className="absolute right-2 top-2 rounded bg-black/55 px-2 py-0.5 text-xs text-white">AI 生成</span>
              </div>
            ) : null}
          </Card>
          <div className="space-y-3">
            <Card className="p-4">
              <h2 className="text-sm font-semibold">带走这张作品</h2>
              <div className="mt-3 grid gap-2">
                <Button onClick={downloadResult}>下载成品（含 AI 标识）</Button>
                <Button variant="outline" onClick={runGenerate}>再生成一张</Button>
                <Button variant="outline" onClick={() => { setSkillOpen(true); setSavedSkill(null); setSkillTitle(skillTitle || '我的图派配方'); }}>存为 Skills 配方</Button>
                <Button variant="ghost" onClick={() => setStage('ready')}>返回修改提示词</Button>
              </div>
              {job.result.mock && <p className="mt-3 text-xs text-muted-foreground">演示模式占位图：AI 服务恢复后再生成即为真实出图。</p>}
            </Card>
            <Card className="p-4 text-xs text-muted-foreground">
              <p>模型：{job.result.mock ? '演示' : model} · 画幅：{ratio}</p>
              <p className="mt-1">原图全程私密；发布结果时请保留 AI 生成标注。</p>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate('/legal')}>隐私与 AI 说明</Button>
            </Card>
          </div>
        </div>
      )}

      <Dialog open={skillOpen} onOpenChange={setSkillOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>存为 Skills 配方</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="skill-title" className="text-xs">配方名称</Label>
              <Input id="skill-title" value={skillTitle} onChange={(e) => setSkillTitle(e.target.value.slice(0, 100))} className="mt-1" placeholder="例如：夜景提亮·我的聚餐照" />
            </div>
            <div>
              <Label htmlFor="skill-notes" className="text-xs">备注（可选）</Label>
              <Textarea id="skill-notes" value={skillNotes} onChange={(e) => setSkillNotes(e.target.value.slice(0, 300))} rows={2} className="mt-1" placeholder="适合什么场景、注意什么" />
            </div>
            {!savedSkill ? (
              <Button className="w-full" disabled={busy} onClick={saveSkill}>保存配方</Button>
            ) : (
              <div className="grid gap-2">
                <Button variant="outline" onClick={exportJson}>导出配方 JSON（tupai-skill-v1）</Button>
                <Button variant="outline" onClick={exportMd}>导出 Qoder SKILL.md</Button>
                <Button variant="ghost" onClick={openMySkills}>查看我的配方</Button>
                <p className="text-xs text-muted-foreground">JSON 可在图派「导入 Skills 配方」回填；SKILL.md 可装入 Qoder 等 Agent 工具，形成「作品 → 配方 → 技能」。</p>
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
          {mySkills === null && (
            <div className="grid gap-2 py-4">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
            </div>
          )}
          {mySkills && mySkills.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有保存过配方。生成结果后点「存为 Skills 配方」。</p>
          )}
          {mySkills && mySkills.length > 0 && (
            <div className="space-y-2">
              {mySkills.map((s) => (
                <div key={s.skill_id} className="flex items-center gap-3 rounded-lg border border-border p-2">
                  <div className="size-12 shrink-0 overflow-hidden rounded bg-secondary">
                    {s.cover_url
                      ? <AssetImage path={s.cover_url} alt={`${s.title} 封面`} className="size-full object-cover" />
                      : <div className="grid size-full place-items-center text-[10px] text-muted-foreground">配方</div>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {s.model} · {s.params?.aspect || '3:4'}{s.notes ? ` · ${s.notes}` : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => applySkillRecord(s)}>套用</Button>
                </div>
              ))}
            </div>
          )}
          <DialogFooter />
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>粘贴抖音图文链接</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://v.douyin.com/xxxx/" onKeyDown={(e) => { if (e.key === 'Enter') void importLink(); }} />
            <p className="text-xs text-muted-foreground">仅支持单条图文帖；视频请截帧后上传。解析所得图文仅用于本次创作，不存储、不公开。风控或跨域受限时请手动保存图片上传。</p>
            <Button className="w-full" disabled={linkBusy} onClick={() => void importLink()}>{linkBusy ? '解析中…' : '解析并入场'}</Button>
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
}
