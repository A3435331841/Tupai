import { useCallback, useEffect, useState } from 'react';
import { api, fetchAssetBlob, downloadBlob } from '@/lib/api';
import type { AssetMeta, AssetSummary, SkillRecord } from '@/lib/types';
import { AssetImage } from '@/components/AssetImage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlbumsPanel } from '@/components/AlbumsPanel';
import { PageHero } from '@/components/PageHero';
import { SkillQuickCard } from '@/components/SkillQuickCard';
import { toast } from 'sonner';

const KIND_LABEL: Record<string, string> = { original: '原图', result: '作品', reference: '参考' };
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
// only_deleted 由后端约定新增，api.ts 签名尚未同步时用本地类型兜底
type AssetQuery = NonNullable<Parameters<typeof api.assets>[0]> & { only_deleted?: boolean };

export default function Library({ navigate }: { navigate: (to: string) => void }) {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [bin, setBin] = useState(false);
  const [items, setItems] = useState<AssetMeta[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AssetSummary>({});
  const [mode, setMode] = useState<'assets' | 'albums'>('assets');
  const [skills, setSkills] = useState<SkillRecord[] | null>(null);
  const [albumCount, setAlbumCount] = useState(0);
  const [preview, setPreview] = useState<AssetMeta | null>(null);
  const [tagTarget, setTagTarget] = useState<AssetMeta | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AssetMeta | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<AssetMeta | null>(null);

  const load = useCallback(async (reset: boolean, opts?: { limit?: number }) => {
    setBusy(true);
    if (reset) setError(null);
    try {
      const r = await api.assets({
        kind: kind || undefined,
        q: q || undefined,
        only_deleted: bin,
        limit: opts?.limit ?? 24,
        offset: reset ? 0 : (offset ?? 0),
      } as AssetQuery);
      setItems((old) => reset || !old ? r.assets : [...old, ...r.assets]);
      setTotal(r.total);
      setSummary(r.summary || {});
      setOffset(r.next_offset);
    } catch (e) {
      // 加载更多失败只提示，保留已加载列表；只有首屏 reset 失败才替换整块内容
      if (reset) { setError(errText(e, '加载失败，请稍后重试')); setItems([]); }
      else toast.error('加载更多失败，请稍后重试');
    } finally { setBusy(false); }
  }, [kind, q, bin, offset]);

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, [kind, bin]);

  // 侧栏数据：复用已有 API，失败静默降级不影响主资产列表
  const loadAlbumCount = useCallback(() => {
    void api.albums().then((r) => setAlbumCount(r.albums.length)).catch(() => {});
  }, []);
  useEffect(() => {
    void api.skills().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
    loadAlbumCount();
  }, [loadAlbumCount]);

  async function search() { setOffset(0); await load(true); }
  // 删除/恢复后保持滚动位置，避免列表重排把用户甩回顶部；按已加载条数重取，避免列表骤缩
  async function refreshKeepScroll() {
    const y = window.scrollY;
    const limit = Math.min(60, Math.max(24, items?.length ?? 24));
    await load(true, { limit });
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  async function doDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteAsset(deleteTarget.id);
      toast.success('已移入回收站');
      setDeleteTarget(null);
      void refreshKeepScroll();
    } catch (e) { toast.error(errText(e, '删除失败')); }
  }
  async function doPurge() {
    if (!purgeTarget) return;
    try {
      await api.purgeAsset(purgeTarget.id);
      toast.success('已彻底删除');
      setPurgeTarget(null);
      void refreshKeepScroll();
    } catch (e) { toast.error(errText(e, '彻底删除失败')); }
  }
  async function restore(a: AssetMeta) {
    try { await api.restoreAsset(a.id); toast.success('已恢复'); void refreshKeepScroll(); }
    catch (e) { toast.error(errText(e, '恢复失败')); }
  }
  function openTags(a: AssetMeta) {
    setTagTarget(a);
    setTagInput(a.tags.join('，'));
  }
  async function saveTags() {
    if (!tagTarget) return;
    const tags = tagInput.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
    try {
      await api.updateAssetTags(tagTarget.id, tags);
      toast.success('标签已更新');
      setTagTarget(null);
      void refreshKeepScroll();
    } catch (e) { toast.error(errText(e, '打标失败')); }
  }
  // AI 结果图下载前用 canvas 合成「AI 生成 · 图派 TuPai」角标（与创作台同一合规口径），原图/参考图不受影响
  async function composeAiMark(blob: Blob): Promise<Blob> {
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
      return out;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function download(a: AssetMeta) {
    try {
      const blob = await fetchAssetBlob(a.content_url);
      if (a.ai_generated) {
        const marked = await composeAiMark(blob);
        downloadBlob(marked, `tupai-${a.kind}-${a.id.slice(-6)}-ai.png`);
        toast.success('已下载（含 AI 生成标识）');
        return;
      }
      downloadBlob(blob, `tupai-${a.kind}-${a.id.slice(-6)}.${(a.content_type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`);
    } catch { toast.error('下载失败，请稍后重试'); }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <PageHero
        kicker="原图私密 · 结果可分享 · 配方可带走"
        title="我的影像档案"
        description="每一次出片与配方都归档在这里，可检索、可复用、可成册。"
        aside={(
          <>
            <Button size="sm" variant={mode === 'assets' ? 'secondary' : 'ghost'} onClick={() => setMode('assets')}>资产</Button>
            <Button size="sm" variant={mode === 'albums' ? 'secondary' : 'ghost'} onClick={() => setMode('albums')}>画册</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>去创作</Button>
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span><b className="font-display text-base text-primary">{summary.result ?? 0}</b> 件作品</span>
          <span><b className="font-display text-base text-primary">{summary.original ?? 0}</b> 张原图</span>
          <span><b className="font-display text-base text-primary">{summary.reference ?? 0}</b> 张参考</span>
          <span><b className="font-display text-base text-primary">{skills?.length ?? '—'}</b> 套配方</span>
          <span><b className="font-display text-base text-primary">{albumCount}</b> 本画册</span>
          <span className="ml-auto">原图仅自己可见 · 登录后可跨设备</span>
        </div>
      </PageHero>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          {mode === 'albums' && <AlbumsPanel onChanged={loadAlbumCount} />}
          {mode === 'assets' && (<>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {[['', '全部'], ['original', '原图'], ['result', '作品']].map(([v, label]) => (
                <Button key={v} size="sm" variant={kind === v ? 'secondary' : 'ghost'} onClick={() => setKind(v)}>{label}</Button>
              ))}
              <Button size="sm" variant={bin ? 'secondary' : 'ghost'} onClick={() => setBin((b) => !b)}>回收站</Button>
              <div className="ml-auto flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder="搜标签 / 来源…" aria-label="搜索资产" className="h-9 w-44" />
                <Button size="sm" variant="outline" onClick={() => void search()}>搜索</Button>
              </div>
            </div>

            {error ? (
              <Card role="alert" className="flex flex-col items-center gap-2 border-destructive/40 p-10 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void load(true)}>重试</Button>
              </Card>
            ) : items === null ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />)}
              </div>
            ) : items.length === 0 ? (
              <div>
                {bin ? (
                  <Card className="p-10 text-center text-sm text-muted-foreground">回收站是空的。</Card>
                ) : (
                  <>
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-sm text-muted-foreground">还没有资产 · 先看看作品能长什么样</p>
                      <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate('/studio')}>去创作</Button>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        ['/gallery/g09-street.jpg', '雨夜之后', '11.16', '夜景·胶片'],
                        ['/templates/travel-postcard.webp', '金色旅途', '11.14', '旅行·胶片'],
                        ['/gallery/g06-coffee.jpg', '咖啡午后', '11.13', '人像·胶片'],
                        ['/gallery/g19-street.png', '霓虹漫步', '11.12', '夜景·胶片'],
                        ['/templates/magazine-cover.webp', '黑白之间', '11.10', '人像·黑白'],
                        ['/templates/clean-portrait.webp', '静室肖像', '11.09', '人像·胶片'],
                        ['/gallery/g07-food.jpg', '餐桌日记', '11.08', '静物·胶片'],
                        ['/gallery/g12-beach.jpg', '海边来信', '11.06', '旅行·胶片'],
                        ['/gallery/g20-flowers.png', '花影', '11.05', '静物·胶片'],
                      ].map(([src, title, date, tagName]) => (
                        <div key={title} className="overflow-hidden rounded-xl border border-border/70 bg-card">
                          <div className="relative aspect-[3/4] bg-secondary">
                            <img src={src} alt={`${title}（示例）`} className="size-full object-cover" />
                            <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white">示例</span>
                            <Button size="sm" variant="secondary" className="absolute right-2 top-2 h-6 px-2 text-[10px]" onClick={() => navigate('/studio')}>↻ 再创作</Button>
                          </div>
                          <div className="p-2">
                            <p className="truncate text-xs font-medium">{title}</p>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">{date} · {tagName}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
                  {items.map((a) => (
                    <Card key={a.id} className="gap-0 overflow-hidden p-0">
                      <button type="button" className="relative block aspect-[3/4] w-full bg-secondary" disabled={Boolean(a.deleted_at)} onClick={() => setPreview(a)} aria-label={`预览 ${KIND_LABEL[a.kind] || a.kind}`}>
                        {a.deleted_at
                          ? <span className="grid size-full place-items-center bg-secondary text-xs text-muted-foreground">已移入回收站</span>
                          : <AssetImage path={a.content_url} alt={`${KIND_LABEL[a.kind] || a.kind} ${a.id}`} className="size-full object-cover" />}
                        <Badge variant="secondary" className="absolute left-2 top-2 text-[10px]">{KIND_LABEL[a.kind] || a.kind}</Badge>
                        {a.ai_generated && <span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white">AI 生成</span>}
                        {a.deleted_at && <Badge variant="outline" className="absolute right-2 top-2 bg-background/80 text-[10px]">已删除</Badge>}
                      </button>
                      <div className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {a.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                          {a.tags.length === 0 && <span className="text-[10px] text-muted-foreground">无标签</span>}
                        </div>
                        <p className="mt-1 text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString('zh-CN')} · {a.width}×{a.height}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {!bin && !a.deleted_at && <Button size="sm" variant="outline" className="h-9 flex-1 text-xs sm:h-7" onClick={() => navigate(`/studio?asset=${a.id}`)}>再创作</Button>}
                          {!bin && !a.deleted_at && <Button size="sm" variant="ghost" className="h-9 text-xs sm:h-7" onClick={() => openTags(a)}>打标</Button>}
                          {a.deleted_at
                            ? <>
                              <Button size="sm" variant="outline" className="h-9 flex-1 text-xs sm:h-7" onClick={() => void restore(a)}>恢复</Button>
                              <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive sm:h-7" onClick={() => setPurgeTarget(a)}>彻底删除</Button>
                            </>
                            : <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive sm:h-7" onClick={() => setDeleteTarget(a)}>删除</Button>}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
                {offset !== null && (
                  <div className="mt-4 text-center">
                    <Button variant="outline" disabled={busy} onClick={() => void load(false)}>{busy ? '加载中…' : '加载更多'}</Button>
                  </div>
                )}
                <p className="mt-3 text-center text-[11px] text-muted-foreground">共 {total} 项 · 原图仅自己可见</p>
              </>
            )}
          </>)}
        </div>

        <aside className="space-y-4">
          {/* 设计稿：翻开的书本画册视觉（置顶） */}
          <div className="site-flow-card overflow-hidden rounded-2xl">
            <div className="flex justify-center bg-gradient-to-b from-secondary/50 to-transparent px-4 pt-5">
              <div className="relative w-full max-w-[260px]">
                <span className="absolute right-2 top-2 z-10 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">示例</span>
                <div className="grid grid-cols-2 overflow-hidden rounded-md border-4 border-[#8a5a3b] shadow-lg" style={{ boxShadow: '0 8px 24px -8px rgba(60,40,20,.5), inset 0 0 0 2px rgba(255,255,255,.2)' }}>
                  <div className="aspect-[3/4] bg-cover bg-center" style={{ backgroundImage: "url('/gallery/g09-street.jpg')" }} />
                  <div className="aspect-[3/4] bg-cover bg-center" style={{ backgroundImage: "url('/gallery/g13-city.jpg')" }} />
                </div>
                <div className="mx-auto mt-0 h-3 w-16 rounded-b-lg bg-[#7a4a2f]" />
              </div>
            </div>
            <div className="p-4 text-center">
              <p className="font-display text-sm font-bold text-foreground">十一月 · 小城夜游</p>
              <p className="mt-1 text-[11px] text-muted-foreground">把结果图做成可翻页的相册，原图永不入册</p>
              <Button size="sm" className="mt-3 w-full bg-primary text-xs text-primary-foreground hover:bg-primary/90" onClick={() => setMode('albums')}>打开画册 →</Button>
            </div>
          </div>
          <SkillQuickCard
            skills={skills ?? []}
            loading={skills === null}
            onError={(e) => toast.error(errText(e, '导出失败'))}
            onChanged={() => { void api.skills().then((r) => setSkills(r.skills)).catch(() => {}); }}
          />
        </aside>
      </div>

      {/* 单资产预览 + 下载 */}
      <Dialog open={Boolean(preview)} onOpenChange={(v) => { if (!v) setPreview(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          {preview && (
            <>
              <DialogHeader><DialogTitle>{KIND_LABEL[preview.kind] || preview.kind} · {new Date(preview.created_at).toLocaleString('zh-CN')}</DialogTitle></DialogHeader>
              <div className="relative overflow-hidden rounded-lg border border-border">
                <AssetImage path={preview.content_url} alt="资产预览" className="w-full object-contain" />
                {preview.ai_generated && <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white">AI 生成</span>}
              </div>
              <div className="flex flex-wrap gap-1">{preview.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
              <p className="text-xs text-muted-foreground">{preview.width}×{preview.height} · {(preview.bytes / 1024).toFixed(0)} KB · {preview.content_type}</p>
              <DialogFooter>
                <Button variant="outline" onClick={() => void download(preview)}>{preview.ai_generated ? '下载成品（含 AI 标识）' : '下载原图'}</Button>
                {!preview.deleted_at && <Button onClick={() => { setPreview(null); navigate(`/studio?asset=${preview.id}`); }}>再创作</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 打标 */}
      <Dialog open={Boolean(tagTarget)} onOpenChange={(v) => { if (!v) setTagTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>编辑标签</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">用逗号分隔，最多 12 个，便于检索与再创作。</p>
          <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="夜景，胶片，街拍" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagTarget(null)}>取消</Button>
            <Button onClick={() => void saveTags()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移入回收站 */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>移入回收站？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">「{deleteTarget ? KIND_LABEL[deleteTarget.kind] || deleteTarget.kind : ''}」将在回收站保留，可随时恢复。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void doDelete()}>移入回收站</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 彻底删除 */}
      <Dialog open={Boolean(purgeTarget)} onOpenChange={(v) => { if (!v) setPurgeTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>彻底删除？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">删除后无法恢复，存储中的图片也会一并清理。已发布作品需先删除作品。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void doPurge()}>彻底删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
