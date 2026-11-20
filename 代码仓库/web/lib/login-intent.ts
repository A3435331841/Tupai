// 登录回程草稿：401 跳转登录前把未提交内容暂存到 sessionStorage，登录回到本页后恢复
export type LoginIntent =
  | { kind: 'comment'; workId: string; text: string; at: number }
  | { kind: 'report'; workId: string; reason: string; at: number }
  | { kind: 'publish'; title: string; tags: string; at: number };

const KEY = 'tupai:login-intent';
const TTL_MS = 30 * 60 * 1000;

type WithoutAt<T> = T extends unknown ? Omit<T, 'at'> : never;

export function saveLoginIntent(intent: WithoutAt<LoginIntent>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch { /* 隐私模式/禁用存储时静默降级 */ }
}

export function takeLoginIntent(): LoginIntent | null {
  const value = peekLoginIntent();
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  return value;
}

/** 只读取不消费：页面先判断类别，避免误吞其它页面的草稿 */
export function peekLoginIntent(): LoginIntent | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as LoginIntent;
    if (!value || typeof value !== 'object' || !('kind' in value)) return null;
    if (Date.now() - (value.at || 0) > TTL_MS) return null;
    return value;
  } catch { return null; }
}
