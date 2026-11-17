import { createDatabaseClient, createSiteContext, errorResponse } from './_qoder/backend.mjs';
import { createStorageClient } from './_qoder/storage.mjs';
import { application } from './routes.mjs';

const handle = application({
  db: createDatabaseClient(),
  storage: createStorageClient(),
  env: { get: (name) => Deno.env.get(name) },
  fetchImpl: fetch,
});

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});