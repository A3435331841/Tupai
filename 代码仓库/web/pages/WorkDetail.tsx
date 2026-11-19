import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl, loginUrl, ApiRequestError } from '@/lib/api';
import type { WorkComment, WorkMeta } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const needLogin = (e: unknown) => {
  if (e instanceof ApiRequestError && e.status === 401) { toast.error('请先登录'); window.location.href = loginUrl(); return true; }
  return false;
};

/** 单作品独立页：可收藏、可分享、刷新不丢，是社区作品的稳定入口。 */
export default function WorkDetail({ id, navigate }: { id: string; navigate: (to: string) => void }) {
  const [work, setWork] = useState<WorkMeta | null>(null);
  const [error, setError] = useState<'notfound' | 'failed' | null>(null);
  const [comments, setComments] = useState<WorkComment[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editFork, setEditFork] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');

  const load = useCallback(async () => {
    setWork(null); setError(null); setComments([]); setHasMore(false); setNextOffset(0);
    try {
      const r = await api.work(id);
      setWork(r.work);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.status === 404 ? 'notfound' : 'failed');
      return; // 作品主体不可见时不必再拉评论，避免无意义的 404 请求
    }
    try {
      const r = await api.comments(id, { limit: 50 });
      setComments(r.comments); setHasMore(r.has_more); setNextOffset(r.next_offset);
    } catch { /* 评论加载失败不影响作品主体展示 */ }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function doLike() {
    if (!work) return;
    try {
      const r = await api.like(work.id);
      setWork({ ...work, liked: r.liked, like_count: r.like_count });
      toast.success(r.liked ? '已点赞' : '已取消点赞');
    } catch (e) { if (!needLogin(e)) toast.error('操作失败'); }
  }

  async function addComment() {
    if (!work || !text.trim()) return;
    try {
      const r = await api.addComment(work.id, text.trim());
      setComments((old) => [...old, r.comment]);
      setText('');
      setWork({ ...work, comment_count: (work.comment_count || 0) + 1 });
    } catch (e) { if (!needLogin(e)) toast.error(e instanceof Error ? e.message : '评论失败'); }
  }

  async function loadMore() {
    try {
      const r = await api.comments(id, { limit: 50, offset: nextOffset });
      setComments((old) => [...old, ...r.comments]);
      setHasMore(r.has_more); setNextOffset(r.next_offset);
    } catch { toast.error('加载更多失败'); }
  }

  async function copyLink() {
    const link = `${window.location.origin}/work/${id}/`;
    try { await navigator.clipboard.writeText(link); toast.success('作品链接已复制'); }
    catch { toast.info(`请手动复制：${link}`); }
  }

  async function ownerAction(action: 'withdraw' | 'republish' | 'appeal' | 'delete') {
    if (!work) return;
    if (action === 'delete') { setConfirmDelete(true); return; }
    try {
      if (action === 'withdraw') await api.withdrawWork(work.id);
      if (action === 'republish') await api.republishWork(work.id);
      if (action === 'appeal') await api.appealWork(work.id);
      const r = await api.work(work.id);
      setWork(r.work);
      toast.success('操作成功');
    } catch (e) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  }

  async function doDelete() {
    if (!work) return;
    try {
      await api.deleteWork(work.id);
      toast.success('已删除');
      navigate('/community');
    } catch (e) { toast.error(e instanceof Error ? e.message : '删除失败'); }
  }

  function openEdit() {
    if (!work) return;
    setEditTitle(work.title);
    setEditTags(work.tags.join('，'));
    setEditFork(Boolean(work.allow_fork));
    setEditing(true);
  }

  async function saveEdit() {
    if (!work) return;
    try {
      const tags = editTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
      const r = await api.updateWork(work.id, { title: editTitle.trim(), tags, allow_fork: editFork });
      setWork(r.work);
      setEditing(false);
      toast.success('作品已更新');
    } catch (e) { toast.error(e instanceof Error ? e.message : '更新失败'); }
  }

  async function submitReport() {
    if (!work || !reportReason.trim()) { toast.error('请填写举报原因'); return; }
    try {
      await api.reportWork(work.id, reportReason.trim());
      toast.success('已举报，感谢反馈');
      setReportOpen(false); setReportReason('');
    } catch (e) { if (!needLogin(e)) toast.error(e instanceof Error ? e.message : '举报失败'); }
  }

  if (error) {
    const notFound = error === 'notfound';
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-20 text-center">
        <p className="font-display text-2xl font-bold">{notFound ? '作品不存在或已撤回' : '加载失败，请稍后重试'}</p>
        <p className="text-sm text-muted-foreground">{notFound ? '作品可能已被作者撤回、删除，或链接有误。' : '网络异常或服务暂不可用，可稍后重试。'}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {!notFound && <Button onClick={() => void load()}>重试</Button>}
          <Button variant={notFound ? 'default' : 'outline'} onClick={() => navigate('/community')}>回到社区</Button>
        </div>
      </div>
    );
  }

  if (!work) {
    return (
      <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-8 sm:grid-cols-[1fr_280px]">
        <Skeleton className="aspect-[3/4] w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-20">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative overflow-hidden rounded-xl border border-border bg-secondary">
          <img src={apiUrl(work.image_url)} alt={work.title} className="w-full object-contain" />
          <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-1 text-[11px] text-white">AI 生成</span>
        </div>
        <div className="space-y-4">
          <div>
            <h1 className="font-display text-2xl font-bold">{work.title}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              作者 {work.author_credit || '匿名'} · {new Date(work.created_at).toLocaleDateString('zh-CN')}
              {work.depth > 0 && <> · fork {work.depth} 层</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-1">{work.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={work.liked ? 'secondary' : 'outline'} onClick={() => void doLike()}>
              ♥ {work.liked ? '已赞' : '点赞'} {work.like_count ?? 0}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void copyLink()}>复制链接</Button>
            {work.allow_fork && <Button size="sm" onClick={() => navigate(`/studio?fork=${work.id}`)}>做同款</Button>}
            <Button size="sm" variant="ghost" onClick={() => setReportOpen(true)}>举报</Button>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>♥ {work.like_count ?? 0}</span>
            <span>💬 {work.comment_count ?? 0}</span>
            <span>⑂ {work.fork_count ?? 0}</span>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">查看配方（prompt / 模型 / 画幅）</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{`${work.skill_snapshot?.prompt || ''}\n模型 ${work.skill_snapshot?.model || ''} · 画幅 ${work.skill_snapshot?.ratio || ''}`}</pre>
          </details>
          {work.is_owner && (
            <div className="flex flex-wrap gap-1 border-t border-border pt-3">
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openEdit}>编辑</Button>
              {work.status === 'published' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction('withdraw')}>撤回</Button>}
              {work.status === 'withdrawn' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction('republish')}>重新发布</Button>}
              {work.status === 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction('appeal')}>申诉</Button>}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void ownerAction('delete')}>删除</Button>
            </div>
          )}
        </div>
      </div>

      <Card className="mt-6 p-4">
        <p className="mb-3 text-sm font-semibold">评论（{work.comment_count ?? comments.length}）</p>
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="text-sm">
              <p className="text-xs text-muted-foreground">{c.author_name || '社区用户'} · {new Date(c.created_at).toLocaleString('zh-CN')}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          {comments.length === 0 && <p className="text-xs text-muted-foreground">还没有评论，来抢沙发。</p>}
          {hasMore && <Button size="sm" variant="outline" onClick={() => void loadMore()}>加载更多评论</Button>}
        </div>
        <div className="mt-4 flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="说点什么…" className="h-9" onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }} />
          <Button size="sm" onClick={() => void addComment()}>发送</Button>
        </div>
      </Card>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除作品？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">作品将从社区下架，原图与结果仍保留在资产库。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>取消</Button>
            <Button variant="destructive" onClick={() => void doDelete()}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>编辑作品</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <label className="block text-xs text-muted-foreground">标题
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="mt-1 h-9" maxLength={100} />
            </label>
            <label className="block text-xs text-muted-foreground">标签（逗号分隔，最多 12 个）
              <Input value={editTags} onChange={(e) => setEditTags(e.target.value)} className="mt-1 h-9" />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={editFork} onChange={(e) => setEditFork(e.target.checked)} />
              允许别人 fork 这套配方
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(false)}>取消</Button>
            <Button onClick={() => void saveEdit()} disabled={!editTitle.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reportOpen} onOpenChange={(v) => { setReportOpen(v); if (!v) setReportReason(''); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>举报作品</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">请简要说明原因（色情、侵权、暴力等），管理员会复核。</p>
          <Textarea aria-label="举报原因" value={reportReason} onChange={(e) => setReportReason(e.target.value)} maxLength={300} className="min-h-24" placeholder="举报原因…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReportOpen(false); setReportReason(''); }}>取消</Button>
            <Button onClick={() => void submitReport()} disabled={!reportReason.trim()}>提交举报</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
