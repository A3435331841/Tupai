import { useEffect, useRef, useState } from 'react';
import { api, loginUrl } from '@/lib/api';
import { Button } from '@/components/ui/button';

type Me = { logged_in: boolean; user: { name: string; picture: string } | null };

export function AuthChip() {
  const [me, setMe] = useState<Me | null>(null);
  const bound = useRef(false);
  useEffect(() => {
    api.me()
      .then((m) => {
        setMe(m);
        // 登录后把本会话的游客资产/配方/任务迁移到账号（幂等，迁完为 0）
        if (m.logged_in && !bound.current) { bound.current = true; api.bind().catch(() => {}); }
      })
      .catch(() => setMe({ logged_in: false, user: null }));
  }, []);

  if (!me) return null;
  if (me.logged_in) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground" title="已登录 Qoder 账号，资产可跨设备">
        <span className="size-1.5 rounded-full bg-primary" />
        已登录{me.user?.name ? ` · ${me.user.name}` : ''}
      </span>
    );
  }
  return (
    <Button variant="outline" size="sm" onClick={() => { window.location.href = loginUrl(); }}>
      登录
    </Button>
  );
}