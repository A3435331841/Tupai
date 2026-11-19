import { lazy, Suspense } from 'react';
import { useRoute } from '@/lib/router';
import { Toaster } from '@/components/ui/sonner';
import Home from '@/pages/Home';
import Legal from '@/pages/Legal';
import SiteHeader from '@/components/SiteHeader';

// 重页面按需加载，首屏只保留首页与顶栏；直接访问深链时会自动拉取对应 chunk。
const Studio = lazy(() => import('@/pages/BotStudio'));
const Library = lazy(() => import('@/pages/Library'));
const Community = lazy(() => import('@/pages/Community'));
const WorkDetail = lazy(() => import('@/pages/WorkDetail'));
const NotFound = lazy(() => import('@/pages/NotFound'));

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10" aria-busy="true" aria-label="页面加载中">
      <div className="h-6 w-40 animate-pulse rounded bg-secondary" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-secondary" />)}
      </div>
    </div>
  );
}

export default function App() {
  const [path, navigate] = useRoute();
  const isHome = path === '/';
  const isStudio = path === '/studio';
  const workId = path.match(/^\/work\/(wk_[0-9a-f]{24})$/)?.[1] || null;
  const fixed = isHome || isStudio;

  return (
    <div className={`flex w-full min-w-0 flex-col ${fixed ? (isStudio ? 'min-h-dvh lg:h-dvh lg:overflow-hidden' : 'h-dvh overflow-hidden') : 'min-h-dvh'}`}>
      {/* 全部页面统一主站顶部栏，选中态按 path 自动高亮 */}
      <SiteHeader path={path} navigate={navigate} />
      <main className={`w-full min-w-0 flex-1 min-h-0 ${isHome ? 'home-snap-scroll overflow-y-auto overscroll-contain' : isStudio ? 'overflow-y-auto lg:overflow-hidden' : ''}`}>
        <Suspense fallback={<PageFallback />}>
          {isStudio ? <Studio navigate={navigate} />
            : path === '/library' ? <Library navigate={navigate} />
              : path === '/community' ? <Community navigate={navigate} />
                : path === '/legal' ? <Legal />
                  : workId ? <WorkDetail key={workId} id={workId} navigate={navigate} />
                    : isHome ? <Home navigate={navigate} />
                      : <NotFound navigate={navigate} />}
        </Suspense>
      </main>
      <footer className={`site-footer shrink-0 border-t border-border/70 text-center text-xs text-muted-foreground ${fixed ? 'hidden' : 'py-6'}`}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
          <img src="/brand/logo-icon.svg" alt="" aria-hidden="true" className="size-5" />
          <span>图派 TuPai · 2026 Qoder 创造大赛 LifeHack 作品</span>
          <button className="underline-offset-2 hover:underline" onClick={() => navigate('/legal')}>隐私与 AI 说明</button>
          <span>结果图均为 AI 生成 · 原图全程私密</span>
        </div>
      </footer>
      <Toaster position="top-center" richColors />
    </div>
  );
}
