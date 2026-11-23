import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Image as ImageIcon, Search, Sparkles, BookOpen, ChevronRight } from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
import type { ShowcaseSkill, SkillRecord } from '@/lib/types';
import { PageHero } from '@/components/PageHero';
import { SectionHeading } from '@/components/SectionHeading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

/**
 * 灵感库（docs/19）：浏览型模块，聚合官方技能 / 图片参考 / 社区公开配方。
 * 只读浏览 + 套用到创作台；无点赞评论等社交互动（那是社区模块）。
 * 三个详情视图：技能详情(示例对画册) / 图片参考详情 / 配方详情。
 */
type Tab = 'skills' | 'references' | 'recipes';
type RefItem = { id: string; url: string; tags: string[]; width: number | null; height: number | null };

function readRoute(): { view: 'list' | 'skill' | 'reference' | 'recipe'; id: string } {
  const p = window.location.pathname.replace(/\/+$/, '');
  let m = p.match(/^\/inspiration\/skill\/([^/]+)$/);
  if (m) return { view: 'skill', id: decodeURIComponent(m[1]) };
  m = p.match(/^\/inspiration\/reference\/(a_[0-9a-f]{24})$/);
  if (m) return { view: 'reference', id: m[1] };
  m = p.match(/^\/inspiration\/recipe\/([^/]+)$/);
  if (m) return { view: 'recipe', id: decodeURIComponent(m[1]) };
  return { view: 'list', id: '' };
}

