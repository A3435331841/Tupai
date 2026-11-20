import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
import type { Template } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HomeCompare } from '@/components/HomeCompare';
import { GalleryRail, type GalleryItem } from '@/components/GalleryRail';
import HeroIntro from '@/components/HeroIntro';
import WorkFlow from '@/components/WorkFlow';

const HERO_IMAGE = '/home/hero-street.webp';
/** 同一场景的「废片原图」：欠曝/低饱和/柔焦/颗粒，与成品形成强对比 */
const HERO_RAW_IMAGE = '/home/hero-street-raw.webp';

/** 无限画廊的补充作品（模板之外的日常瞬间） */
const GALLERY_EXTRAS: GalleryItem[] = [
  { id: 'coffee', src: '/gallery/g06-coffee.jpg', title: '咖啡午后', ai: true },
  { id: 'food', src: '/gallery/g07-food.jpg', title: '餐桌日记', ai: true },
  { id: 'street', src: '/gallery/g09-street.jpg', title: '城市夜色', ai: true },
  { id: 'pet', src: '/gallery/g10-pet.jpg', title: '猫咪日常', ai: true },
  { id: 'beach', src: '/gallery/g12-beach.jpg', title: '海边黄昏', ai: true },
  { id: 'city', src: '/gallery/g13-city.jpg', title: '都市天际', ai: true },
  { id: 'book', src: '/gallery/g14-book.jpg', title: '旧书时光', ai: true },
  { id: 'plant', src: '/gallery/g15-plant.jpg', title: '绿植静物', ai: true },
  { id: 'market', src: '/gallery/g16-market.png', title: '周末市集', ai: true },
  { id: 'reading', src: '/gallery/g17-reading.png', title: '窗边阅读', ai: true },
  { id: 'bakery', src: '/gallery/g18-bakery.png', title: '暖光美食', ai: true },
  { id: 'dusk', src: '/gallery/g19-street.png', title: '黄昏街道', ai: true },
  { id: 'flowers', src: '/gallery/g20-flowers.png', title: '干花静物', ai: true },
  { id: 'seaside', src: '/gallery/g21-seaside.png', title: '海边漫步', ai: true },
  { id: 'cat', src: '/gallery/g22-cat.png', title: '猫与午后', ai: true },
];

const LOCAL_COVERS: Record<string, string> = {
  'film-daily': '/templates/film-daily.webp',
  'night-bright': '/templates/night-bright.webp',
  'clean-portrait': '/templates/clean-portrait.webp',
  'travel-postcard': '/templates/travel-postcard.webp',
  'magazine-cover': '/templates/magazine-cover.webp',
};

type ShowcaseTemplate = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  cover: string;
  ratio: string;
};

const FALLBACK_TEMPLATES: ShowcaseTemplate[] = [
  {
    id: 'film-daily',
    title: '胶片日常',
    description: '日常随手拍变朋友抓拍式胶片照，暖逆光和细颗粒自然落在生活场景里。',
    tags: ['胶片', '日常', '暖调'],
    cover: '/templates/film-daily.webp',
    ratio: '3:4',
  },
  {
    id: 'night-bright',
    title: '夜景提亮',
    description: '暗光聚餐照救星，自然提亮、降低噪点，也可以切换成雨夜霓虹变体。',
    tags: ['夜景', '提亮', '霓虹'],
    cover: '/templates/night-bright.webp',
    ratio: '3:4',
  },
  {
    id: 'clean-portrait',
    title: '清透人像',
    description: '把杂乱背景变成干净柔和的棚拍感，保留皮肤纹理和人物本身。',
    tags: ['人像', '柔光', '质感'],
    cover: '/templates/clean-portrait.webp',
    ratio: '3:4',
  },
  {
    id: 'travel-postcard',
    title: '旅行明信片',
    description: '灰蒙蒙的旅行随拍变黄金时刻电影感，让远方和空气感一起出现。',
    tags: ['旅行', '黄金时刻', '明信片'],
    cover: '/templates/travel-postcard.webp',
    ratio: '3:4',
  },
  {
    id: 'magazine-cover',
    title: '杂志封面',
    description: '普通照片变黑白雕塑感封面，顶部留白可直接进入排版。',
    tags: ['杂志', '黑白', '留白'],
    cover: '/templates/magazine-cover.webp',
    ratio: '3:4',
  },
];

const SECTION_LABELS = ['开始', '灵感画廊', '创作流程'] as const;
const SECTION_COUNT = SECTION_LABELS.length;

