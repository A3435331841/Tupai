import { useEffect, useRef, useState } from 'react';
import { api, loginUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';

/**
 * 主站顶部栏（设计稿定稿版，四个主页面共用）。
 * - 由 App.tsx 在首页/创作台/资产库/社区统一渲染；仅隐私页 /legal 沿用旧的简易 header。
 * - 导航选中态基于 path 自动高亮，无需各页面单独处理。
 * - Logo 使用放大图标 + 突出「废片变作品」的专用 SVG。
 * - 导航项带线性图标；选中态＝橙棕文字+图标+底部短下划线，悬停＝极淡暖底（无整块填充）。
 * - 右侧：胶囊搜索框 / 铃铛(红点) / 帮助问号 / 描边登录按钮。
 * - 响应式：窄屏隐藏搜索与帮助、导航横向滚动，宽屏三栏居中。
 */

type Me = { logged_in: boolean; user: { name: string; picture: string } | null };

/* ------------------------------- 图标集合 ------------------------------- */

type IconProps = { className?: string };
const ico = 'stroke-current';

function HomeIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path className={ico} d="M3.5 10.6 12 3.8l8.5 6.8" />
      <path className={ico} d="M5.6 9.4V20h12.8V9.4" />
      <path className={ico} d="M10 20v-5.6h4V20" />
    </svg>
  );
}
function SparkleIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path className={ico} d="M11 3.2 12.6 8 17.4 9.6 12.6 11.2 11 16 9.4 11.2 4.6 9.6 9.4 8 11 3.2Z" />
      <path className={ico} d="M18 14.5 18.8 17 21.3 17.8 18.8 18.6 18 21.1 17.2 18.6 14.7 17.8 17.2 17 18 14.5Z" />
    </svg>
  );
}
function FolderIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path className={ico} d="M3.5 7.2A1.7 1.7 0 0 1 5.2 5.5h3.6l2 2h7.9a1.7 1.7 0 0 1 1.7 1.7v8.6a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7V7.2Z" />
    </svg>
  );
}
function UsersIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle className={ico} cx="9.2" cy="8.2" r="3.1" />
      <path className={ico} d="M3.6 19c.5-3 2.7-4.7 5.6-4.7s5.1 1.7 5.6 4.7" />
      <path className={ico} d="M16.2 5.6a3 3 0 0 1 0 5.5" />
      <path className={ico} d="M17.4 14.6c1.9.5 3 1.9 3.3 4.4" />
    </svg>
  );
}
function SearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.9" strokeLinecap="round" className={className}>
      <circle className={ico} cx="10.8" cy="10.8" r="6.3" />
      <path className={ico} d="m15.6 15.6 4.2 4.2" />
    </svg>
  );
}
function BellIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path className={ico} d="M6.2 9.4a5.8 5.8 0 0 1 11.6 0c0 4.8 2 5.8 2 5.8H4.2s2-1 2-5.8Z" />
      <path className={ico} d="M10 18.6a2.1 2.1 0 0 0 4 0" />
    </svg>
  );
}
function HelpIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle className={ico} cx="12" cy="12" r="8.6" />
      <path className={ico} d="M9.7 9.4a2.4 2.4 0 1 1 3.6 2.1c-.9.5-1.3 1-1.3 2" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

const NAV_ITEMS = [
  { route: '/', label: '首页', Icon: HomeIcon },
  { route: '/studio', label: '创作台', Icon: SparkleIcon },
  { route: '/library', label: '资产库', Icon: FolderIcon },
  { route: '/community', label: '社区', Icon: UsersIcon },
] as const;

/* ------------------------------- 登录按钮 ------------------------------- */

