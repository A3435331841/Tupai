import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, apiUrl } from '@/lib/api';
import type { Template } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HomeCompare } from '@/components/HomeCompare';

const HERO_IMAGE = '/home/hero-street.webp';

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

export default function Home({ navigate }: { navigate: (to: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    api.templates().then((result) => setTemplates(result.templates)).catch(() => setTemplates(null));
  }, []);

  const showcase: ShowcaseTemplate[] = templates?.length
    ? templates.map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        tags: template.tags || [],
        cover: LOCAL_COVERS[template.id] || apiUrl(template.cover_url),
        ratio: template.ratio || '3:4',
      }))
    : FALLBACK_TEMPLATES;

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
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <section className="grid gap-8 py-8 sm:py-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12 lg:py-14">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-primary">AI 影像二次创作 · 原图可留私</p>
          <h1 className="mt-4 max-w-xl text-[3.3rem] font-bold leading-[1.08] tracking-tight sm:text-[4.25rem]">
            废片变作品，<br />原图可以<br /><span className="text-primary">只留给自己。</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">
            让每一张日常，都有作品的可能。上传照片，或只说一句话，剩下的交给图派。
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" onClick={() => navigate('/studio')}>
              开始创作 <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/studio?demo=night&template=night-bright')}>
              一键试玩 · 夜景提亮
            </Button>
          </div>
          <p className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>游客可用全流程</span>
            <span>原图不公开</span>
            <span>下载带 AI 标识</span>
          </p>
        </div>

        <div className="min-w-0">
          <HomeCompare before={HERO_IMAGE} after={HERO_IMAGE} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>鼠标移入画面后左右拖动；松开后，两枚相纸会重新出现。</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              onClick={() => navigate('/studio?demo=night&template=night-bright')}
            >
              用这张样例试玩 <ArrowRight className="size-3.5" />
            </button>
          </div>
        </div>
      </section>

      <section id="templates" className="mt-8 border-t border-border/70 pt-8 sm:mt-10" aria-labelledby="templates-title">
        <div className="flex items-center gap-4">
          <h2 id="templates-title" className="whitespace-nowrap font-display text-2xl sm:text-[2rem]">从一张照片开始</h2>
          <div className="h-px flex-1 bg-border" />
          <span className="hidden text-[11px] text-muted-foreground sm:block">点图片查看，选一个方向</span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-5 md:gap-x-4">
          {showcase.map((template, index) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setPreviewIndex(index)}
              aria-haspopup="dialog"
              aria-label={'查看模板 ' + template.title + ' 大图'}
              className="group min-w-0 text-left"
            >
              <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
                <img
                  src={template.cover}
                  alt={template.title + ' 效果示意（AI 生成）'}
                  loading="lazy"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.045]"
                />
                <span className="absolute left-2 top-2 rounded-full bg-stone-950/55 px-2 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md">AI 示意</span>
                <span className="absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-stone-950/62 to-transparent px-2.5 pb-2 pt-8 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
                  查看 <ArrowRight className="ml-1 size-3" />
                </span>
              </div>
              <p className="mt-3 text-center font-display text-base font-semibold">{template.title}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-11 border-y border-border/70" aria-label="创作流程">
        <div className="grid sm:grid-cols-3">
          {[
            ['01', '上传照片'],
            ['02', '选择灵感'],
            ['03', '收获作品'],
          ].map(([number, label], index) => (
            <div
              key={number}
              className={`flex items-center justify-center gap-4 py-5 ${index > 0 ? 'border-t border-border/70 sm:border-l sm:border-t-0' : ''}`}
            >
              <span className="font-display text-3xl font-semibold tracking-tight text-primary">{number}</span>
              <span className="text-base font-medium">{label}</span>
            </div>
          ))}
        </div>
      </section>

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
