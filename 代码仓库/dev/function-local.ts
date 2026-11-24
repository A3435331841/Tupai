// Local-only entry with credential-free fakes; never packaged (outside server/).
import { application } from '../server/routes.mjs';
import { fakeDb, fakeStorage } from './fakes.mjs';

// 未授予 --allow-env 时（README 与 `npm run dev:function` 的既有命令都不带该权限）静默降级，
// 避免本地联调一启动就以 NotCapable 退出。
function readEnv(key: string): string | undefined {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
}

// 本地只暴露维护 token，便于验证清理与人工复核；其余密钥仍为空以走 mock。
const env = {
  get: (key: string) => (key === 'MAINTENANCE_TOKEN' ? readEnv('MAINTENANCE_TOKEN') : undefined),
};

const handle = application({ db: fakeDb(), storage: fakeStorage(), env, fetchImpl: fetch }) as
  (ctx: { request: Request; requestId: string }) => Promise<Response>;

// PORT 可覆盖（默认 8000），供验收门禁在独立端口起干净实例，避免常驻实例的配额/状态污染。
Deno.serve({ hostname: '127.0.0.1', port: Number(readEnv('PORT') ?? 8000) }, (request) =>
  handle({ request, requestId: crypto.randomUUID() }));