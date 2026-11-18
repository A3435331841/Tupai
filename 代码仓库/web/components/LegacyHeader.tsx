import { AuthChip } from '@/components/AuthChip';

/**
 * 隐私页 /legal 专用的简易顶部栏（保留历史外观）。
 * path 声明为 string 而非字面量联合，避免在调用方被收窄后产生 TS2367。
 */
const NAV_ITEMS = [
  ['/', '首页'],
  ['/studio', '创作台'],
  ['/library', '资产库'],
  ['/community', '社区'],
] as const;

export default function LegacyHeader({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 md:grid md:h-16 md:grid-cols-[1fr_auto_1fr] md:flex-nowrap md:py-0">
        <button onClick={() => navigate('/')} className="flex shrink-0 items-center" aria-label="图派首页">
          <img src="/brand/logo-horizontal.svg" alt="图派 TuPai" className="h-9 w-auto sm:h-10" />
        </button>
        <nav className="order-3 flex w-full min-w-0 items-center gap-1 overflow-x-auto scrollbar-none md:order-none md:w-auto md:justify-center" aria-label="主导航">
          {NAV_ITEMS.map(([route, label]) => (
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
  );
}
