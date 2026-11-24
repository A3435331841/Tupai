// Credential-free local fakes for dev/function-local.ts. In-memory, single-process.
export function fakeDb({ maxLimit = 1000 } = {}) {
  const tables = new Map();
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  function query(name) {
    const filters = [];
    let orderCol = null, orderAsc = true, limitN = null, offsetN = 0, wantCount = false, limitError = false;
    const api = {
      select(_cols, opts) { if (opts?.count === 'exact') wantCount = true; return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      in(col, vals) { const set = new Set(vals || []); filters.push((r) => set.has(r[col])); return api; },
      is(col, val) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return api; },
      gte(col, val) { filters.push((r) => r[col] != null && r[col] >= val); return api; },
      order(col, opts) { orderCol = col; orderAsc = opts?.ascending !== false; return api; },
      limit(n) { if (n > maxLimit) limitError = true; limitN = n; return api; },
      range(from, to) { const n = to - from + 1; if (n > maxLimit) limitError = true; offsetN = from; limitN = n; return api; },
      insert(row) {
        if (Array.isArray(row)) {
          const result = { data: null, error: { message: 'insert expects a single object' } };
          return { select() { return Promise.resolve(result); }, then(resolve) { resolve(result); } };
        }
        const inserted = { created_at: new Date().toISOString(), ...row };
        table(name).push(inserted);
        const result = { data: [inserted], error: null };
        return { select() { return Promise.resolve(result); }, then(resolve) { resolve(result); } };
      },
      insertIfAbsent(row, opts) {
        const key = opts?.onConflict || 'id';
        const exists = table(name).some((r) => r[key] === row[key]);
        if (exists) return Promise.resolve({ data: [], error: null });
        return api.insert(row);
      },
      update(patch) {
        let returnRows = false;
        return {
          eq(col, val) { filters.push((r) => r[col] === val); return this; },
          is(col, val) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return this; },
          select() { returnRows = true; return this; },
          then(resolve) {
            const matched = table(name).filter((r) => filters.every((f) => f(r)));
            matched.forEach((r) => Object.assign(r, patch));
            resolve({ data: returnRows ? matched : null, error: null });
          },
        };
      },
      delete() {
        return {
          eq(col, val) { filters.push((r) => r[col] === val); return this; },
          then(resolve) {
            const arr = table(name);
            const keep = arr.filter((r) => !filters.every((f) => f(r)));
            tables.set(name, keep);
            resolve({ data: [], error: null });
          },
        };
      },
      then(resolve) {
        if (limitError) { resolve({ data: null, error: { message: 'limit exceeds database maximum' } }); return; }
        let matched = table(name).filter((r) => filters.every((f) => f(r)));
        const count = matched.length;
        if (orderCol) matched = [...matched].sort((a, b) => (a[orderCol] > b[orderCol] ? 1 : -1) * (orderAsc ? 1 : -1));
        if (offsetN) matched = matched.slice(offsetN);
        if (limitN != null) matched = matched.slice(0, limitN);
        resolve({ data: matched, error: null, count: wantCount ? count : null });
      },
    };
    return api;
  }
  return { from: (name) => query(name) };
}

export function fakeStorage() {
  const objects = new Map();
  return {
    async upload(path, bytes, opts) {
      if (objects.has(path) && !opts?.upsert) throw new Error('exists');
      objects.set(path, { bytes: new Uint8Array(bytes), mime: opts?.contentType || 'application/octet-stream' });
      return { ok: true };
    },
    async download(path) {
      const obj = objects.get(path);
      if (!obj) throw Object.assign(new Error('not found'), { code: 'storage_object_not_found' });
      return new Response(obj.bytes, { headers: { 'content-type': obj.mime } });
    },
    async remove(paths) { paths.forEach((p) => objects.delete(p)); return { ok: true }; },
    async createSignedUrl(path) { return { signedUrl: `/fake-storage/${path}` }; },
    async createSignedUploadUrl(path) { return { signedUrl: `/fake-storage/${path}` }; },
    async list() { return []; },
  };
}

export function fakeEnv() {
  return { get: () => undefined };
}