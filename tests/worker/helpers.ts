/**
 * Testy Workera na prawdziwym SQLite (node:sqlite) z tą samą migracją co D1 -
 * sprawdzamy rzeczywisty SQL rezerwacji, a nie atrapę.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Env, RateLimiter } from '../../worker/config/env.ts';
import type { D1Database, D1PreparedStatement, D1Result, Fetcher } from '../../worker/storage/d1.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import type { ShopConfig } from '../../src/lib/pricing.ts';

type Value = string | number | null;

function statement(db: DatabaseSync, sql: string, params: Value[] = []): D1PreparedStatement & { exec(): D1Result } {
  const exec = (): D1Result => {
    const stmt = db.prepare(sql);
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params) as unknown[], meta: { changes: 0 } };
    const r = stmt.run(...params);
    return { results: [], meta: { changes: Number(r.changes) } };
  };
  return {
    bind: (...values: unknown[]) => statement(db, sql, values as Value[]),
    first: async <T>() => ((db.prepare(sql).get(...params) as T) ?? null),
    all: async <T>() => exec() as D1Result<T>,
    run: async () => exec(),
    exec,
  };
}

export const MIGRATIONS = ['0001_orders.sql', '0002_sales_and_lease.sql', '0003_client_hash.sql'];

/** @param migrations domyślnie wszystkie - test migracji podaje tylko część */
export function createD1(migrations = MIGRATIONS): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  for (const m of migrations) db.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare: (sql) => statement(db, sql),
    // Jak w D1: batch to transakcja - błąd jednego zapytania wycofuje wszystkie.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => (s as ReturnType<typeof statement>).exec());
        db.exec('COMMIT');
        return results;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export const CATALOG: Catalog = {
  roza: ['Róża', 4000, 2, '/sklep/roza/', '/t/roza.webp'],
  muszla: ['Muszla', 3000, 1, '/sklep/muszla/', '/t/muszla.webp'],
};
export const CONFIG: ShopConfig = { shipping: 1499, freeFrom: 20000, promo2plus1: true };

export function assets(catalog: Catalog = CATALOG, config: ShopConfig = CONFIG): Fetcher {
  return {
    async fetch(input) {
      const path = new URL(typeof input === 'string' ? input : input.url).pathname;
      if (path === '/katalog.json') return Response.json(catalog);
      if (path === '/konfiguracja-sklepu.json') return Response.json(config);
      return new Response('static', { status: 200 });
    },
  };
}

export function testEnv(overrides: Partial<Env> = {}): Env & { DB: ReturnType<typeof createD1> } {
  return {
    ASSETS: assets(),
    DB: createD1(),
    SANDBOX: '1', // adaptery MOCK działają tylko w sandboxie
    MOCK_PAYMENTS: '1',
    MOCK_INPOST: '1',
    MOCK_EMAIL: '1',
    ADMIN_PASSWORD: 'tajne',
    SHOP_EMAIL: 'sklep@example.com',
    ...overrides,
  } as Env & { DB: ReturnType<typeof createD1> };
}

export const ORDER_BODY = {
  name: 'Anna Kowalska',
  email: 'anna@example.pl',
  phone: '+48 600 100 200',
  locker: 'kra01m',
  terms: true,
  gift: true,
  notes: 'Proszę o kokardę',
  items: [{ id: 'roza', qty: 1 }],
};

export const adminAuth = { Authorization: `Basic ${btoa('admin:tajne')}` };

/** Wycisza logi w testach, zachowując je do asercji. */
export function captureConsole() {
  const logs: Array<Record<string, unknown>> = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  for (const k of ['log', 'warn', 'error'] as const) console[k] = (r: unknown) => void logs.push(r as Record<string, unknown>);
  return { logs, restore: () => Object.assign(console, orig) };
}

/** Limiter jak w Cloudflare: `limit` żądań na klucz. */
export function rateLimiter(limit: number): RateLimiter {
  const counts = new Map<string, number>();
  return {
    async limit({ key }) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { success: counts.get(key)! <= limit };
    },
  };
}

/** Podmiana globalnego fetch wg adresu: [fragment URL, status, treść]. Nieznany adres → 500. */
export function routeFetch(routes: Array<[string, number, unknown]>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const hit = routes.find(([part]) => url.includes(part));
    return new Response(JSON.stringify(hit?.[2] ?? {}), { status: hit?.[1] ?? 500 });
  }) as typeof fetch;
}