export default function Inspiration({ navigate }: { navigate: (to: string) => void }) {
  const [route, setRoute] = useState(readRoute);
  const [tab, setTab] = useState<Tab>('skills');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [category, setCategory] = useState('');
  const [overview, setOverview] = useState<{ counts: { skills: number; references: number; recipes: number }; categories: Record<string, number> } | null>(null);

  const [skills, setSkills] = useState<ShowcaseSkill[] | null>(null);
  const [refs, setRefs] = useState<RefItem[] | null>(null);
  const [recipes, setRecipes] = useState<SkillRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 详情态数据
  const [skillDetail, setSkillDetail] = useState<{
    skill: ShowcaseSkill;
    pairs: { original_url: string; result_url: string; result_asset_id: string }[];
    album: { share_token: string; share_page: string } | null;
  } | null>(null);
  const [pairIdx, setPairIdx] = useState(0);
  const [refDetail, setRefDetail] = useState<{ reference: RefItem & { content_type: string | null }; related: { id: string; url: string; tags: string[] }[] } | null>(null);

  useEffect(() => {
    const onPop = () => { setRoute(readRoute()); window.scrollTo(0, 0); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    api.inspirationOverview().then(setOverview).catch(() => setOverview(null));
  }, []);

  useEffect(() => {
    setError(null);
    if (route.view === 'list') return;
    if (route.view === 'skill') {
      api.showcaseSkill(route.id).then((r) => { setSkillDetail(r); setPairIdx(0); }).catch((e) => setError(String(e?.message || '加载失败')));
    } else if (route.view === 'reference') {
      api.inspirationReference(route.id).then(setRefDetail).catch((e) => setError(String(e?.message || '加载失败')));
    }
  }, [route]);

  const loadSkills = useCallback(() => {
    setSkills(null);
    api.inspirationSkills({ category, q: applied }).then((r) => setSkills(r.skills)).catch((e) => { setSkills([]); setError(String(e?.message || '')); });
  }, [category, applied]);
  const loadRefs = useCallback(() => {
    setRefs(null);
    api.inspirationReferences({ q: applied, limit: 48 }).then((r) => setRefs(r.items)).catch((e) => { setRefs([]); setError(String(e?.message || '')); });
  }, [applied]);
  const loadRecipes = useCallback(() => {
    setRecipes(null);
    api.skills().then((r) => setRecipes(r.skills.filter((s) => (s as unknown as { visibility?: string }).visibility === 'public')))
      .catch(() => setRecipes([]));
  }, []);

  useEffect(() => {
    if (route.view !== 'list') return;
    if (tab === 'skills') loadSkills();
    else if (tab === 'references') loadRefs();
    else if (tab === 'recipes') loadRecipes();
  }, [route.view, tab, loadSkills, loadRefs, loadRecipes]);

  function goDetails(view: 'skill' | 'reference' | 'recipe', id: string) {
    navigate(`/inspiration/${view}/${encodeURIComponent(id)}`);
    setRoute({ view, id });
  }
  function goList() {
    navigate('/inspiration');
    setRoute({ view: 'list', id: '' });
  }
  function useSkill(templateId: string) {
    navigate(`/studio?template=${encodeURIComponent(templateId)}`);
  }
  function doSearch() { setApplied(q.trim()); }

  // ===== 详情：技能（示例对画册）=====
  if (route.view === 'skill') {
    const d = skillDetail;
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-20">
        <button onClick={goList} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />返回灵感库</button>
        {error && <p className="mb-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {!d ? <Skeleton className="h-96 w-full rounded-2xl" /> : (
          <>
            <PageHero kicker={`官方技能 · ${d.skill.category}`} title={d.skill.title_zh} description={d.skill.desc_zh}
              aside={<Button onClick={() => useSkill(d.skill.id)}>用这个技能创作 <ArrowRight className="size-4" /></Button>}>
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                {d.skill.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5">#{t}</span>)}
                <span className="ml-auto">{d.skill.pair_count} 组真实示例</span>
              </div>
            </PageHero>
            <SectionHeading title="原图 → 作品" aside={`${d.pairs.length} 组真实转换示例，左右翻阅`} />
            {d.pairs.length > 0 && (
              <div className="mt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <figure className="overflow-hidden rounded-xl border border-border/70 bg-card">
                    <img src={apiUrl(d.pairs[pairIdx].original_url)} alt="原图示例" className="aspect-[4/3] w-full object-cover" />
                    <figcaption className="p-2 text-center text-xs text-muted-foreground">原图（公开授权语料）</figcaption>
                  </figure>
                  <figure className="overflow-hidden rounded-xl border border-primary/30 bg-card">
                    <img src={apiUrl(d.pairs[pairIdx].result_url)} alt="作品示例" className="aspect-[4/3] w-full object-cover" />
                    <figcaption className="p-2 text-center text-xs text-primary">AI 作品 · 带生成标识</figcaption>
                  </figure>
                </div>
                <div className="mt-3 flex items-center justify-center gap-3">
                  <Button variant="outline" size="sm" disabled={pairIdx <= 0} onClick={() => setPairIdx((i) => i - 1)}><ArrowLeft className="size-4" />上一组</Button>
                  <span className="text-xs text-muted-foreground">{pairIdx + 1} / {d.pairs.length}</span>
                  <Button variant="outline" size="sm" disabled={pairIdx >= d.pairs.length - 1} onClick={() => setPairIdx((i) => i + 1)}>下一组<ArrowRight className="size-4" /></Button>
                </div>
              </div>
            )}
            {d.album && <div className="mt-5 text-center"><Button variant="ghost" onClick={() => window.open(apiUrl(d.album!.share_page), '_blank')}>打开完整画册 <ChevronRight className="size-4" /></Button></div>}
          </>
        )}
      </div>
    );
  }

  // ===== 详情：图片参考 =====
  if (route.view === 'reference') {
    const d = refDetail;
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-6 pb-20">
        <button onClick={goList} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />返回灵感库</button>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {!d ? <Skeleton className="h-96 w-full rounded-2xl" /> : (
          <>
            <PageHero kicker="图片参考 · 公开授权语料" title="参考大图" description="把喜欢的画面带进创作台，作为风格或构图参考。"
              aside={<Button onClick={() => navigate('/studio')}>去创作 <ArrowRight className="size-4" /></Button>}>
              <div className="flex flex-wrap gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                {d.reference.tags.map((t) => <span key={t} className="rounded-full bg-secondary px-2 py-0.5">#{t}</span>)}
              </div>
            </PageHero>
            <img src={apiUrl(d.reference.url)} alt="图片参考大图" className="mx-auto max-h-[70vh] rounded-2xl border border-border/70 bg-card object-contain" />
            {d.related.length > 0 && (
              <>
                <SectionHeading title="同类参考" aside="标签相近的参考图" />
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {d.related.map((r) => (
                    <button key={r.id} onClick={() => goDetails('reference', r.id)} className="overflow-hidden rounded-xl border border-border/70 bg-card text-left transition-transform hover:-translate-y-0.5">
                      <img src={apiUrl(r.url)} alt="" className="aspect-square w-full object-cover" />
                      <span className="block truncate p-2 text-[11px] text-muted-foreground">{r.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // ===== 详情：配方 =====
  if (route.view === 'recipe') {
    const r = recipes?.find((x) => x.skill_id === route.id);
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-20">
        <button onClick={goList} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="size-4" />返回灵感库</button>
        {!recipes ? <Skeleton className="h-64 w-full rounded-2xl" /> : !r ? (
          <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">配方不存在或已取消公开。</p>
        ) : (
          <>
            <PageHero kicker="社区公开配方" title={r.title} description={(r as unknown as { notes?: string }).notes || '来自社区创作者的公开配方'}
              aside={<Button onClick={() => navigate(`/studio?skill=${encodeURIComponent(r.skill_id)}`)}>用这个配方创作 <ArrowRight className="size-4" /></Button>}>
              <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-[11px] leading-5">{r.prompt}</pre>
            </PageHero>
          </>
        )}
      </div>
    );
  }

  // ===== 列表页 =====
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 pb-20">
      <PageHero kicker="官方技能 · 图片参考 · 社区公开配方" title="灵感库"
        description="找灵感、找配方、找参考——集中浏览可复用的创作素材，一键带进创作台。"
        aside={<Button variant="outline" onClick={() => navigate('/studio')}>去创作 <ArrowRight className="size-4" /></Button>}>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
          <span><b className="font-display text-base text-primary">{overview?.counts.skills ?? '—'}</b> 套技能</span>
          <span><b className="font-display text-base text-primary">{overview?.counts.references ?? '—'}</b> 张参考</span>
          <span><b className="font-display text-base text-primary">{overview?.counts.recipes ?? '—'}</b> 套公开配方</span>
          <span className="ml-auto">只读浏览 · 套用创作 · 无社交互动</span>
        </div>
      </PageHero>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {([
          ['skills', '技能库', Sparkles],
          ['references', '图片参考', ImageIcon],
          ['recipes', '公开配方', BookOpen],
        ] as const).map(([key, label, Icon]) => (
          <Button key={key} variant={tab === key ? 'secondary' : 'ghost'} size="sm" onClick={() => { setTab(key); setApplied(''); }}>
            <Icon className="size-4" />{label}
          </Button>
        ))}
        <div className="ml-auto flex w-full items-center gap-2 sm:w-auto">
          <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doSearch(); }}
            placeholder={tab === 'skills' ? '搜技能名/描述/标签' : tab === 'recipes' ? '搜配方名/风格' : '搜参考标签'} className="h-9 text-xs" />
          <Button size="sm" onClick={doSearch}><Search className="size-4" />搜索</Button>
        </div>
      </div>

      {tab === 'skills' && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button onClick={() => setCategory('')} className={`rounded-full px-3 py-1 text-[11px] ${!category ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>全部</button>
            {Object.keys(overview?.categories || {}).sort().map((c) => (
              <button key={c} onClick={() => setCategory(c)} className={`rounded-full px-3 py-1 text-[11px] ${category === c ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{c}</button>
            ))}
          </div>
          <SectionHeading title={applied ? `“${applied}” 的技能` : category || '全部技能'} aside="点开查看 20 组真实原图→作品示例" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {skills === null ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-[4/3] rounded-xl" />)
              : skills.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted-foreground">没有匹配的技能</p>
              : skills.map((s) => (
                <button key={s.id} onClick={() => goDetails('skill', s.id)} className="group overflow-hidden rounded-xl border border-border/70 bg-card text-left transition-all hover:-translate-y-0.5 hover:shadow-lg">
                  <span className="block aspect-[4/3] overflow-hidden bg-secondary">
                    {s.cover?.result_url ? <img src={apiUrl(s.cover.result_url)} alt="" className="size-full object-cover" /> : <span className="grid size-full place-items-center text-2xl text-primary/50">✦</span>}
                  </span>
                  <span className="block p-2.5">
                    <span className="block truncate text-sm font-semibold">{s.title_zh}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{s.desc_zh}</span>
                    <span className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground"><span>{s.category}</span><span>{s.pair_count} 组示例</span></span>
                  </span>
                </button>
              ))}
          </div>
        </>
      )}

      {tab === 'references' && (
        <>
          <SectionHeading title={applied ? `“${applied}” 的参考` : '图片参考'} aside="公开授权语料与模板封面，点开看大图与同类" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {refs === null ? Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)
              : refs.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted-foreground">暂无参考图（本地未注入语料）</p>
              : refs.map((r) => (
                <button key={r.id} onClick={() => goDetails('reference', r.id)} className="overflow-hidden rounded-lg border border-border/70 bg-card text-left transition-transform hover:-translate-y-0.5">
                  <img src={apiUrl(r.url)} alt="" className="aspect-square w-full object-cover" />
                  <span className="block truncate p-1.5 text-[10px] text-muted-foreground">{r.tags.slice(0, 2).map((t) => `#${t}`).join(' ') || '参考'}</span>
                </button>
              ))}
          </div>
        </>
      )}

      {tab === 'recipes' && (
        <>
          <SectionHeading title="社区公开配方" aside="创作者主动公开的配方，可直接套用" />
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recipes === null ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
              : recipes.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted-foreground">还没有公开的配方</p>
              : recipes.map((r) => (
                <div key={r.skill_id} className="rounded-xl border border-border/70 bg-card p-3">
                  <p className="truncate text-sm font-semibold">{r.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">{r.prompt}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">{r.model || '默认模型'}</span>
                    <Button size="sm" variant="outline" onClick={() => goDetails('recipe', r.skill_id)}>查看</Button>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}
      {error && <p className="mt-4 text-center text-xs text-destructive">{error}</p>}
    </div>
  );
}
