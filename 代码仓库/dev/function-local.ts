// Local-only entry with credential-free fakes; never packaged (outside server/).
import { application } from '../server/routes.mjs';
import { fakeDb, fakeStorage } from './fakes.mjs';

// 本地只暴露维护 token，便于验证清理与人工复核；其余密钥仍为空以走 mock。
const env = {
  get: (key: string) => (key === 'MAINTENANCE_TOKEN' ? Deno.env.get('MAINTENANCE_TOKEN') : undefined),
};

const handle = application({ db: fakeDb(), storage: fakeStorage(), env, fetchImpl: fetch }) as
  (ctx: { request: Request; requestId: string }) => Promise<Response>;

Deno.serve({ hostname: '127.0.0.1', port: 8000 }, (request) =>
  handle({ request, requestId: crypto.randomUUID() }));