import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl } from '@/lib/api';
import type { AlbumMeta, AssetMeta } from '@/lib/types';
import { AssetImage } from '@/components/AssetImage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

export function AlbumsPanel() {
  const [albums, setAlbums] = useState<AlbumMeta[] | null>(null);
  const [results, setResults] = useState<AssetMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api.albums(), api.assets({ kind: 'result', limit: 60 })]);
      setAlbums(a.albums);
      setResults(r.assets);
    } catch (e) { toast.error(e instanceof Error ? e.message : '加载失败'); setAlbums([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    setSelected((old) => { const n = new Set(old); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function create() {
    if (!title.trim()) { toast.error('请给画册起个名字'); return; }
    if (selected.size === 0) { toast.error('请至少选择一张作品'); return; }
    setBusy(true);
    try {
      await api.createAlbum(title.trim(), [...selected]);
      toast.success('画册已创建');
      setCreating(false); setTitle(''); setSelected(new Set());
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '创建失败'); }
    finally { setBusy(false); }
  }

  async function share(a: AlbumMeta) {
    try {
      const r = await api.shareAlbum(a.id);
      const link = window.location.origin + apiUrl(r.share_page);
      await navigator.clipboard.writeText(link).catch(() => {});
      toast.success('只读分享链接已复制（含有效期，可撤回）');
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : '分享失败'); }
  }
  async function revoke(a: AlbumMeta) {
    try { await api.revokeAlbumShare(a.id); toast.success('已撤回分享'); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '撤回失败'); }
  }
  async function remove(a: AlbumMeta) {
    if (!window.confirm(`删除画册「${a.title}」？作品本身仍在资产库。`)) return;
    try { await api.deleteAlbum(a.id); toast.success('画册已删除'); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
  }
  function view(a: AlbumMeta) {
    if (!a.share_token) { toast.error('请先分享生成链接'); return; }
    window.open(apiUrl(`/api/v1/share/${a.share_token}/page`), '_blank');
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={creating ? 'secondary' : 'outline'} onClick={() => setCreating((c) => !c)}>
          {creating ? '取消创建' : '创建画册'}
        </Button>
        <span className="text-xs text-muted-foreground">把生成作品选进画册，生成只读翻页链接发给朋友（原图不参与）。</span>
      </div>

      {creating && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="画册名称，如「我的夜景集」" className="h-9 w-56" />
            <Badge variant="secondary">已选 {selected.size}</Badge>
            <Button size="sm" disabled={busy || selected.size === 0} onClick={() => void create()}>{busy ? '创建中…' : '建册'}</Button>
          </div>
          {results.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">还没有生成作品。先去创作台生成几张。</p>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {results.map((a) => (
                <button key={a.id} onClick={() => toggle(a.id)} className={`relative aspect-[3/4] overflow-hidden rounded-lg border-2 ${selected.has(a.id) ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}>
                  <AssetImage path={a.content_url} alt="作品" className="size-full object-cover" />
                  {selected.has(a.id) && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">✓</span>}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {albums === null ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}</div>
      ) : albums.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">还没有画册。点「创建画册」把作品成册分享。</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {albums.map((a) => (
            <Card key={a.id} className="overflow-hidden p-0">
              <div className="flex gap-3 p-3">
                <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-secondary">
                  {a.cover_asset_id && <AssetImage path={`/api/v1/assets/${a.cover_asset_id}/content`} alt={a.title} className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.item_ids.length} 张作品 · {new Date(a.created_at).toLocaleDateString('zh-CN')}</p>
                  <div className="mt-1">
                    {a.share_token
                      ? <Badge variant="secondary" className="text-[10px]">已分享 · {a.share_expires_at ? new Date(a.share_expires_at).toLocaleDateString('zh-CN') + ' 到期' : '长期'}</Badge>
                      : <Badge variant="outline" className="text-[10px]">私有</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-border p-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => view(a)}>查看</Button>
                {a.share_token
                  ? <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void revoke(a)}>撤回</Button>
                  : <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void share(a)}>分享</Button>}
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void remove(a)}>删除</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}