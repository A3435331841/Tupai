import { useRoute } from '@/lib/router';
import { Toaster } from '@/components/ui/sonner';
import Home from '@/pages/Home';
import Studio from '@/pages/Studio';
import Legal from '@/pages/Legal';
import Library from '@/pages/Library';
import Community from '@/pages/Community';
import { AuthChip } from '@/components/AuthChip';

export default function App() {
  const [path, navigate] = useRoute();
  const navItems = [
    ['/', '首页'],
    ['/studio', '创作台'],
    ['/library', '资产库'],
    ['/community', '社区'],
  ] as const;

  return (
    <div className="flex min-h-dvh w-full min-w-0 flex-col">
      <header className="site-header sticky top-0 z-40 border-b border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:grid md:h-16 md:grid-cols-[1fr_auto_1fr] md:flex-nowrap md:py-0">
          <button onClick={() => navigate('/')} className="flex shrink-0 items-center" aria-label="图派首页">
            <img src="/brand/logo-horizontal.svg" alt="图派 TuPai" className="h-9 w-auto sm:h-10" />
          </button>
          <nav className="order-3 flex w-full min-w-0 items-center gap-1 overflow-x-auto scrollbar-none md:order-none md:w-auto md:justify-center" aria-label="主导航">
            {navItems.map(([route, label]) => (
              <button
                key={route}
                type="button"
                aria-current={path === route ? 'page' : undefined}
                onClick={() => navigate(route)}
                className={
                  'relative px-3 py-2 text-sm transition-colors ' +
                  (path === route
                    ? 'font-semibold text-foreground after:absolute after:inset-x-3 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary'
                    : 'text-muted-foreground hover:text-foreground')
                }
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center justify-end gap-2 md:ml-0">
            <AuthChip />
          </div>
        </div>
      </header>
      <main className="w-full min-w-0 flex-1">
        {path === '/studio' ? <Studio navigate={navigate} /> : path === '/library' ? <Library navigate={navigate} /> : path === '/community' ? <Community navigate={navigate} /> : path === '/legal' ? <Legal /> : <Home navigate={navigate} />}
      </main>
      <footer className="site-footer border-t border-border/70 py-6 text-center text-xs text-muted-foreground">
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
