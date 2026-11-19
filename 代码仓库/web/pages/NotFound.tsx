import { Button } from '@/components/ui/button';

export default function NotFound({ navigate }: { navigate: (to: string) => void }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="font-display text-5xl font-bold text-primary">404</p>
      <h1 className="font-display text-2xl font-bold">这个页面不存在</h1>
      <p className="text-sm text-muted-foreground">地址可能输错了，或页面已经下线。回首页继续把废片变成作品。</p>
      <div className="flex gap-2">
        <Button onClick={() => navigate('/')}>回到首页</Button>
        <Button variant="outline" onClick={() => navigate('/community')}>去社区看看</Button>
      </div>
    </div>
  );
}
