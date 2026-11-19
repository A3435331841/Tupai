import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl, loginUrl, ApiRequestError } from '@/lib/api';
import type { NotificationItem, TaskItem, WorkComment, WorkMeta } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { PageHero } from '@/components/PageHero';
import { SectionHeading } from '@/components/SectionHeading';

type Tab = 'feed' | 'tasks' | 'notify' | 'mine';
const XINYU_LOCAL_URL = 'http://127.0.0.1:8767';
const needLogin = (e: unknown) => {
  if (e instanceof ApiRequestError && e.status === 401) { toast.error('请先登录'); window.location.href = loginUrl(); return true; }
  return false;
};
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function readInitialTab(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'tasks' || t === 'notify' || t === 'mine' ? t : 'feed';
}
function readInitialQuery(): string {
  return new URLSearchParams(window.location.search).get('q') || '';
}

function WorkCard({ w, onOpen }: { w: WorkMeta; onOpen: (w: WorkMeta) => void }) {
  return (
    <button onClick={() => onOpen(w)} className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-shadow hover:shadow-md">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary">
        <img src={apiUrl(w.image_url)} alt={w.title} loading="lazy" className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute left-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">AI</span>
      </div>
      <div className="p-2">
        <p className="truncate text-sm font-medium">{w.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{w.author_credit || '匿名'} {w.depth > 0 ? `· fork ${w.depth} 层` : ''}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>♥ {w.like_count ?? 0}</span><span>💬 {w.comment_count ?? 0}</span><span>⑂ {w.fork_count ?? 0}</span>
          {w.tags.slice(0, 2).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
        </div>
      </div>
    </button>
  );
}

export default function Community({ navigate }: { navigate: (to: string) => void }) {
  const [tab, setTab] = useState<Tab>(readInitialTab);
  const [works, setWorks] = useState<WorkMeta[] | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [q, setQ] = useState(readInitialQuery);
  const [sort, setSort] = useState<'new' | 'hot'>('new');
  // 只有显式搜索/切换排序才请求，避免每个按键都打接口
  const [applied, setApplied] = useState<{ tag: string; q: string; sort: 'new' | 'hot' }>(() => ({ tag: '', q: readInitialQuery(), sort: 'new' }));
  const [profile, setProfile] = useState<{ authorId: string; name: string; works: WorkMeta[] } | null>(null);
  const [myKey, setMyKey] = useState<string | null>(null);
  const [active, setActive] = useState<WorkMeta | null>(null);
  const [comments, setComments] = useState<WorkComment[]>([]);
  const [commentHasMore, setCommentHasMore] = useState(false);
  const [commentNext, setCommentNext] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [activeTask, setActiveTask] = useState<TaskItem & { works: WorkMeta[] } | null>(null);
  const [newTheme, setNewTheme] = useState('');
  const [newConstraints, setNewConstraints] = useState('');
  const [notices, setNotices] = useState<NotificationItem[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [mine, setMine] = useState<WorkMeta[] | null>(null);
  const [reportTarget, setReportTarget] = useState<WorkMeta | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<WorkMeta | null>(null);
  const [editing, setEditing] = useState<WorkMeta | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editFork, setEditFork] = useState(true);

  const loadFeed = useCallback(async () => {
    setFeedError(null);
    try {
      const r = await api.feed({ tag: applied.tag || undefined, q: applied.q || undefined, sort: applied.sort });
      setWorks(r.works);
    } catch (e) {
      setWorks([]);
      setFeedError(e instanceof ApiRequestError && e.status === 0 ? '网络异常，无法加载社区内容' : errText(e, '加载失败，请稍后重试'));
    }
  }, [applied]);
  useEffect(() => { if (tab === 'feed') void loadFeed(); }, [tab, loadFeed]);
  const applyFilters = (next?: Partial<{ tag: string; q: string; sort: 'new' | 'hot' }>) => {
    setApplied({ tag, q, sort, ...next });
  };

  // 顶栏搜索/通知在社区页内不改变 path，用事件同步 tab 与关键词
  useEffect(() => {
    const onSearch = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail || '';
      setTab('feed');
      setQ(detail);
      setApplied((old) => ({ ...old, q: detail }));
    };
    const onTab = (e: Event) => {
      const detail = (e as CustomEvent<Tab>).detail;
      if (detail) setTab(detail);
    };
    window.addEventListener('tupai:search', onSearch as EventListener);
    window.addEventListener('tupai:tab', onTab as EventListener);
    return () => {
      window.removeEventListener('tupai:search', onSearch as EventListener);
      window.removeEventListener('tupai:tab', onTab as EventListener);
    };
  }, []);

  useEffect(() => {
    if (tab === 'tasks' || tab === 'feed') api.tasks().then((r) => setTasks(r.tasks)).catch(() => setTasks([]));
    if (tab === 'notify') {
      api.notifications().then((r) => { setNotices(r.notifications); setUnread(r.unread); }).catch(() => setNotices([]));
    }
    if (tab === 'mine') api.myWorks().then((r) => setMine(r.works)).catch((e) => { if (!needLogin(e)) setMine([]); });
  }, [tab]);

  async function openWork(w: WorkMeta) {
    setActive(w);
    setCommentText('');
    try {
      const r = await api.comments(w.id, { limit: 50 });
      setComments(r.comments); setCommentHasMore(r.has_more); setCommentNext(r.next_offset);
    } catch { setComments([]); setCommentHasMore(false); }
    api.me().then((m) => setMyKey(m.owner_key)).catch(() => setMyKey(null));
  }
  async function openWorkById(id: string) {
    try { const r = await api.work(id); await openWork(r.work); } catch { toast.error('上游作品已撤回或不可见'); }
  }
  async function loadMoreComments() {
    if (!active) return;
    try {
      const r = await api.comments(active.id, { limit: 50, offset: commentNext });
      setComments((old) => [...old, ...r.comments]);
      setCommentHasMore(r.has_more); setCommentNext(r.next_offset);
    } catch { toast.error('加载更多失败'); }
  }
  async function doLike(w: WorkMeta) {
    try {
      const r = await api.like(w.id);
      const patch = (x: WorkMeta) => (x.id === w.id ? { ...x, liked: r.liked, like_count: r.like_count } : x);
      setWorks((old) => old?.map(patch) || null);
      setMine((old) => old?.map(patch) || null);
      setActive((old) => (old && old.id === w.id ? patch(old) : old));
      toast.success(r.liked ? '已点赞' : '已取消点赞');
    } catch (e) { if (!needLogin(e)) toast.error('操作失败'); }
  }
  async function addComment(w: WorkMeta) {
    if (!commentText.trim()) return;
    try {
      const r = await api.addComment(w.id, commentText.trim());
      setComments((old) => [...old, r.comment]);
      setCommentText('');
      setActive((old) => (old ? { ...old, comment_count: (old.comment_count || 0) + 1 } : old));
    } catch (e) { if (!needLogin(e)) toast.error(errText(e, '评论失败')); }
  }
  async function delComment(cid: string) {
    try {
      await api.deleteComment(cid);
      setComments((old) => old.filter((c) => c.id !== cid));
      setActive((old) => (old ? { ...old, comment_count: Math.max(0, (old.comment_count || 1) - 1) } : old));
    } catch { toast.error('删除失败'); }
  }
  async function submitReport() {
    if (!reportTarget || !reportReason.trim()) { toast.error('请填写举报原因'); return; }
    try {
      await api.reportWork(reportTarget.id, reportReason.trim());
      toast.success('已举报，感谢反馈');
      setReportTarget(null); setReportReason('');
    } catch (e) { if (!needLogin(e)) toast.error(errText(e, '举报失败')); }
  }
  async function confirmDelete() {
    if (!confirmTarget) return;
    try {
      await api.deleteWork(confirmTarget.id);
      toast.success('已删除');
      setConfirmTarget(null); setActive(null); void loadFeed();
      if (tab === 'mine') api.myWorks().then((r) => setMine(r.works)).catch(() => {});
    } catch (e) { toast.error(errText(e, '删除失败')); }
  }
  async function ownerAction(w: WorkMeta, action: 'withdraw' | 'republish' | 'appeal') {
    try {
      if (action === 'withdraw') await api.withdrawWork(w.id);
      if (action === 'republish') await api.republishWork(w.id);
      if (action === 'appeal') await api.appealWork(w.id);
      toast.success(action === 'withdraw' ? '已撤回，停止新 fork' : action === 'republish' ? '已重新发布' : '申诉通过，已恢复');
      const r = await api.work(w.id);
      setActive(r.work);
      void loadFeed();
      if (tab === 'mine') api.myWorks().then((x) => setMine(x.works)).catch(() => {});
    } catch (e) { toast.error(errText(e, '操作失败')); }
  }
  async function createTask() {
    if (!newTheme.trim()) { toast.error('请输入任务主题'); return; }
    try {
      await api.createTask(newTheme.trim(), newConstraints.trim() || undefined);
      setNewTheme(''); setNewConstraints('');
      toast.success('任务已创建');
      const r = await api.tasks(); setTasks(r.tasks);
    } catch (e) { if (!needLogin(e)) toast.error('创建失败'); }
  }
  async function openTask(id: string) {
    try {
      const r = await api.task(id);
      setActiveTask({ ...r.task, works: r.works });
      api.me().then((m) => setMyKey(m.owner_key)).catch(() => {});
    } catch { toast.error('加载失败'); }
  }
  async function submitToTask(workId: string) {
    if (!activeTask) return;
    try {
      await api.submitTask(activeTask.id, workId);
      toast.success('已提交');
      const r = await api.task(activeTask.id);
      setActiveTask({ ...r.task, works: r.works });
    } catch (e) { if (!needLogin(e)) toast.error(errText(e, '提交失败')); }
  }
  async function withdrawSubmission(workId: string) {
    if (!activeTask) return;
    try {
      await api.withdrawSubmission(activeTask.id, workId);
      toast.success('已撤回投稿');
      const r = await api.task(activeTask.id);
      setActiveTask({ ...r.task, works: r.works });
      const list = await api.tasks(); setTasks(list.tasks);
    } catch (e) { toast.error(errText(e, '撤回失败')); }
  }
  async function toggleTask(status: 'open' | 'closed') {
    if (!activeTask) return;
    try {
      await api.updateTask(activeTask.id, status);
      setActiveTask({ ...activeTask, status });
      toast.success(status === 'closed' ? '任务已关闭，停止接收投稿' : '任务已重新开放');
      const r = await api.tasks(); setTasks(r.tasks);
    } catch (e) { toast.error(errText(e, '操作失败')); }
  }
  async function openNotice(n: NotificationItem) {
    if (!n.read) {
      try {
        await api.readNotification(n.id);
        setNotices((old) => old?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) || null);
        setUnread((v) => {
          const next = Math.max(0, v - 1);
          window.dispatchEvent(new CustomEvent('tupai:unread', { detail: next }));
          return next;
        });
      } catch { /* 已读失败不阻塞跳转 */ }
    }
    if (n.work_id) {
      try { const r = await api.work(n.work_id); setTab('feed'); await openWork(r.work); }
      catch { toast.error('相关作品已撤回或删除'); }
    }
  }
  async function readAll() {
    try {
      await api.readAllNotifications();
      setNotices((old) => old?.map((x) => ({ ...x, read: true })) || null);
      setUnread(0);
      window.dispatchEvent(new CustomEvent('tupai:unread', { detail: 0 }));
      toast.success('已全部标记为已读');
    } catch { toast.error('操作失败'); }
  }
  async function copyWorkLink(id: string) {
    const link = `${window.location.origin}/work/${id}/`;
    try { await navigator.clipboard.writeText(link); toast.success('作品链接已复制'); }
    catch { toast.info(`请手动复制：${link}`); }
  }
  function openEdit(w: WorkMeta) {
    setEditing(w); setEditTitle(w.title); setEditTags(w.tags.join('，')); setEditFork(Boolean(w.allow_fork));
  }
  async function saveEdit() {
    if (!editing) return;
    try {
      const tags = editTags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
      const r = await api.updateWork(editing.id, { title: editTitle.trim(), tags, allow_fork: editFork });
      const patch = (x: WorkMeta) => (x.id === editing.id ? { ...x, ...r.work } : x);
      setMine((old) => old?.map(patch) || null);
      setWorks((old) => old?.map(patch) || null);
      setActive((old) => (old && old.id === editing.id ? { ...old, ...r.work } : old));
      setEditing(null);
      toast.success('作品已更新');
    } catch (e) { toast.error(errText(e, '更新失败')); }
  }
  async function openProfile(authorId: string, name: string) {
    try { const r = await api.userWorks(authorId); setProfile({ authorId, name, works: r.works }); }
    catch { toast.error('加载作者作品失败'); }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <PageHero
        kicker="本周策展"
        title="废片，也有第二次机会。"
        description="公开作品与配方，底图始终属于你。别人可以 fork 你的配方做同款，但原图永不出现。"
        aside={(
          <>
            {([['feed', '发现'], ['tasks', '共创任务'], ['notify', '通知'], ['mine', '我的作品']] as [Tab, string][]).map(([v, l]) => (
              <Button key={v} size="sm" variant={tab === v ? 'secondary' : 'ghost'} onClick={() => setTab(v)}>
                {l}{v === 'notify' && unread > 0 ? ` ${unread}` : ''}
              </Button>
            ))}
          </>
        )}
      >
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span className="site-trust-list flex flex-wrap gap-x-4 gap-y-1">
            <span>公开的是结果与配方</span>
            <span>原图永不公开</span>
            <span>fork 使用配方和自己的底图</span>
          </span>
        </div>
      </PageHero>

      {tab === 'feed' && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="按标签筛选，如 夜景" className="h-9 w-40" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜作品 / 作者 / 标签" className="h-9 w-48" onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }} />
            <Button size="sm" variant={sort === 'new' ? 'secondary' : 'outline'} onClick={() => { setSort('new'); applyFilters({ sort: 'new' }); }}>最新</Button>
            <Button size="sm" variant={sort === 'hot' ? 'secondary' : 'outline'} onClick={() => { setSort('hot'); applyFilters({ sort: 'hot' }); }}>热门</Button>
            <Button size="sm" variant="outline" onClick={() => applyFilters()}>搜索</Button>
          </div>
          {feedError && (
            <Card className="mb-4 flex flex-col items-center gap-2 border-destructive/40 p-6 text-center">
              <p className="text-sm text-destructive">{feedError}</p>
              <Button size="sm" variant="outline" onClick={() => void loadFeed()}>重试</Button>
            </Card>
          )}
          {works === null ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-[3/4] rounded-xl" />)}</div>
            : works.length === 0 && !feedError ? (
              /* 设计稿：错落作品墙（示例，仅在接口成功且为空时展示） */
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 lg:grid-rows-2">
                <div className="relative col-span-2 row-span-2 overflow-hidden rounded-xl border border-border/70">
                  <img src="/gallery/g19-street.png" alt="雨夜之后（示例）" className="size-full object-cover" />
                  <span className="absolute left-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">示例</span>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="font-display text-xl font-bold text-white">雨夜之后</p>
                    <p className="mt-1 text-xs text-white/85">小岛 · 夜景提亮 · 雨夜霓虹</p>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-white/70">小岛 → 阿禾 · fork 2</span>
                      <Button size="sm" className="h-7 bg-primary text-[11px] text-primary-foreground" onClick={() => navigate('/studio?template=night-bright')}>做同款</Button>
                    </div>
                  </div>
                </div>
                {[
                  ['/templates/film-daily.webp', '阿禾', '胶片暖调', '阿禾 → 拾光 · fork 2'],
                  ['/gallery/g13-city.jpg', '山木', '金色山野', '山木 → 南风 · fork 2'],
                  ['/templates/clean-portrait.webp', '林间', '柔光人像', '林间 → 阿禾 · fork 2'],
                  ['/templates/magazine-cover.webp', '白川', '黑白颗粒', '白川 → 山木 · fork 2'],
                  ['/gallery/g10-pet.jpg', '橙子', '日常胶片', '橙子 → 林间 · fork 2'],
                  ['/gallery/g07-food.jpg', '南风', '食物暖光', '南风 → 拾光 · fork 2'],
                  ['/gallery/g12-beach.jpg', '拾光', '海边日记', '拾光 → 阿禾 · fork 2'],
                  ['/gallery/g20-flowers.png', '花影', '静物胶片', '花影 → 南风 · fork 2'],
                ].map(([src, author, tagName, fork]) => (
                  <div key={author} className="group overflow-hidden rounded-xl border border-border/70 bg-card">
                    <div className="relative aspect-[4/3] bg-secondary">
                      <img src={src} alt={`${author}（示例）`} className="size-full object-cover transition-transform duration-500 group-hover:scale-105" />
                      <span className="absolute left-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">示例</span>
                    </div>
                    <div className="p-2">
                      <p className="truncate text-xs font-medium">{author} <span className="font-normal text-muted-foreground">· {tagName}</span></p>
                      <p className="mt-0.5 truncate text-[10px] text-primary">{fork}</p>
                    </div>
                  </div>
                ))}
              </div>
            )
              : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{works.map((w) => <WorkCard key={w.id} w={w} onOpen={openWork} />)}</div>}

          {/* 设计稿：共创主题横排 */}
          <section className="mt-8">
            <SectionHeading title="共创主题：把秋天拍成电影" aside="本周热门" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="grid flex-1 grid-cols-3 gap-3">
                {['/gallery/g15-plant.jpg', '/gallery/g19-street.png', '/gallery/g17-reading.png'].map((src, i) => (
                  <div key={i} className="aspect-[16/10] overflow-hidden rounded-lg border border-border/70 bg-secondary">
                    <img src={src} alt="共创主题示例" className="size-full object-cover" />
                  </div>
                ))}
              </div>
              <Button className="shrink-0 bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => setTab('tasks')}>参加共创</Button>
            </div>
          </section>

          {tasks && tasks.length > 0 && (
            <section className="mt-8">
              <SectionHeading title="进行中的共创" aside={`${tasks.length} 个`}>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => setTab('tasks')}>查看全部 →</button>
              </SectionHeading>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tasks.slice(0, 3).map((t) => (
                  <Card key={t.id} className="cursor-pointer p-4 transition-transform hover:-translate-y-0.5" onClick={() => { setTab('tasks'); void openTask(t.id); }}>
                    <p className="font-display text-sm font-bold text-foreground">{t.theme}</p>
                    {t.constraints && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.constraints}</p>}
                    <span className="mt-3 inline-block text-[11px] text-primary">参与共创 · {t.submission_count ?? 0} 件投稿 →</span>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input value={newTheme} onChange={(e) => setNewTheme(e.target.value)} placeholder="发起共创主题，如「雨夜霓虹」" className="h-9 w-64" />
            <Input value={newConstraints} onChange={(e) => setNewConstraints(e.target.value)} placeholder="约束（可选）：必须保留人物、仅夜景…" className="h-9 w-72" />
            <Button size="sm" onClick={() => void createTask()}>发起任务</Button>
          </div>
          {tasks === null ? <Skeleton className="h-24 w-full rounded-xl" /> : tasks.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">暂无进行中的共创任务。</Card> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tasks.map((t) => (
                <Card key={t.id} className="cursor-pointer p-4 hover:shadow-md" onClick={() => void openTask(t.id)}>
                  <p className="text-sm font-semibold">{t.theme}</p>
                  {t.constraints && <p className="mt-1 text-xs text-muted-foreground">{t.constraints}</p>}
                  <p className="mt-2 text-[11px] text-primary">{t.submission_count ?? 0} 件投稿 · 点击查看 →</p>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'notify' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-sm text-muted-foreground">{unread > 0 ? `${unread} 条未读` : '没有未读通知'}</p>
            <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" disabled={unread === 0} onClick={() => void readAll()}>全部已读</Button>
          </div>
          {notices === null ? <Skeleton className="h-24 w-full rounded-xl" /> : notices.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">暂无通知。</Card> : (
            <div className="space-y-2">
              {notices.map((n) => (
                <Card
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openNotice(n)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') void openNotice(n); }}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-secondary/50 ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{n.body || ({ fork: '有人 fork 了你的作品', like: '有人赞了你的作品', comment: '有人评论了你的作品', removed: '作品被下架', submission: '有人提交了你的任务' } as Record<string, string>)[n.kind] || n.kind}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(n.created_at).toLocaleString('zh-CN')}{n.work_id ? ' · 点击查看作品' : ''}</p>
                  </div>
                  {!n.read && <Badge variant="secondary" className="text-[10px]">未读</Badge>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        mine === null ? <Skeleton className="h-24 w-full rounded-xl" /> : mine.length === 0 ? <Card className="p-8 text-center text-sm text-muted-foreground">你还没有发布作品。在创作台结果页点「发布到社区」。</Card> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {mine.map((w) => (
              <Card key={w.id} className="overflow-hidden p-0">
                <button type="button" className="block w-full" onClick={() => void openWork(w)}>
                  <div className="relative aspect-[3/4] w-full bg-secondary">
                    <img src={apiUrl(w.image_url)} alt={w.title} className="size-full object-cover" />
                    <span className="absolute left-2 top-2 rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white">AI</span>
                  </div>
                </button>
                <div className="p-2">
                  <p className="truncate text-sm font-medium">{w.title}</p>
                  <Badge variant={w.status === 'published' ? 'secondary' : 'outline'} className="mt-1 text-[10px]">{{ published: '已发布', withdrawn: '已撤回', removed: '已下架', pending: '审核中' }[w.status] || w.status}</Badge>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(w)}>编辑</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void copyWorkLink(w.id)}>复制链接</Button>
                    {w.status === 'published' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(w, 'withdraw')}>撤回</Button>}
                    {w.status === 'withdrawn' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(w, 'republish')}>重新发布</Button>}
                    {w.status === 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(w, 'appeal')}>申诉</Button>}
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setConfirmTarget(w)}>删除</Button>
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
                <div className="relative">
                  <img src={apiUrl(active.image_url)} alt={active.title} className="w-full rounded-lg border border-border object-contain" />
                  <span className="absolute left-2 top-2 rounded-full bg-black/50 px-2 py-1 text-[10px] text-white">AI 生成</span>
                </div>
                <div className="space-y-3 text-sm">
                  <p className="text-xs text-muted-foreground">作者：<button className="text-primary underline" onClick={() => void openProfile(active.author_id, active.author_credit || '匿名')}>{active.author_credit || '匿名'}</button> {active.depth > 0 && <>· fork 自 <button className="text-primary underline" onClick={() => active.parent_work_id && void openWorkById(active.parent_work_id)}>上游作品</button>（{active.depth} 层）</>}</p>
                  <div className="flex flex-wrap gap-1">{active.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={active.liked ? 'secondary' : 'outline'} onClick={() => void doLike(active)}>♥ {active.liked ? `已赞 ${active.like_count ?? 0}` : `点赞 ${active.like_count ?? 0}`}</Button>
                    {active.allow_fork && <Button size="sm" onClick={() => navigate(`/studio?fork=${active.id}`)}>做同款</Button>}
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="xinyu-agent-entry"
                      title="打开本机心语，用带证据的分析理解这件公开作品"
                      onClick={() => window.open(
                        `${XINYU_LOCAL_URL}/?import=tupai&work_id=${encodeURIComponent(active.id)}`,
                        '_blank',
                        'noopener,noreferrer',
                      )}
                    >
                      心语理解（需本机）
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void copyWorkLink(active.id)}>复制链接</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setActive(null); navigate(`/work/${active.id}`); }}>独立页</Button>
                    <Button size="sm" variant="ghost" onClick={() => setReportTarget(active)}>举报</Button>
                  </div>
                  {active.is_owner && (
                    <div className="flex flex-wrap gap-1 border-t border-border pt-2">
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openEdit(active)}>编辑</Button>
                      {active.status === 'published' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(active, 'withdraw')}>撤回</Button>}
                      {active.status === 'withdrawn' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(active, 'republish')}>重新发布</Button>}
                      {active.status === 'removed' && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void ownerAction(active, 'appeal')}>申诉</Button>}
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => setConfirmTarget(active)}>删除</Button>
                    </div>
                  )}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">查看配方（prompt/模型/画幅）</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded bg-secondary p-2 text-[11px]">{`${active.skill_snapshot?.prompt || ''}\n模型 ${active.skill_snapshot?.model || ''} · 画幅 ${active.skill_snapshot?.ratio || ''}`}</pre>
                  </details>
                </div>
              </div>
              <div className="mt-4 border-t border-border pt-3">
                <p className="mb-2 text-sm font-semibold">评论（{active.comment_count ?? comments.length}）</p>
                <div className="space-y-2">
                  {comments.map((c) => (
                    <div key={c.id} className="flex items-start gap-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-muted-foreground">{c.author_name || '社区用户'} · {new Date(c.created_at).toLocaleString('zh-CN')}</p>
                        <p className="whitespace-pre-wrap">{c.body}</p>
                      </div>
                      {(active.is_owner || c.author_id === myKey) && <button className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => void delComment(c.id)}>{active.is_owner && c.author_id !== myKey ? '隐藏' : '删除'}</button>}
                    </div>
                  ))}
                  {comments.length === 0 && <p className="text-xs text-muted-foreground">还没有评论。</p>}
                  {commentHasMore && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void loadMoreComments()}>加载更多评论</Button>}
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{activeTask.works.length} 件投稿</span>
                {activeTask.status === 'closed' && <Badge variant="outline">已关闭</Badge>}
                {activeTask.is_owner && (
                  <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => void toggleTask(activeTask.status === 'closed' ? 'open' : 'closed')}>
                    {activeTask.status === 'closed' ? '重新开放' : '关闭任务'}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">提交你已发布的作品参与共创；误投可撤回。</p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {activeTask.works.map((w) => (
                  <div key={w.id} className="space-y-1">
                    <WorkCard w={w} onOpen={(x) => { setActiveTask(null); void openWork(x); }} />
                    {(activeTask.is_owner || w.author_id === myKey) && (
                      <Button size="sm" variant="ghost" className="h-7 w-full text-xs text-destructive" onClick={() => void withdrawSubmission(w.id)}>撤回投稿</Button>
                    )}
                  </div>
                ))}
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
                {profile.works.map((w) => <WorkCard key={w.id} w={w} onOpen={(x) => { setProfile(null); void openWork(x); }} />)}
                {profile.works.length === 0 && <p className="col-span-full text-sm text-muted-foreground">暂无公开作品。</p>}
              </div>
              <DialogFooter />
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reportTarget)} onOpenChange={(v) => { if (!v) { setReportTarget(null); setReportReason(''); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>举报作品</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground">请简要说明原因（色情、侵权、暴力等），管理员会复核。</p>
          <Textarea value={reportReason} onChange={(e) => setReportReason(e.target.value)} maxLength={300} className="min-h-24" placeholder="举报原因…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReportTarget(null); setReportReason(''); }}>取消</Button>
            <Button onClick={() => void submitReport()} disabled={!reportReason.trim()}>提交举报</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(confirmTarget)} onOpenChange={(v) => { if (!v) setConfirmTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>删除作品？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">「{confirmTarget?.title}」将从社区下架，原图与结果仍保留在资产库。</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>取消</Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => { if (!v) setEditing(null); }}>
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
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={() => void saveEdit()} disabled={!editTitle.trim()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
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
