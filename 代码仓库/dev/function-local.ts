// Local-only entry with credential-free fakes; never packaged (outside server/).
import { application } from '../server/routes.mjs';
import { fakeDb, fakeStorage, fakeEnv } from './fakes.mjs';

const handle = application({ db: fakeDb(), storage: fakeStorage(), env: fakeEnv(), fetchImpl: fetch }) as
  (ctx: { request: Request; requestId: string }) => Promise<Response>;

Deno.serve({ hostname: '127.0.0.1', port: 8000 }, (request) =>
  handle({ request, requestId: crypto.randomUUID() }));