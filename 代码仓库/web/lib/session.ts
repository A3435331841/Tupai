const KEY = 'tupai-session-id';

export function sessionId(): string {
  let sid = localStorage.getItem(KEY);
  if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) {
    sid = crypto.randomUUID();
    localStorage.setItem(KEY, sid);
  }
  return sid;
}