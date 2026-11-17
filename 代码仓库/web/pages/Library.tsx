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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">我的资产库</h1>
        <Badge variant="secondary">{total} 项</Badge>
        <span className="text-xs text-muted-foreground">原图全程私密 · 登录后可跨设备</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={mode === 'assets' ? 'secondary' : 'ghost'} onClick={() => setMode('assets')}>资产</Button>
          <Button size="sm" variant={mode === 'albums' ? 'secondary' : 'ghost'} onClick={() => setMode('albums')}>画册</Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/studio')}>去创作</Button>
        </div>
      </div>

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
        <Card className="p-10 text-center text-sm text-muted-foreground">
          {bin ? '回收站是空的。' : '还没有资产。去创作台生成作品，或上传照片，会自动归档到这里。'}
          <div className="mt-4"><Button variant="outline" size="sm" onClick={() => navigate('/studio')}>开始创作</Button></div>
        </Card>
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
  );
}