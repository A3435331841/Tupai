import { rows } from './util.mjs';

const MIN_INTERVAL_MS = 10_000;
const COOLDOWN_429_MS = 60_000;
const COOLDOWN_402_MS = 3_600_000;

// Key values live only in Secrets; DB stores alias/site/timing state shared across edge instances.
export function createKeyScheduler(db, env) {
  function pools() {
    const out = [];
    for (const [name, site, base] of [
      ['AGNES_KEYS_CN', 'cn', 'https://api.agnes-ai.cn/v1'],
      ['AGNES_KEYS_INTL', 'intl', 'https://apihub.agnes-ai.com/v1'],
    ]) {
      let entries = [];
      try { entries = JSON.parse(env.get(name) || '[]'); } catch { entries = []; }
      if (!Array.isArray(entries)) continue;
      for (const e of entries) {
        if (e && typeof e.alias === 'string' && typeof e.key === 'string' && e.key.startsWith('sk-')) {
          out.push({ alias: e.alias, key: e.key, site, base });
        }
      }
    }
    return out;
  }

  async function syncState(pool) {
    for (const k of pool) {
      await db.from('key_state').insertIfAbsent(
        { alias: k.alias, site: k.site, disabled: false },
        { onConflict: 'alias' },
      );
    }
  }

  async function acquire() {
    const pool = pools();
    if (!pool.length) return null;
    await syncState(pool);
    const states = rows(await db.from('key_state').select('alias,site,cooldown_until,last_used,disabled')) || [];
    const byAlias = new Map(states.map((s) => [s.alias, s]));
    const now = Date.now();
    const eligible = pool.filter((k) => {
      const s = byAlias.get(k.alias);
      if (!s || s.disabled) return false;
      if (s.cooldown_until && new Date(s.cooldown_until).getTime() > now) return false;
      if (s.last_used && now - new Date(s.last_used).getTime() < MIN_INTERVAL_MS) return false;
      return true;
    });
    // Prefer the least recently used key.
    eligible.sort((a, b) => {
      const ta = byAlias.get(a.alias)?.last_used ? new Date(byAlias.get(a.alias).last_used).getTime() : 0;
      const tb = byAlias.get(b.alias)?.last_used ? new Date(byAlias.get(b.alias).last_used).getTime() : 0;
      return ta - tb;
    });
    for (const k of eligible) {
      const s = byAlias.get(k.alias);
      const stamp = new Date(now).toISOString();
      const q = db.from('key_state').update({ last_used: stamp }).eq('alias', k.alias);
      const claimed = rows(s.last_used ? await q.eq('last_used', s.last_used).select() : await q.is('last_used', null).select());
      if (claimed?.length) return { ...k, release: makeRelease(k.alias) };
    }
    return null;
  }

  function makeRelease(alias) {
    return async (outcome) => {
      const patch = {};
      if (outcome === 429) patch.cooldown_until = new Date(Date.now() + COOLDOWN_429_MS).toISOString();
      else if (outcome === 402) patch.cooldown_until = new Date(Date.now() + COOLDOWN_402_MS).toISOString();
      else if (outcome === 401) patch.disabled = true;
      if (Object.keys(patch).length) {
        await db.from('key_state').update(patch).eq('alias', alias);
      }
    };
  }

  return { acquire, configured: () => pools().length > 0 };
}