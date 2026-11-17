import { useEffect, useState } from 'react';
import { api, apiUrl } from '@/lib/api';
import type { Template } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';

const DEMO_TEXT = '想要胶片感的旅行照，傍晚暖光，人物不变';

export default function Home({ navigate }: { navigate: (to: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.templates().then((r) => setTemplates(r.templates)).catch(() => setError(true));
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <section className="py-10 sm:py-14">
        <p className="mb-3 text-sm font-medium text-primary">拍照不好看，也能有拿得出手的作品</p>
        <h1 className="max-w-2xl text-3xl font-bold leading-tight tracking-tight sm:text-5xl">
          废片变作品，<br className="sm:hidden" />原图可以只留给自己。
        </h1>
        <p className="mt-4 max-w-xl text-base text-muted-foreground">
          上传一张日常照片，或只说一句话。图派自动优化提示词、推荐相似模板，真实 AI 出图——
          不用会写提示词，也不用公开原图。满意的配方还能打包成 Skills 带走复用。
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => navigate('/studio')}>开始创作</Button>
          <Button size="lg" variant="outline" onClick={() => navigate('/studio?demo=night')}>
            一键试玩 · 样例废片
          </Button>
          <Button size="lg" variant="ghost" className="text-muted-foreground" onClick={() => navigate(`/studio?demo=text&text=${encodeURIComponent(DEMO_TEXT)}`)}>
            文字试玩
          </Button>
        </div>
        <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <li>✓ 游客免登录全流程</li>
          <li>✓ 原图全程私密，不公开</li>
          <li>✓ 结果带 AI 生成标识</li>
          <li>✓ 配方导出 JSON + SKILL.md</li>
        </ul>
      </section>

      <section aria-label="模板库">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-semibold tracking-tight">首批模板 · 一点即套用</h2>
          <span className="text-xs text-muted-foreground">改环境不改主体，人物保持原样</span>
        </div>
        {error && (
          <Card className="p-6 text-sm text-muted-foreground">
            模板加载失败。
            <Button variant="link" size="sm" onClick={() => { setError(false); api.templates().then((r) => setTemplates(r.templates)).catch(() => setError(true)); }}>重试</Button>
          </Card>
        )}
        {!templates && !error && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="aspect-[3/4] w-full rounded-xl" />)}
          </div>
        )}
        {templates && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {templates.map((t) => (
              <Card key={t.id} className="group overflow-hidden p-0 transition-shadow hover:shadow-md">
                <button
                  className="block w-full text-left"
                  onClick={() => navigate(`/studio?template=${t.id}`)}
                  aria-label={`套用模板 ${t.title}`}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden bg-secondary">
                    <img
                      src={apiUrl(t.cover_url)}
                      alt={`${t.title} 效果示意（AI 生成）`}
                      className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      loading="lazy"
                      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }}
                    />
                    <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">AI 示意</span>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{t.title}</h3>
                      <span className="text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">做同款 →</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(t.tags || []).slice(0, 3).map((tag) => <Badge key={tag} variant="secondary" className="text-[10px]">{tag}</Badge>)}
                    </div>
                  </div>
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          { t: '① 上传或说一句话', d: '不会写提示词没关系，视觉理解自动产出 2–4 条候选，每条都带「人物不变」保留约束。' },
          { t: '② 相似模板预览', d: '按画面内容匹配库内模板与 Skills，封面预览 + 一键同款，参数继承但随时可改。' },
          { t: '③ 出片并带走配方', d: '修前修后对比、下载带 AI 标识；配方导出 JSON 与 Qoder SKILL.md，下次一键复用。' },
        ].map((x) => (
          <Card key={x.t} className="p-5">
            <h3 className="font-semibold">{x.t}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{x.d}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}