export default function Home({ navigate }: { navigate: (to: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [activeSection, setActiveSection] = useState(0);
  // 连续滚动进度（0 → SECTION_COUNT-1），用于右侧导航进度线与「向下浏览」渐隐
  const [scrollProgress, setScrollProgress] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.templates().then((result) => setTemplates(result.templates)).catch(() => setTemplates(null));
  }, []);

  // 整屏吸附：滚动容器为 main.home-snap-scroll。
  // scroll 事件驱动连续进度与当前区块（比 IntersectionObserver 阈值更平滑、无临界抖动）；
  // IntersectionObserver 仅负责给区块加 is-active 触发入场动画。
  useEffect(() => {
    const scroller = pageRef.current?.parentElement;
    const root = pageRef.current;
    if (!scroller || !root) return;
    scroller.classList.add('snap-ready');
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-snap]'));

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const height = sections[0]?.getBoundingClientRect().height || scroller.clientHeight || 1;
        const raw = scroller.scrollTop / height;
        const clamped = Math.max(0, Math.min(SECTION_COUNT - 1, raw));
        const section = Math.round(clamped);
        setScrollProgress((prev) => (Math.abs(prev - clamped) < 0.005 ? prev : clamped));
        setActiveSection((prev) => (prev === section ? prev : section));
      });
    };
    let rafId = 0;
    scroller.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            (entry.target as HTMLElement).classList.add('is-active');
          }
        }
      },
      { root: scroller, threshold: [0.5, 0.9] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      scroller.removeEventListener('scroll', onScroll);
      observer.disconnect();
      scroller.classList.remove('snap-ready');
    };
  }, []);

  const goToSection = useCallback((index: number) => {
    const root = pageRef.current;
    const target = root?.querySelectorAll<HTMLElement>('[data-snap]')[index];
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);

  // 「向下浏览」：仅在第一屏顶部显示；滚动后淡出，回到顶部自然回归
  const [showScrollHint, setShowScrollHint] = useState(true);
  useEffect(() => {
    setShowScrollHint(scrollProgress < 0.12);
  }, [scrollProgress]);

  // 右侧进度线填充比例（0% → 100%）
  const railFill = (scrollProgress / (SECTION_COUNT - 1)) * 100;

  // memo：保持引用稳定，避免下游 GalleryRail 的动画循环被反复重置
  const showcase = useMemo<ShowcaseTemplate[]>(
    () =>
      templates?.length
        ? templates.map((template) => ({
            id: template.id,
            title: template.title,
            description: template.description,
            tags: template.tags || [],
            cover: LOCAL_COVERS[template.id] || apiUrl(template.cover_url),
            ratio: template.ratio || '3:4',
          }))
        : FALLBACK_TEMPLATES,
    [templates],
  );

  // 画廊数据：模板在前（带 templateId 可做同款）+ 日常瞬间
  // 必须 memo，否则每次渲染生成新数组会让 GalleryRail 的动画 effect 重跑、循环被重置
  const galleryItems = useMemo<GalleryItem[]>(
    () => [
      ...showcase.map((t) => ({ id: t.id, src: t.cover, title: t.title, templateId: t.id, ai: true })),
      ...GALLERY_EXTRAS,
    ],
    [showcase],
  );

  const handleGalleryUse = useCallback(
    (item: GalleryItem) => {
      navigate(item.templateId ? `/studio?template=${item.templateId}` : '/studio');
    },
    [navigate],
  );

  const preview = previewIndex === null ? null : showcase[previewIndex];

  function changePreview(direction: -1 | 1) {
    setPreviewIndex((current) => {
      if (current === null) return null;
      return (current + direction + showcase.length) % showcase.length;
    });
  }

  useEffect(() => {
    if (previewIndex === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') changePreview(-1);
      if (event.key === 'ArrowRight') changePreview(1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewIndex, showcase.length]);

  return (
    <div ref={pageRef} className="home-snap-pages relative w-full">
      {/* 区块一：开场文案 + 对比画面（文案为主，不以单张大图开场） */}
      <section data-snap="0" className="home-snap-section flex min-h-full items-center" aria-label="开场介绍">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:gap-8 sm:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
          <div className="snap-reveal">
            <HeroIntro navigate={navigate} />
          </div>

          <div className="snap-reveal min-w-0" style={{ transitionDelay: '120ms' }}>
            <div className="mx-auto max-w-[520px] lg:max-w-none">
              <HomeCompare before={HERO_RAW_IMAGE} after={HERO_IMAGE} />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-[11px] text-muted-foreground">
              <button
                type="button"
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                onClick={() => navigate('/studio?demo=night&template=night-bright')}
              >
                用这张样例试玩 <ArrowRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => goToSection(1)}
          className={`home-snap-next absolute bottom-5 left-1/2 flex items-center gap-2 rounded-full border border-border/70 bg-card/85 px-4 py-1.5 text-[11px] text-muted-foreground shadow-[0_8px_24px_-14px_rgba(73,50,30,.5)] backdrop-blur ${showScrollHint ? 'is-visible' : ''}`}
          aria-label="前往灵感画廊"
          aria-hidden={!showScrollHint}
          tabIndex={showScrollHint ? 0 : -1}
        >
          向下浏览 <ArrowDown className="home-snap-next-arrow size-3.5" />
        </button>
      </section>

      {/* 区块二：灵感画廊（无限循环，横向滚轮/拖动浏览） */}
      <section id="templates" data-snap="1" className="home-snap-section flex min-h-full items-center border-t border-border/70" aria-labelledby="templates-title">
        <div className="mx-auto w-full max-w-6xl px-4 py-10">
          <div className="snap-reveal flex items-center gap-4">
            <h2 id="templates-title" className="whitespace-nowrap font-display text-2xl sm:text-[2rem]">从一张照片开始</h2>
            <div className="h-px flex-1 bg-border" />
            <span className="hidden text-[11px] text-muted-foreground sm:block">点图片查看，选一个方向</span>
          </div>

          {/* 无限循环画廊：拖动/横向滚轮浏览，点卡片居中放大，Esc 或点空白恢复 */}
          <div className="snap-reveal mt-4 -mx-4 sm:-mx-6" style={{ transitionDelay: '120ms' }}>
            <GalleryRail items={galleryItems} onUse={handleGalleryUse} />
          </div>

          <p className="snap-reveal mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground" style={{ transitionDelay: '200ms' }}>
            <span>拖动或横向滚动浏览</span>
            <span className="hidden sm:inline">点图片放大 · Esc 恢复</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              onClick={() => navigate('/studio')}
            >
              直接开始创作 <ArrowRight className="size-3.5" />
            </button>
          </p>
        </div>
      </section>

      {/* 区块三：创作流程 + 收尾入口 */}
      <section data-snap="2" className="home-snap-section flex min-h-full items-center border-t border-border/70" aria-label="创作流程">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
          <WorkFlow navigate={navigate} />
        </div>
      </section>

      {/* 区块导航：桌面右侧进度轨道，移动端底部胶囊 */}
      <div className="home-snap-nav hidden md:block" aria-label="区块导航">
        <span className="home-snap-nav-track pointer-events-none absolute left-1/2 top-4 w-px -translate-x-1/2 bg-border/80" style={{ height: 'calc(100% - 2rem)' }} aria-hidden="true">
          <span className="home-snap-nav-fill block w-full bg-primary/65" style={{ height: `${railFill}%` }} />
        </span>
        {SECTION_LABELS.map((label, index) => {
          const active = activeSection === index;
          return (
            <button
              key={label}
              type="button"
              onClick={() => goToSection(index)}
              className={`home-snap-nav-dot group relative ${active ? 'is-active' : ''}`}
              aria-label={`前往${label}`}
              aria-current={active ? 'true' : undefined}
            >
              <span className="home-snap-nav-label pointer-events-none absolute right-full mr-2.5 whitespace-nowrap rounded-md bg-card/95 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm">{label}</span>
              <span className="home-snap-nav-core block rounded-full" />
            </button>
          );
        })}
      </div>
      <div className="home-snap-nav-mobile md:hidden" aria-label="区块导航">
        {SECTION_LABELS.map((label, index) => {
          const active = activeSection === index;
          return (
            <button
              key={label}
              type="button"
              onClick={() => goToSection(index)}
              className={`home-snap-nav-mobile-item rounded-full px-3 py-1 text-[11px] ${active ? 'is-active' : ''}`}
              aria-label={`前往${label}`}
              aria-current={active ? 'true' : undefined}
            >
              {label}
            </button>
          );
        })}
      </div>

      <Dialog open={previewIndex !== null} onOpenChange={(open) => { if (!open) setPreviewIndex(null); }}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-4xl">
          {preview && (
            <div className="grid md:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
              <div className="relative min-h-72 overflow-hidden bg-secondary">
                <img
                  src={preview.cover}
                  alt={preview.title + ' 大图预览（AI 生成）'}
                  className="size-full object-cover object-top md:absolute md:inset-0"
                />
                <span className="absolute left-3 top-3 rounded-full bg-stone-950/60 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-md">AI 示意图</span>
              </div>
              <div className="flex flex-col p-6 sm:p-7">
                <DialogHeader className="pr-8">
                  <p className="site-kicker mb-2">Recipe preview</p>
                  <DialogTitle className="font-display text-3xl">{preview.title}</DialogTitle>
                </DialogHeader>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">{preview.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {preview.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}
                </div>
                <div className="mt-5 rounded-xl border border-border/70 bg-secondary/45 p-3 text-xs leading-5 text-muted-foreground">
                  改环境不改主体。生成后可以在创作台继续调整提示词、模型与画幅；原图不会被公开。
                </div>
                <div className="mt-auto flex items-center justify-between gap-3 pt-6">
                  <div className="flex gap-1.5">
                    <Button variant="outline" size="icon" onClick={() => changePreview(-1)} aria-label="上一张模板">
                      <ChevronLeft />
                    </Button>
                    <Button variant="outline" size="icon" onClick={() => changePreview(1)} aria-label="下一张模板">
                      <ChevronRight />
                    </Button>
                  </div>
                  <Button onClick={() => { setPreviewIndex(null); navigate('/studio?template=' + preview.id); }}>
                    做同款 <ArrowRight />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
