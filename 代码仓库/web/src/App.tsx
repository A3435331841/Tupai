import { useRoute } from '@/lib/router';
import { Toaster } from '@/components/ui/sonner';
import Home from '@/pages/Home';
import Studio from '@/pages/BotStudio';
import Legal from '@/pages/Legal';
import Library from '@/pages/Library';
import Community from '@/pages/Community';
import SiteHeader from '@/components/SiteHeader';
import LegacyHeader from '@/components/LegacyHeader';

export default function App() {
  const [path, navigate] = useRoute();
  const isHome = path === '/';
  const isStudio = path === '/studio';
  const fixed = isHome || isStudio;

  return (
    <div className={`flex w-full min-w-0 flex-col ${fixed ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}>
      {path === '/legal' ? (
        // 隐私页沿用旧的简易 header，避免法规说明页承载搜索/通知等主站功能
        <LegacyHeader path={path} navigate={navigate} />
      ) : (
        // 首页 / 创作台 / 资产库 / 社区：统一使用主站顶部栏，选中态按 path 自动高亮
        <SiteHeader path={path} navigate={navigate} />
      )}
      <main className={`w-full min-w-0 flex-1 min-h-0 ${isHome ? 'home-snap-scroll overflow-y-auto overscroll-contain' : isStudio ? 'overflow-hidden' : ''}`}>
        {path === '/studio' ? <Studio navigate={navigate} /> : path === '/library' ? <Library navigate={navigate} /> : path === '/community' ? <Community navigate={navigate} /> : path === '/legal' ? <Legal /> : <Home navigate={navigate} />}
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
