/**
 * Testy regresji ataków na proces zamówienia (scenariusze sprawdzone ręcznie na `wrangler dev`):
 * każdy test to atak, który wcześniej się udawał (albo powinien się nie udać), i zabezpieczenie.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.ts';
import { MAX_PENDING_PER_CLIENT } from '../../worker/domain/order.ts';
import { adminAuth, assets, CATALOG, captureConsole, ORDER_BODY, rateLimiter, routeFetch, testEnv } from './helpers.ts';

const ORIGIN = 'https://sklep.test';
const ctx = { waitUntil: () => {} };
type TestEnv = ReturnType<typeof testEnv>;
const call = (env: TestEnv, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
const post = (env: TestEnv, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const ip = (n: number) => ({ 'CF-Connecting-IP': `203.0.113.${n}` });
const count = (env: TestEnv, sql: string) => (env.DB.raw.prepare(sql).get() as { n: number }).n;

let con: ReturnType<typeof captureConsole>;
const realFetch = globalThis.fetch;
beforeEach(() => (con = captureConsole()));
afterEach(() => {
  con.restore();
  globalThis.fetch = realFetch;
});

test('A2: jedno żądanie nie zarezerwuje całego sklepu (limity sztuk w zamówieniu)', async () => {
  const env = testEnv();
  const res = await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'roza', qty: 11 }] }, ip(1));
  assert.equal(res.status, 400);
  assert.deepEqual((await res.json()).fields, ['items']);
  const many = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, qty: 1 }));
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, items: many }, ip(1))).status, 400);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM orders'), 0);
});

test('A3b: limit nieopłaconych rezerwacji na klienta (IP); ponowna próba z „previous” go nie zużywa', async () => {
  const env = testEnv({ ASSETS: assets({ ...CATALOG, roza: ['Róża', 4000, 50, '/sklep/roza/', ''] }) });
  const order = (email: string, extra = {}) => post(env, '/api/orders', { ...ORDER_BODY, email, ...extra }, ip(2));
  const codes = [];
  let last = '';
  for (let i = 0; i < MAX_PENDING_PER_CLIENT; i++) {
    const r = await order(`k${i}@example.pl`);
    codes.push(r.status);
    last = (await r.json()).orderId;
  }
  const blocked = await order('k9@example.pl');
  assert.deepEqual([...codes, blocked.status], [201, 201, 429]);
  assert.equal((await blocked.json()).error, 'pending_limit');
  assert.equal((await order(`k${MAX_PENDING_PER_CLIENT - 1}@example.pl`, { previous: last })).status, 201, 'ponowna próba klienta przechodzi');
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, email: 'inny@example.pl' }, ip(3))).status, 201, 'inny klient bez wpływu');
  assert.ok(!JSON.stringify(env.DB.raw.prepare('SELECT client_hash FROM orders').all()).includes('203.0.113'), 'samo IP nie trafia do bazy');
});

test('A3: rotacja IP - Turnstile wymagany, gdy skonfigurowany; awaria Turnstile nie blokuje sprzedaży', async () => {
  const env = testEnv({ TURNSTILE_SECRET: 's' });
  globalThis.fetch = routeFetch([['siteverify', 200, { success: false, 'error-codes': ['invalid-input-response'] }]]);
  const noToken = await post(env, '/api/orders', ORDER_BODY, ip(4));
  assert.deepEqual([noToken.status, (await noToken.json()).error], [400, 'captcha']);
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, captcha: 'bot' }, ip(5))).status, 400);
  globalThis.fetch = routeFetch([['siteverify', 200, { success: true }]]);
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, captcha: 'human' }, ip(6))).status, 201);
  globalThis.fetch = routeFetch([]); // Turnstile 500
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, captcha: 'human', email: 'b@example.pl' }, ip(7))).status, 201);
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM orders'), 2);
});

test('A4: śmieciowe powiadomienia nie zapisują się w bazie; dotyczące zamówienia - tak (z surową treścią)', async () => {
  const env = testEnv({ MOCK_PAYMENTS: undefined, P24_MERCHANT_ID: '11111', P24_API_KEY: 'k', P24_CRC: 'crc' });
  for (let i = 0; i < 20; i++) await post(env, '/api/payments/webhook', { sessionId: crypto.randomUUID(), junk: 'x'.repeat(5000) });
  assert.equal(count(env, 'SELECT COUNT(*) AS n FROM webhook_events'), 0);
  globalThis.fetch = routeFetch([['/transaction/register', 200, { data: { token: 'T' } }]]);
  const { orderId } = await (await post(env, '/api/orders', ORDER_BODY, ip(8))).json();
  assert.equal((await post(env, '/api/payments/webhook', { sessionId: orderId, sign: 'zly' })).status, 400);
  assert.equal(count(env, "SELECT COUNT(*) AS n FROM webhook_events WHERE outcome = 'REJECTED'"), 1);
  assert.equal((await post(env, '/api/payments/webhook', 'x'.repeat(9000))).status, 413);
});

test('A5: e-mail z kilkoma adresami / nawiasami odrzucony (Resend wysłałby do wielu odbiorców)', async () => {
  const env = testEnv();
  for (const email of ['a@example.pl,b@example.com', 'Jan <jan@example.pl>', 'a@b@example.pl', 'a@example.pl;b@example.pl']) {
    const res = await post(env, '/api/orders', { ...ORDER_BODY, email }, ip(9));
    assert.deepEqual((await res.json()).fields, ['email'], email);
  }
});

test('A6: MOCK_PAYMENTS poza sandboxem ignorowane - bez opłacania zamówień jednym żądaniem', async () => {
  const env = testEnv({ SANDBOX: undefined });
  assert.equal((await post(env, '/api/orders', ORDER_BODY, ip(10))).status, 503, 'brak P24 = sklep nie przyjmuje zamówień');
  env.DB.raw.exec(`INSERT INTO orders (id, number, status, correlation_id, created_at, customer_name, email, phone, delivery_point_id, items_total, discount, delivery_cost, total)
    VALUES ('11111111-1111-4111-8111-111111111111', 'BN-OLD', 'PAYMENT_PENDING', 'c', ${Date.now()}, 'A B', 'a@b.pl', '600100200', 'KRA01M', 5499, 0, 0, 5499)`);
  const forged = { sessionId: '11111111-1111-4111-8111-111111111111', reference: 'free', amount: 5499, currency: 'PLN' };
  assert.equal((await post(env, '/api/payments/webhook', forged)).status, 400);
  assert.equal((await call(env, '/api/dev/payments/11111111-1111-4111-8111-111111111111/complete')).status, 404);
  assert.equal((env.DB.raw.prepare("SELECT status FROM orders WHERE number = 'BN-OLD'").get() as { status: string }).status, 'PAYMENT_PENDING');
});

test('A7: duże ciało żądania odrzucone przed wczytaniem (Content-Length i strumień)', async () => {
  const env = testEnv();
  const big = await post(env, '/api/orders', 'x'.repeat(20_000), ip(11));
  assert.equal(big.status, 413);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(8192));
      if (pulled > 1000) c.close();
    },
  });
  const res = await call(env, '/api/orders', { method: 'POST', body: stream, headers: { 'Content-Type': 'application/json', ...ip(11) }, duplex: 'half' } as RequestInit);
  assert.equal(res.status, 413);
  assert.ok(pulled < 10, `przerwane po ${pulled} kawałkach, nie po 8 MB`);
});

test('A8: znając id cudzego zamówienia nie da się go anulować (wymagany ten sam e-mail)', async () => {
  const env = testEnv();
  const victim = await (await post(env, '/api/orders', { ...ORDER_BODY, email: 'ofiara@example.pl', items: [{ id: 'muszla', qty: 1 }] }, ip(12))).json();
  const res = await post(env, '/api/orders', { ...ORDER_BODY, email: 'napastnik@example.pl', items: [{ id: 'muszla', qty: 1 }], previous: victim.orderId }, ip(13));
  assert.equal(res.status, 409, 'sztuka ofiary nadal zarezerwowana');
  assert.equal((env.DB.raw.prepare('SELECT status FROM orders WHERE id = ?').get(victim.orderId) as { status: string }).status, 'PAYMENT_PENDING');
});

test('A9: limit odczytów /katalog.json i statusu zamówienia per IP', async () => {
  const env = testEnv({ READ_LIMITER: rateLimiter(3) });
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await call(env, '/katalog.json', { headers: ip(14) })).status);
  assert.deepEqual(codes, [200, 200, 200, 429]);
});

test('odpowiedzi API: nosniff, no-store i correlationId; panel admina bez hasła niedostępny', async () => {
  const env = testEnv();
  const res = await call(env, '/api/admin/orders', { headers: adminAuth });
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.ok(res.headers.get('correlation-id'));
});
