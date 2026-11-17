import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl, loginUrl, ApiRequestError } from '@/lib/api';
import type { WorkMeta } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';

type Tab = 'feed' | 'tasks' | 'notify' | 'mine';
const needLogin = (e: unknown) => {
  if (e instanceof ApiRequestError && e.status === 401) { toast.error('请先登录'); window.location.href = loginUrl(); return true; }
  return false;
};

function WorkCard({ w, onOpen }: { w: WorkMeta; onOpen: (w: WorkMeta) => void }) {
  return (
    <button onClick={() => onOpen(w)} className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-shadow hover:shadow-md">
      <div className="aspect-[3/4] w-full overflow-hidden bg-secondary">
        <img src={apiUrl(w.image_url)} alt={w.title} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      </div>
      <div className="p-2">
        <p className="truncate text-sm font-medium">{w.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{w.author_credit || '匿名'} {w.depth > 0 ? `· fork ${w.depth} 层` : ''}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>♥ {w.like_count ?? 0}</span><span>💬 {w.comment_count ?? 0}</span>
          {w.tags.slice(0, 2).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
        </div>
      </div>
    </button>
  );
}

export default function Community({ navigate }: { navigate: (to: string) => void }) {
  const [tab, setTab] = useState<Tab>('feed');
  const [works, setWorks] = useState<WorkMeta[] | null>(null);
  const [tag, setTag] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  const [profile, setProfile] = useState<{ authorId: string; name: string; works: WorkMeta[] } | null>(null);
  const [active, setActive] = useState<WorkMeta | null>(null);
  const [comments, setComments] = useState<{ id: string; body: string; author_id: string }[]>([]);
  const [commentText, setCommentText] = useState('');
  const [tasks, setTasks] = useState<{ id: string; theme: string; constraints: string | null }[] | null>(null);
  const [activeTask, setActiveTask] = useState<{ id: string; theme: string; works: WorkMeta[] } | null>(null);
  const [newTheme, setNewTheme] = useState('');
  const [notices, setNotices] = useState<{ id: string; kind: string; body: string | null; read: boolean; work_id: string | null; created_at: string }[] | null>(null);
  const [mine, setMine] = useState<WorkMeta[] | null>(null);

  const loadFeed = useCallback(async () => {
    try { const r = await api.feed({ tag: tag || undefined, q: q || undefined, sort }); setWorks(r.works); }
    catch { setWorks([]); }
  }, [tag, q, sort]);
  useEffect(() => { if (tab === 'feed') void loadFeed(); }, [tab, loadFeed]);
  useEffect(() => {
    if (tab === 'tasks') api.tasks().then((r) => setTasks(r.tasks)).catch(() => setTasks([]));
    if (tab === 'notify') api.notifications().then((r) => setNotices(r.notifications)).catch(() => setNotices([]));
    if (tab === 'mine') api.myWorks().then((r) => setMine(r.works)).catch((e) => { if (!needLogin(e)) setMine([]); });
  }, [tab]);

  async function openWork(w: WorkMeta) {
    setActive(w);
    try { const r = await api.comments(w.id); setComments(r.comments); } catch { setComments([]); }
  }
  async function doLike(w: WorkMeta) {
    try { const r = await api.like(w.id); toast.success(r.liked ? '已点赞' : '已取消点赞'); void loadFeed(); }
    catch (e) { if (!needLogin(e)) toast.error('操作失败'); }
  }
  async function addComment(w: WorkMeta) {
    if (!commentText.trim()) return;
    try { await api.addComment(w.id, commentText.trim()); setCommentText(''); const r = await api.comments(w.id); setComments(r.comments); }
    catch (e) { if (!needLogin(e)) toast.error(e instanceof Error ? e.message : '评论失败'); }
  }
  async function delComment(cid: string) {
    try { await api.deleteComment(cid); if (active) { const r = await api.comments(active.id); setComments(r.comments); } }
    catch (e) { toast.error('删除失败'); }
  }
  async function report(w: WorkMeta) {
    const reason = window.prompt('举报原因（色情/侵权/暴力等）');
    if (!reason) return;
    try { await api.reportWork(w.id, reason); toast.success('已举报，感谢反馈'); }
    catch (e) { toast.error('举报失败'); }
  }
  async function ownerAction(w: WorkMeta, action: 'withdraw' | 'delete' | 'appeal') {
    try {
      if (action === 'withdraw') { await api.withdrawWork(w.id); toast.success('已撤回，停止新 fork'); }
      if (action === 'delete') { if (!window.confirm('删除作品？')) return; await api.deleteWork(w.id); toast.success('已删除'); }
      if (action === 'appeal') { await api.appealWork(w.id); toast.success('申诉通过，已恢复'); }
      setActive(null); void loadFeed(); if (tab === 'mine') api.myWorks().then((r) => setMine(r.works)).catch(() => {});
    } catch (e) { toast.error(e instanceof Error ? e.message : '操作失败'); }
  }
  async function createTask() {
    if (!newTheme.trim()) { toast.error('请输入任务主题'); return; }
    try { await api.createTask(newTheme.trim()); setNewTheme(''); toast.success('任务已创建'); const r = await api.tasks(); setTasks(r.tasks); }
    catch (e) { if (!needLogin(e)) toast.error('创建失败'); }
  }
  async function openTask(id: string) {
    try { const r = await api.task(id); setActiveTask({ id: r.task.id, theme: r.task.theme, works: r.works }); }
    catch { toast.error('加载失败'); }
  }
  async function submitToTask(workId: string) {
    if (!activeTask) return;
    try { await api.submitTask(activeTask.id, workId); toast.success('已提交'); const r = await api.task(activeTask.id); setActiveTask({ id: r.task.id, theme: r.task.theme, works: r.works }); }
    catch (e) { if (!needLogin(e)) toast.error(e instanceof Error ? e.message : '提交失败'); }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold tracking-tight">社区</h1>
        <span className="text-xs text-muted-foreground">作品 + 配方可 fork · 原图永不公开</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {([['feed', '发现'], ['tasks', '共创任务'], ['notify', '通知'], ['mine', '我的作品']] as [Tab, string][]).map(([v, l]) => (
            <Button key={v} size="sm" variant={tab === v ? 'secondary' : 'ghost'} onClick={() => setTab(v)}>{l}</Button>
          ))}
        </div>
      </div>

      {tab === 'feed' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="按标签筛选，如 夜景" className="h-9 w-40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜作品 / 作者 / 标签" className="h-9 w-48" onKeyDown={(e) => { if (e.key === 'Enter') void loadFeed(); }} />
            <Button size="sm" variant={sort === 'new' ? 'secondary' : 'outline'} onClick={() => setSort('new')}>最新</Button>
            <Button size="sm" variant={sort === 'hot' ? 'secondary' : 'outline'} onClick={() => setSort('hot')}>热门</Button>
            <Button size="sm" variant="outline" onClick={() => void loadFeed()}>搜索</Button>
          </div>
          {works === null ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</div>
            : works.length === 0 ? <Card className="p-10 text-center text-sm text-muted-foreground">还没有公开作品。去创作台生成并发布第一张。</Card>
              : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{works.map((w) => <WorkCard key={w.id} w={w} onOpen={openWork} />)}</div>}
        </>
      )}

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input value={newTheme} onChange={(e) => setNewTheme(e.target.value)} placeholder="发起共创主题，如「雨夜霓虹」" className="h-9 w-64" />
            <Button size="sm" onClick={() => void createTask()}>发起任务</Button>
          </div>
          {tasks === null ? <Skeleton className="h-24 w-full rounded-xl" /> : tasks.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">暂无进行中的共创任务。</Card> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tasks.map((t) => (
                <Card key={t.id} className="cursor-pointer p-4 hover:shadow-md" onClick={() => void openTask(t.id)}>
                  <p className="text-sm font-semibold">{t.theme}</p>
                  {t.constraints && <p className="mt-1 text-xs text-muted-foreground">{t.constraints}</p>}
                  <p className="mt-2 text-[11px] text-primary">点击查看提交 →</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notify' && (
        notices === null ? <Skeleton className="h-24 w-full rounded-xl" /> : notices.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">暂无通知。</Card> : (
          <div className="space-y-2">
            {notices.map((n) => (
              <Card key={n.id} className={`flex items-center gap-3 p-3 ${n.read ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{n.body || { fork: '有人 fork 了你的作品', like: '有人赞了你的作品', comment: '有人评论了你的作品', removed: '作品被下架', submission: '有人提交了你的任务' }[n.kind] || n.kind}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString('zh-CN')}</p>
                </div>
                {!n.read && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={async () => { await api.readNotification(n.id); setNotices((old) => old?.map((x) => x.id === n.id ? { ...x, read: true } : x) || null); }}>标为已读</Button>}
              </Card>
            ))}
          </div>
        )
      )}

      {tab === 'mine' && (
        mine === null ? <Skeleton className="h-24 w-full rounded-xl" /> : mine.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">你还没有发布作品。在创作台结果页点「发布到社区」。</Card> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {mine.map((w) => (
              <Card key={w.id} className="overflow-hidden p-0">
                <div className="aspect-[3/4] w-full bg-secondary"><img src={apiUrl(w.image_url)} alt={w.title} className="size-full object-cover" /></div>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{w.title}</p>
                  <Badge variant={w.status === 'published' ? 'secondary' : 'outline'} className="mt-1 text-[10px]">{{ published: '已发布', withdrawn: '已撤回', removed: '已下架', pending: '审核中' }[w.status] || w.status}</Badge>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {w.status === 'published' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(w, 'withdraw')}>撤回</Button>}
                    {w.status === 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(w, 'appeal')}>申诉</Button>}
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void ownerAction(w, 'delete')}>删除</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      <Dialog open={Boolean(active)} onOpenChange={(v) => { if (!v) setActive(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {active && (
            <>
              <DialogHeader><DialogTitle>{active.title}</DialogTitle></DialogHeader>
              <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
                <img src={apiUrl(active.image_url)} alt={active.title} className="w-full rounded-lg border border-border object-contain" />
                <div className="space-y-3 text-sm">
                  <p className="text-xs text-muted-foreground">作者：<button className="text-primary underline" onClick={() => void openProfile(active.author_id, active.author_credit || '匿名')}>{active.author_credit || '匿名'}</button> {active.depth > 0 && <>· fork 自 <button className="text-primary underline" onClick={() => active.parent_work_id && openWorkById(active.parent_work_id)}>上游作品</button>（{active.depth} 层）</>}</p>
                  <div className="flex flex-wrap gap-1">{active.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void doLike(active)}>♥ 点赞</Button>
                    {active.allow_fork && <Button size="sm" onClick={() => navigate(`/studio?fork=${active.id}`)}>做同款</Button>}
                    <Button size="sm" variant="ghost" onClick={() => void report(active)}>举报</Button>
                  </div>
                  {active.is_owner && (
                    <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                      {active.status === 'published' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(active, 'withdraw')}>撤回</Button>}
                      {active.status === 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(active, 'appeal')}>申诉</Button>}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => void ownerAction(active, 'delete')}>删除</Button>
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">查看配方（prompt/模型/画幅）</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{`${active.skill_snapshot?.prompt || ''}\n模型 ${active.skill_snapshot?.model || ''} · 画幅 ${active.skill_snapshot?.ratio || ''}`}</pre>
                  </details>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-sm font-semibold">评论（{comments.length}）</p>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-sm">
                      <p className="flex-1">{c.body}</p>
                      <button className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => void delComment(c.id)}>删除</button>
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-xs text-muted-foreground">还没有评论。</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <Input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="说点什么…" className="h-9" onKeyDown={(e) => { if (e.key === 'Enter') void addComment(active); }} />
                  <Button size="sm" onClick={() => void addComment(active)}>发送</Button>
                </div>
              </div>
              <DialogFooter />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(activeTask)} onOpenChange={(v) => { if (!v) setActiveTask(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {activeTask && (
            <>
              <DialogHeader><DialogTitle>共创：{activeTask.theme}</DialogTitle></DialogHeader>
              <p className="text-xs text-muted-foreground">提交你已发布的作品参与共创。</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {activeTask.works.map((w) => <WorkCard key={w.id} w={w} onOpen={(x) => { setActiveTask(null); openWork(x); }} />)}
                {activeTask.works.length === 0 && <p className="col-span-full text-sm text-muted-foreground">暂无提交。</p>}
              </div>
              <SubmitMine onSubmit={submitToTask} />
              <DialogFooter />
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(profile)} onOpenChange={(v) => { if (!v) setProfile(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {profile && (
            <>
              <DialogHeader><DialogTitle>{profile.name} 的公开作品</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {profile.works.map((w) => <WorkCard key={w.id} w={w} onOpen={(x) => { setProfile(null); openWork(x); }} />)}
                {profile.works.length === 0 && <p className="col-span-full text-sm text-muted-foreground">暂无公开作品。</p>}
              </div>
              <DialogFooter />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );

  async function openProfile(authorId: string, name: string) {
    try { const r = await api.userWorks(authorId); setProfile({ authorId, name, works: r.works }); }
    catch { toast.error('加载作者作品失败'); }
  }

  async function openWorkById(id: string) {
    try { const r = await api.work(id); openWork(r.work); } catch { toast.error('上游作品不可见'); }
  }
}

function SubmitMine({ onSubmit }: { onSubmit: (workId: string) => void }) {
  const [mine, setMine] = useState<WorkMeta[] | null>(null);
  useEffect(() => { api.myWorks().then((r) => setMine(r.works.filter((w) => w.status === 'published'))).catch(() => setMine([])); }, []);
  if (!mine || mine.length === 0) return <p className="mt-3 text-xs text-muted-foreground">你没有已发布作品可提交。先去创作并发布。</p>;
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-xs font-semibold">选择我的作品提交</p>
      <div className="flex flex-wrap gap-2">
        {mine.map((w) => <Button key={w.id} size="sm" variant="outline" onClick={() => onSubmit(w.id)}>{w.title}</Button>)}
      </div>
    </div>
  );
}