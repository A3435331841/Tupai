import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiUrl, fetchAssetBlob, downloadBlob, downloadText, ApiRequestError } from '@/lib/api';
import type { Candidate, JobResult, ModelInfo, OptimizeResult, Recommendation, Template, TupaiSkill } from '@/lib/types';
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
const RATIOS = ['3:4', '1:1', '4:3', '16:9', '9:16', '2:3', '3:2'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errText(e: unknown): string {
  return e instanceof ApiRequestError ? e.message : '操作失败，请稍后重试';
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
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState('agnes-image-2.5-flash');
  const [ratio, setRatio] = useState('3:4');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [job, setJob] = useState<JobResult | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [genPhase, setGenPhase] = useState('排队中');
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillTitle, setSkillTitle] = useState('');
  const [skillNotes, setSkillNotes] = useState('');
  const [savedSkill, setSavedSkill] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bootRef = useRef(false);
  const resultBlobRef = useRef<Blob | null>(null);

  useEffect(() => {
    api.models().then((r) => {
      setModels(r.models);
      const def = r.models.find((m) => m.default);
      if (def) setModel(def.id);
    }).catch(() => {});
    api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, []);

  const pickFile = useCallback((f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setAssetId(null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }, [preview]);

  // Deep links: ?demo=night | ?demo=text&text=... | ?template=id
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const q = new URLSearchParams(window.location.search);
    const demo = q.get('demo');
    const tpl = q.get('template');
    if (demo === 'night') {
      setTab('image');
      fetch('/samples/demo-night.jpg').then((r) => {
        if (!r.ok) throw new Error('sample missing');
        return r.blob();
      }).then((b) => {
        const f = new File([b], 'demo-night.jpg', { type: 'image/jpeg' });
        pickFile(f);
        toast('样例废片已入场，点「自动优化提示词」开始');
      }).catch(() => toast.error('样例图加载失败，请直接上传自己的照片'));
    } else if (demo === 'text') {
      setTab('text');
      setText(q.get('text') || '想要胶片感的旅行照');
    } else if (tpl) {
      api.templates().then((r) => {
        const t = r.templates.find((x) => x.id === tpl);
        if (!t) return;
        setTemplates(r.templates);
        setPrompt(t.prompt);
        setNegative(t.negative_prompt || '');
        setModel(t.default_model);
        setRatio(t.ratio || '3:4');
        setOptimize({ candidates: [], recommendations: [], mode: 'img2img' });
        setStage('ready');
        toast(`已套用「${t.title}」：上传底图后生成，或直接文生图`);
      }).catch(() => {});
    }
  }, [pickFile]);

  async function startOptimize() {
    if (tab === 'image' && !file) { toast.error('请先选择一张图片'); return; }
    if (tab === 'text' && !text.trim()) { toast.error('请输入一句话描述'); return; }
    setBusy(true);
    setStage('optimizing');
    setJobError(null);
    try {
      let aid = assetId;
      if (tab === 'image' && file && !aid) {
        const up = await api.upload(file, 'original');
        aid = up.asset_id;
        setAssetId(aid);
      }
      const r = await api.optimize({
        asset_id: tab === 'image' ? aid || undefined : undefined,
        text: text.trim() || undefined,
        count: 3,
      });
      setOptimize(r);
      const first = r.candidates[0];
      if (first) { setPrompt(first.prompt); setNegative(first.negative_prompt || ''); }
      setStage('ready');
      if (r.mock) toast.warning('AI 服务繁忙，已给出演示候选词；生成将尽快恢复真实出图');
    } catch (e) {
      toast.error(errText(e));
      setStage('entry');
    } finally { setBusy(false); }
  }

  function applyCandidate(c: Candidate) {
    setPrompt(c.prompt);
    setNegative(c.negative_prompt || '');
    toast('候选提示词已填入，可继续编辑');
  }

  function applyRecommendation(rec: Recommendation) {
    const t = templates.find((x) => x.id === rec.id);
    if (t) {
      setPrompt(t.prompt);
      setNegative(t.negative_prompt || '');
      setModel(t.default_model);
      setRatio(t.ratio || '3:4');
    } else {
      setPrompt(rec.prompt);
    }
    toast(`已套用「${rec.title}」，参数可继续修改`);
  }

  const runGenerate = useCallback(async () => {
    if (!prompt.trim()) { toast.error('提示词不能为空'); return; }
    setStage('generating');
    setJob(null);
    setJobError(null);
    setGenPhase('排队中');
    setResultUrl(null);
    try {
      const created = await api.generate({
        asset_id: assetId || undefined,
        prompt: prompt.trim(),
        negative_prompt: negative.trim() || undefined,
        model, ratio,
      });
      const deadline = Date.now() + 120_000;
      let terminal: JobResult | null = null;
      while (Date.now() < deadline) {
        setGenPhase('分析画面 → 优化提示词 → 生成中（约 8–20 秒）');
        const j = await api.job(created.job_id);
        if (j.status === 'succeeded' || j.status === 'failed') { terminal = j; break; }
        await sleep(2000);
      }
      if (!terminal) {
        setJobError('生成超时：AI 服务可能繁忙，请重试或稍后再来');
        setStage('ready');
        return;
      }
      setJob(terminal);
      if (terminal.status === 'failed') {
        setJobError(terminal.error?.message || '生成失败，请重试');
        setStage('ready');
        return;
      }
      if (terminal.result) {
        const blob = await fetchAssetBlob(terminal.result.url);
        resultBlobRef.current = blob;
        setResultUrl(URL.createObjectURL(blob));
        if (terminal.result.mock) toast.warning('演示模式：AI 服务繁忙，本次为占位示意图');
      }
      setStage('result');
    } catch (e) {
      setJobError(errText(e));
      setStage('ready');
    }
  }, [assetId, prompt, negative, model, ratio]);

  async function downloadResult() {
    const blob = resultBlobRef.current;
    if (!blob) return;
    try {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.drawImage(bmp, 0, 0);
      const label = 'AI 生成 · 图派 TuPai';
      const fs = Math.max(14, Math.round(bmp.width / 32));
      ctx.font = `${fs}px sans-serif`;
      const w = ctx.measureText(label).width + fs * 1.2;
      const h = fs * 2;
      const x = bmp.width - w - fs;
      const y = bmp.height - h - fs;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, fs / 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + fs * 0.6, y + h / 2);
      const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (out) downloadBlob(out, `tupai-ai-${Date.now()}.png`);
      toast.success('已下载（含 AI 生成标识）');
    } catch {
      downloadBlob(blob, `tupai-ai-${Date.now()}.png`);
      toast('已下载原结果图');
    }
  }

  async function saveSkill() {
    if (!skillTitle.trim()) { toast.error('请给配方起个名字'); return; }
    setBusy(true);
    try {
      const skill: TupaiSkill = {
        format: 'tupai-skill', version: 1,
        title: skillTitle.trim(),
        prompt: prompt.trim(),
        negative_prompt: negative.trim() || undefined,
        model,
        params: { aspect: ratio, size: '1K' },
        notes: skillNotes.trim() || undefined,
        style_tags: optimize?.candidates?.[0]?.style_tags,
        created_at: new Date().toISOString(),
      };
      const r = await api.saveSkill(skill);
      setSavedSkill(r.skill_id);
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
      setPrompt(s.prompt);
      setNegative(s.negative_prompt || '');
      if (s.model) setModel(s.model);
      if (s.params?.aspect && RATIOS.includes(s.params.aspect)) setRatio(s.params.aspect);
      setOptimize({ candidates: [], recommendations: [], mode: assetId ? 'img2img' : 'txt2img' });
      setStage('ready');
      setSkillTitle(s.title || '');
      toast.success(`配方「${s.title}」已导入，上传自己的底图即可生成`);
    } catch (e) {
      toast.error(e instanceof ApiRequestError ? e.message : '导入失败：不是合法的 tupai-skill JSON');
    }
  }

  const mode = assetId ? 'img2img' : 'txt2img';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">创作台</h1>
        <Badge variant="secondary">{assetId || (tab === 'image' && file) ? '图生图 · 有底图' : '文生图 · 纯文字'}</Badge>
        {optimize?.mock && <Badge variant="outline">演示候选</Badge>}
        <div className="ml-auto flex gap-2">
          <input ref={importRef} type="file" accept=".json,application/json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importSkillFile(f); e.target.value = ''; }} />
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>导入 Skills 配方</Button>
          {stage !== 'entry' && (
            <Button variant="ghost" size="sm" onClick={() => { setStage('entry'); setOptimize(null); setJob(null); setJobError(null); }}>
              重新开始
            </Button>
          )}
        </div>
      </div>

      {stage === 'entry' && (
        <Card className="p-5">
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'image' | 'text')}>
            <TabsList>
              <TabsTrigger value="image">上传图片</TabsTrigger>
              <TabsTrigger value="text">输入文字</TabsTrigger>
            </TabsList>
          </Tabs>
          {tab === 'image' ? (
            <div className="mt-4">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                onChange={(e) => { pickFile(e.target.files?.[0] || null); e.target.value = ''; }} />
              {!preview ? (
                <button
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f); }}
                  className="flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/40 p-6 text-sm text-muted-foreground hover:border-primary/50"
                >
                  <span className="text-3xl">📷</span>
                  点击选择或拖拽图片到此处
                  <span className="text-xs">JPG / PNG / WebP · ≤15MB · 原图全程私密，仅本会话可见</span>
                </button>
              ) : (
                <div className="flex flex-wrap items-start gap-4">
                  <img src={preview} alt="原图预览" className="max-h-56 rounded-lg border border-border object-contain" />
                  <div className="flex flex-col gap-2">
                    <Button variant="outline" size="sm" onClick={() => pickFile(null)}>清除重选</Button>
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
              <p className="mt-2 text-xs text-muted-foreground">纯文字入口走文生图；之后也可以再补底图。</p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={busy} onClick={startOptimize}>自动优化提示词</Button>
            <span className="text-xs text-muted-foreground">不会写提示词没关系：系统产出 2–4 条候选 + 相似模板推荐</span>
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
          <div className="space-y-4">
            {optimize && optimize.candidates.length > 0 && (
              <section aria-label="候选提示词">
                <h2 className="mb-2 text-sm font-semibold">候选提示词 · 点选后可在右侧编辑</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {optimize.candidates.map((c, i) => (
                    <Card key={i} className={`cursor-pointer p-3 text-xs transition-colors hover:border-primary/60 ${prompt === c.prompt ? 'border-primary ring-1 ring-primary/40' : ''}`}>
                      <button className="w-full text-left" onClick={() => applyCandidate(c)}>
                        <div className="mb-1 flex flex-wrap gap-1">
                          {(c.style_tags || []).slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                        </div>
                        <p className="line-clamp-5 text-muted-foreground">{c.prompt}</p>
                      </button>
                    </Card>
                  ))}
                </div>
              </section>
            )}
            {optimize && optimize.recommendations.length > 0 && (
              <section aria-label="相似推荐">
                <h2 className="mb-2 text-sm font-semibold">相似模板 / Skills · 一键同款</h2>
                <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                  {optimize.recommendations.map((rec) => (
                    <Card key={rec.type + rec.id} className="w-40 shrink-0 overflow-hidden p-0">
                      <div className="aspect-[3/4] w-full bg-secondary">
                        {rec.cover_url
                          ? <AssetImage path={rec.cover_url} alt={`${rec.title} 预览`} className="size-full object-cover" isPublic />
                          : <div className="grid size-full place-items-center text-xs text-muted-foreground">Skills 配方</div>}
                      </div>
                      <div className="p-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate text-xs font-semibold">{rec.title}</span>
                          <span className="text-[10px] text-primary">{Math.round(rec.score * 100)}%</span>
                        </div>
                        <Button size="sm" variant="outline" className="mt-1.5 h-7 w-full text-xs" onClick={() => applyRecommendation(rec)}>一键同款</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}
            {preview && (
              <section>
                <h2 className="mb-2 text-sm font-semibold">底图（私密）</h2>
                <img src={preview} alt="底图预览" className="max-h-48 rounded-lg border border-border object-contain" />
              </section>
            )}
            {jobError && (
              <Card className="border-destructive/40 bg-destructive/5 p-4 text-sm">
                {jobError}
                <Button variant="link" size="sm" onClick={runGenerate}>重试</Button>
              </Card>
            )}
          </div>

          <Card className="h-fit p-4 lg:sticky lg:top-20">
            <h2 className="text-sm font-semibold">提示词与参数</h2>
            <Label className="mt-3 text-xs" htmlFor="prompt">正向提示词（{prompt.length}/4000）</Label>
            <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value.slice(0, 4000))} rows={8} className="mt-1 text-xs" />
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
              </div>
              <div>
                <Label className="text-xs" htmlFor="ratio">画幅</Label>
                <NativeSelect id="ratio" value={ratio} onChange={(e) => setRatio(e.target.value)} className="mt-1 w-full">
                  {RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </NativeSelect>
              </div>
            </div>
            <Button className="mt-4 w-full" size="lg" disabled={stage === 'generating'} onClick={runGenerate}>
              {stage === 'generating' ? '生成中…' : '生成作品'}
            </Button>
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
                <p className="text-xs text-muted-foreground">JSON 可在图派「导入 Skills 配方」回填；SKILL.md 可装入 Qoder 等 Agent 工具，形成「作品 → 配方 → 技能」。</p>
              </div>
            )}
          </div>
          <DialogFooter />
        </DialogContent>
      </Dialog>
    </div>
  );
}