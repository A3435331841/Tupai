import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl } from '@/lib/api';
import type { AlbumMeta, AssetMeta } from '@/lib/types';
import { AssetImage } from '@/components/AssetImage';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Download } from 'lucide-react';

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);
const shareLink = (token: string) => window.location.origin + apiUrl(`/api/v1/share/${token}/page`);
// share_active 由后端新增；类型尚未同步时按 token + 到期时间兜底判断
const isShareActive = (a: AlbumMeta) => (a as { share_active?: boolean }).share_active
  ?? (Boolean(a.share_token) && (!a.share_expires_at || new Date(a.share_expires_at).getTime() > Date.now()));

export function AlbumsPanel({ onChanged }: { onChanged?: () => void }) {
  const [albums, setAlbums] = useState<AlbumMeta[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [results, setResults] = useState<AssetMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [editing, setEditing] = useState<AlbumMeta | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set());
  // 编辑老画册时，前 60 张结果之外的历史作品（含已进回收站的占位项）
  const [editExtras, setEditExtras] = useState<AssetMeta[]>([]);
  const [editMissing, setEditMissing] = useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<AlbumMeta | null>(null);
  const [shareHours, setShareHours] = useState(168);
  const [deleteTarget, setDeleteTarget] = useState<AlbumMeta | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api.albums(), api.assets({ kind: 'result', limit: 60 })]);
      setAlbums(a.albums);
      setResults(r.assets);
      setLoadError(null);
    } catch (e) {
      // 失败保留 null（骨架/错误卡），不伪装成空画册
      setLoadError(errText(e, '画册加载失败，请稍后重试'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function toggle(id: string) {
    setSelected((old) => { const n = new Set(old); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
      onChanged?.();
    } catch (e) { toast.error(errText(e, '创建失败')); }
    finally { setBusy(false); }
  }

  async function doShare() {
    if (!shareTarget) return;
    try {
      const r = await api.shareAlbum(shareTarget.id, shareHours);
      const link = shareLink(r.share_token);
      try { await navigator.clipboard.writeText(link); toast.success('只读分享链接已复制'); }
      catch { toast.info(`请手动复制链接：${link}`); }
      setShareTarget(null);
      await load();
      onChanged?.();
    } catch (e) { toast.error(errText(e, '分享失败')); }
  }

  async function copyExisting(a: AlbumMeta) {
    if (!a.share_token) return;
    const link = shareLink(a.share_token);
    try { await navigator.clipboard.writeText(link); toast.success('分享链接已复制'); }
    catch { toast.info(`请手动复制链接：${link}`); }
  }

  async function revoke(a: AlbumMeta) {
    try { await api.revokeAlbumShare(a.id); toast.success('已撤回分享'); await load(); onChanged?.(); }
    catch (e) { toast.error(errText(e, '撤回失败')); }
  }

  async function doDelete() {
    if (!deleteTarget) return;
    try { await api.deleteAlbum(deleteTarget.id); toast.success('画册已删除'); setDeleteTarget(null); await load(); onChanged?.(); }
    catch (e) { toast.error(errText(e, '删除失败')); }
  }

  async function exportZip(a: AlbumMeta) {
    if (a.item_ids.length === 0) return;
    setExporting(a.id);
    try {
      const blob = await api.exportAlbumZip(a.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `tupai-album-${a.id.slice(-6)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast.error(errText(e, '导出失败，请稍后重试')); }
    finally { setExporting(null); }
  }

  async function startEdit(a: AlbumMeta) {
    setEditing(a); setEditTitle(a.title); setEditSelected(new Set(a.item_ids));
    setEditExtras([]); setEditMissing([]);
    // 前 60 张结果之外的历史作品逐个补拉；404/已删除的记为占位，默认不勾选
    const known = new Set(results.map((x) => x.id));
    const missingIds = a.item_ids.filter((id) => !known.has(id));
    if (missingIds.length === 0) return;
    const extras: AssetMeta[] = [];
    const gone: string[] = [];
    await Promise.all(missingIds.map(async (id) => {
      try {
        const r = await api.asset(id);
        if (r.asset.deleted_at) gone.push(id); else extras.push(r.asset);
      } catch { gone.push(id); }
    }));
    setEditExtras(extras);
    setEditMissing(gone);
    if (gone.length > 0) {
      setEditSelected((old) => { const n = new Set(old); gone.forEach((id) => n.delete(id)); return n; });
    }
  }
  async function saveEdit() {
    if (!editing) return;
    if (!editTitle.trim()) { toast.error('画册名称不能为空'); return; }
    if (editSelected.size === 0) { toast.error('请至少保留一张作品'); return; }
    setBusy(true);
    try {
      await api.updateAlbum(editing.id, { title: editTitle.trim(), item_ids: [...editSelected] });
      toast.success('画册已更新');
      setEditing(null);
      setEditExtras([]); setEditMissing([]);
      await load();
      onChanged?.();
    } catch (e) { toast.error(errText(e, '更新失败')); }
    finally { setBusy(false); }
  }

  function view(a: AlbumMeta) {
    if (!a.share_token) { toast.error('请先分享生成链接'); return; }
    window.open(shareLink(a.share_token), '_blank');
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
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="选择作品">
              {results.map((a) => (
                <button key={a.id} onClick={() => toggle(a.id)} aria-pressed={selected.has(a.id)} className={`relative aspect-[3/4] overflow-hidden rounded-lg border-2 ${selected.has(a.id) ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}>
                  <AssetImage path={a.content_url} alt="作品" className="size-full object-cover" />
                  {selected.has(a.id) && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">✓</span>}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}

      {loadError ? (
        <Card role="alert" className="flex flex-col items-center gap-3 border-destructive/40 p-8 text-center">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>重试</Button>
        </Card>
      ) : albums === null ? (
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
                  <p className="break-words text-sm font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{a.item_ids.length} 张作品 · {new Date(a.created_at).toLocaleDateString('zh-CN')}</p>
                  <div className="mt-1">
                    {isShareActive(a)
                      ? <Badge variant="secondary" className="text-[10px]">已分享 · {a.share_expires_at ? new Date(a.share_expires_at).toLocaleDateString('zh-CN') + ' 到期' : '长期'}</Badge>
                      : a.share_token
                        ? <Badge variant="outline" className="text-[10px] text-muted-foreground">分享已过期</Badge>
                        : <Badge variant="outline" className="text-[10px]">私有</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-border p-2">
                {isShareActive(a) && <Button size="sm" variant="outline" className="h-9 text-xs sm:h-7" onClick={() => view(a)}>查看</Button>}
                <Button size="sm" variant="ghost" className="h-9 text-xs sm:h-7" onClick={() => startEdit(a)}>编辑</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-9 text-xs sm:h-7"
                  disabled={a.item_ids.length === 0 || exporting === a.id}
                  title={a.item_ids.length === 0 ? '画册暂无作品' : undefined}
                  onClick={() => void exportZip(a)}
                >
                  {exporting === a.id ? '导出中…' : <><Download className="size-3.5" aria-hidden="true" />导出 ZIP</>}
                </Button>
                {isShareActive(a) && <Button size="sm" variant="ghost" className="h-9 text-xs sm:h-7" onClick={() => void copyExisting(a)}>复制链接</Button>}
                {isShareActive(a) && <Button size="sm" variant="ghost" className="h-9 text-xs sm:h-7" onClick={() => void revoke(a)}>撤回</Button>}
                {!isShareActive(a) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 text-xs sm:h-7"
                    disabled={a.item_ids.length === 0}
                    title={a.item_ids.length === 0 ? '画册暂无作品' : undefined}
                    onClick={() => setShareTarget(a)}
                  >{a.share_token ? '重新分享' : '分享'}</Button>
                )}
                <Button size="sm" variant="ghost" className="h-9 text-xs text-destructive sm:h-7" onClick={() => setDeleteTarget(a)}>删除</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 分享有效期 */}
      <Dialog open={Boolean(shareTarget)} onOpenChange={(v) => { if (!v) setShareTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>分享画册「{shareTarget?.title}」</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">分享链接为只读，任何人凭链接可翻页查看；到期自动失效，也可随时撤回。</p>
          <label className="block text-xs text-muted-foreground">有效期
            <select value={shareHours} onChange={(e) => setShareHours(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <option value={24}>1 天</option>
              <option value={168}>7 天</option>
              <option value={720}>30 天</option>
            </select>
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareTarget(null)}>取消</Button>
            <Button onClick={() => void doShare()}>生成并复制链接</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑画册 */}
      <Dialog open={Boolean(editing)} onOpenChange={(v) => { if (!v) { setEditing(null); setEditExtras([]); setEditMissing([]); } }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
          {editing && (
            <>
              <DialogHeader><DialogTitle>编辑画册</DialogTitle></DialogHeader>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="画册名称" maxLength={100} aria-label="画册名称" />
              <p className="text-xs text-muted-foreground">勾选要保留的作品，第一张自动作为封面。</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6" aria-label="选择作品">
                {[...results, ...editExtras.filter((e) => !results.some((r) => r.id === e.id))].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setEditSelected((old) => { const n = new Set(old); if (n.has(a.id)) n.delete(a.id); else n.add(a.id); return n; })}
                    aria-pressed={editSelected.has(a.id)}
                    className={`relative aspect-[3/4] overflow-hidden rounded-lg border-2 ${editSelected.has(a.id) ? 'border-primary ring-2 ring-primary/40' : 'border-border'}`}
                  >
                    <AssetImage path={a.content_url} alt="作品" className="size-full object-cover" />
                    {editSelected.has(a.id) && <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-primary text-xs text-primary-foreground">✓</span>}
                  </button>
                ))}
                {editMissing.map((id) => (
                  <div key={id} className="relative grid aspect-[3/4] place-items-center rounded-lg border-2 border-dashed border-border bg-secondary/60 p-1 text-center text-[10px] leading-tight text-muted-foreground">
                    作品已移入回收站
                  </div>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
                <Button disabled={busy} onClick={() => void saveEdit()}>保存</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除画册？</DialogTitle></DialogHeader>
          <p className="break-words text-sm text-muted-foreground">「{deleteTarget?.title}」将被删除，作品本身仍保留在资产库。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void doDelete()}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
