import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { AssetMeta } from '@/lib/types';
import { AssetImage } from '@/components/AssetImage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { AlbumsPanel } from '@/components/AlbumsPanel';
import { PageHero } from '@/components/PageHero';
import { SkillQuickCard } from '@/components/SkillQuickCard';
import type { SkillRecord } from '@/lib/types';
import { toast } from 'sonner';

const KIND_LABEL: Record<string, string> = { original: '原图', result: '作品', reference: '参考' };

export default function Library({ navigate }: { navigate: (to: string) => void }) {
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [bin, setBin] = useState(false);
  const [items, setItems] = useState<AssetMeta[] | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'assets' | 'albums'>('assets');
  const [skills, setSkills] = useState<SkillRecord[] | null>(null);
  const [albumCount, setAlbumCount] = useState(0);

  const load = useCallback(async (reset: boolean) => {
    setBusy(true);
    try {
      const r = await api.assets({ kind: kind || undefined, q: q || undefined, include_deleted: bin, limit: 24, offset: reset ? 0 : (offset ?? 0) });
      setItems((old) => reset || !old ? r.assets : [...old, ...r.assets]);
      setTotal(r.total);
      setOffset(r.next_offset);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败');
      if (reset) setItems([]);
    } finally { setBusy(false); }
  }, [kind, q, bin, offset]);

  useEffect(() => { void load(true); /* eslint-disable-next-line */ }, [kind, bin]);

  // 侧栏数据：复用已有 API，失败静默降级不影响主资产列表
  useEffect(() => {
    void api.skills().then((r) => setSkills(r.skills)).catch(() => setSkills([]));
    void api.albums().then((r) => setAlbumCount(r.albums.length)).catch(() => setAlbumCount(0));
  }, []);

  async function search() { setOffset(0); await load(true); }

  async function remove(a: AssetMeta) {
    if (!window.confirm(`把「${KIND_LABEL[a.kind] || a.kind}」移入回收站？宽限期内可恢复。`)) return;
    try { await api.deleteAsset(a.id); toast.success('已移入回收站'); void load(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
  }
  async function restore(a: AssetMeta) {
    try { await api.restoreAsset(a.id); toast.success('已恢复'); void load(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : '恢复失败'); }
  }
  async function editTags(a: AssetMeta) {
    const input = window.prompt('标签（逗号分隔，最多 12 个）', a.tags.join(','));
    if (input === null) return;
    const tags = input.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
    try { await api.updateAssetTags(a.id, tags); toast.success('标签已更新'); void load(true); }
    catch (e) { toast.error(e instanceof Error ? e.message : '打标失败'); }
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
          <span><b className="font-display text-base text-primary">{total}</b> 件作品</span>
          <span><b className="font-display text-base text-primary">{skills?.length ?? '—'}</b> 套配方</span>
          <span><b className="font-display text-base text-primary">{albumCount}</b> 本画册</span>
          <span className="ml-auto">原图仅自己可见 · 登录后可跨设备</span>
        </div>
      </PageHero>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0">
      {mode === 'albums' && <AlbumsPanel />}
      {mode === 'assets' && (<>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[['', '全部'], ['original', '原图'], ['result', '作品']].map(([v, label]) => (
          <Button key={v} size="sm" variant={kind === v ? 'secondary' : 'ghost'} onClick={() => setKind(v)}>{label}</Button>
        ))}
        <Button size="sm" variant={bin ? 'secondary' : 'ghost'} onClick={() => setBin((b) => !b)}>回收站</Button>
        <div className="ml-auto flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search(); }} placeholder="搜标签 / 来源…" className="h-9 w-44" />
          <Button size="sm" variant="outline" onClick={() => void search()}>搜索</Button>
        </div>
      </div>

      {items === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
                ].map(([src, title, date, tag]) => (
                  <div key={title} className="overflow-hidden rounded-xl border border-border/70 bg-card">
                    <div className="relative aspect-[3/4] bg-secondary">
                      <img src={src} alt={`${title}（示例）`} className="size-full object-cover" />
                      <span className="absolute left-2 top-2 rounded bg-black/50 px-1.5 py-0.5 text-[9px] text-white">示例</span>
                      <Button size="sm" variant="secondary" className="absolute right-2 top-2 h-6 px-2 text-[10px]" onClick={() => navigate('/studio')}>↻ 再创作</Button>
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium">{title}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">{date} · {tag}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((a) => (
              <Card key={a.id} className="overflow-hidden p-0">
                <div className="relative aspect-[3/4] w-full bg-secondary">
                  <AssetImage path={a.content_url} alt={`${KIND_LABEL[a.kind] || a.kind} ${a.id}`} className="size-full object-cover" />
                  <Badge variant="secondary" className="absolute left-2 top-2 text-[10px]">{KIND_LABEL[a.kind] || a.kind}</Badge>
                  {a.deleted_at && <Badge variant="outline" className="absolute right-2 top-2 bg-background/80 text-[10px]">已删除</Badge>}
                </div>
                <div className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {a.tags.slice(0, 3).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                    {a.tags.length === 0 && <span className="text-[10px] text-muted-foreground">无标签</span>}
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString('zh-CN')} · {a.width}×{a.height}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {!a.deleted_at && <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => navigate(`/studio?asset=${a.id}`)}>再创作</Button>}
                    {!a.deleted_at && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void editTags(a)}>打标</Button>}
                    {a.deleted_at
                      ? <Button size="sm" variant="outline" className="h-7 flex-1 text-xs" onClick={() => void restore(a)}>恢复</Button>
                      : <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void remove(a)}>删除</Button>}
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
        </>
      )}
      </>)}
      </div>

      <aside className="space-y-4">
        {/* 设计稿：翻开的书本画册视觉（置顶） */}
        <div className="site-flow-card overflow-hidden rounded-2xl">
          <div className="flex justify-center bg-gradient-to-b from-secondary/50 to-transparent px-4 pt-5">
            <div className="relative w-full max-w-[260px]">
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
          onError={(e) => toast.error(e instanceof Error ? e.message : '导出失败')}
        />
      </aside>
      </div>
    </div>
  );
}