function HomeAuth() {
  const [me, setMe] = useState<Me | null>(null);
  const bound = useRef(false);
  useEffect(() => {
    let alive = true;
    api.me()
      .then((m) => {
        if (alive) setMe(m);
        // 登录后把本会话的游客资产/配方/任务迁移到账号（幂等，迁完为 0）
        if (m.logged_in && !bound.current) { bound.current = true; api.bind().catch(() => {}); }
      })
      .catch(() => { if (alive) setMe({ logged_in: false, user: null }); });
    return () => { alive = false; };
  }, []);

  const goLogin = () => { window.location.href = loginUrl(); };

  if (!me) return <span className="inline-block h-9 w-[74px]" aria-hidden="true" />;
  if (me.logged_in) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground"
        title="已登录 Qoder 账号，资产可跨设备"
      >
        <span className="size-1.5 rounded-full bg-primary" />
        已登录{me.user?.name ? ` · ${me.user.name}` : ''}
      </span>
    );
  }
  // 设计稿：描边圆角胶囊登录
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={goLogin}
      className="home-login-pill h-9 px-5 text-[15px] font-semibold tracking-wide"
    >
      登录
    </Button>
  );
}

/* -------------------------------- 组件主体 ------------------------------- */

export default function SiteHeader({ path, navigate }: { path: string; navigate: (to: string) => void }) {
  return (
    <header className="site-header sticky top-0 z-40 border-b border-border/70">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:h-[76px] md:flex-nowrap md:py-0">
        {/* Logo：放大图标的专用字标 */}
        <button type="button" onClick={() => navigate('/')} className="flex shrink-0 items-center" aria-label="图派首页">
          <img
            src="/brand/logo-horizontal-home.svg"
            alt="图派 TuPai · 废片变作品"
            className="h-12 w-auto sm:h-[56px]"
          />
        </button>

        {/* 导航：线性图标 + 短下划线选中态 + 淡悬停暖底 */}
        <nav className="order-3 flex w-full min-w-0 items-center justify-start gap-0.5 overflow-x-auto scrollbar-none sm:justify-center md:order-none md:w-auto md:flex-1" aria-label="主导航">
          {NAV_ITEMS.map(({ route, label, Icon }) => {
            const active = path === route;
            return (
              <button
                key={route}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(route)}
                className={
                  'relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[15px] transition-colors ' +
                  (active
                    ? 'font-semibold text-[#c0562f]'
                    : 'font-medium text-[#4a4036] hover:bg-[#f6ecdf] hover:text-[#7a6a58]')
                }
              >
                <Icon className={`size-[19px] ${active ? 'text-[#c0562f]' : 'text-[#6b5d4e]'}`} />
                <span className="whitespace-nowrap">{label}</span>
                {active && (
                  <span className="absolute -bottom-px left-1/2 h-[3px] w-6 -translate-x-1/2 rounded-full bg-[#c0562f]" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </nav>

        {/* 右侧工具区：搜索 / 铃铛 / 帮助 / 登录 */}
        <div className="ml-auto flex shrink-0 items-center gap-2.5 md:ml-0">
          <label className="hidden h-9 w-[248px] items-center gap-2 rounded-full border border-border bg-background/70 px-3.5 transition-colors focus-within:border-primary/60 lg:flex">
            <SearchIcon className="size-[17px] shrink-0 text-[#7d6e5e]" />
            <input
              type="search"
              placeholder="搜索作品、功能或案例..."
              aria-label="搜索作品、功能或案例"
              className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-[#9a8b7a]"
            />
          </label>
          <button
            type="button"
            aria-label="通知"
            className="relative rounded-full p-1.5 text-[#6b5d4e] transition-colors hover:bg-[#f6ecdf] hover:text-[#7a6a58]"
          >
            <BellIcon className="size-[19px]" />
            <span className="absolute right-1 top-1 size-2 rounded-full bg-[#e0342b] ring-2 ring-[#faf7f2]" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="帮助"
            className="hidden rounded-full p-1 text-[#6b5d4e] transition-colors hover:bg-[#f6ecdf] hover:text-[#7a6a58] sm:block"
          >
            <HelpIcon className="size-[21px]" />
          </button>
          <HomeAuth />
        </div>
      </div>
    </header>
  );
}
