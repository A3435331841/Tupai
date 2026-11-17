import { useRoute } from '@/lib/router';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import Home from '@/pages/Home';
import Studio from '@/pages/Studio';
import Legal from '@/pages/Legal';
import { AuthChip } from '@/components/AuthChip';

export default function App() {
  const [path, navigate] = useRoute();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-lg font-bold tracking-tight" aria-label="图派首页">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-sm text-primary-foreground">派</span>
            图派 <span className="hidden text-xs font-normal text-muted-foreground sm:inline">TuPai · 废片变作品</span>
          </button>
          <nav className="ml-auto flex items-center gap-1">
            <Button variant={path === '/' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate('/')}>首页</Button>
            <Button variant={path === '/studio' ? 'secondary' : 'ghost'} size="sm" onClick={() => navigate('/studio')}>创作台</Button>
            <Button variant="ghost" size="sm" className="hidden text-muted-foreground sm:inline-flex" onClick={() => navigate('/legal')}>隐私与 AI 说明</Button>
            <AuthChip />
          </nav>
        </div>
      </header>
      <main className="flex-1">
        {path === '/studio' ? <Studio navigate={navigate} /> : path === '/legal' ? <Legal /> : <Home navigate={navigate} />}
      </main>
      <footer className="border-t border-border/70 py-6 text-center text-xs text-muted-foreground">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
          <span>图派 TuPai · 2026 Qoder 创造大赛 LifeHack 作品</span>
          <button className="underline-offset-2 hover:underline" onClick={() => navigate('/legal')}>隐私与 AI 说明</button>
          <span>结果图均为 AI 生成 · 原图全程私密</span>
        </div>
      </footer>
      <Toaster position="top-center" richColors />
    </div>
  );
}