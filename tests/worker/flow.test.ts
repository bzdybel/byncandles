/**
 * Pełny przepływ przez worker/index.ts: zamówienie → płatność → przesyłka → e-maile → dziennik.
 * Adaptery noop (jak lokalnie) albo prawdziwe P24/ShipX z podmienionym fetch.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../../worker/index.ts';
import { p24Sign } from '../../worker/payments/Przelewy24Provider.ts';
import { reconcileOrders } from '../../worker/jobs/ReconcileOrdersJob.ts';
import { createServices } from '../../worker/services/init.ts';
import { createLogger } from '../../worker/utils/logger.ts';
import { OrderEvent } from '../../worker/domain/events.ts';
import { MAX_ATTEMPTS } from '../../worker/domain/order.ts';
import { adminAuth, captureConsole, ORDER_BODY, rateLimiter, routeFetch, testEnv } from './helpers.ts';

const ORIGIN = 'https://sklep.test';
const ctx = { waitUntil: () => {} };
type TestEnv = ReturnType<typeof testEnv>;

const call = (env: TestEnv, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
const post = (env: TestEnv, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const admin = async (env: TestEnv, key: string) => (await call(env, `/api/admin/orders/${key}`, { headers: adminAuth })).json();
const services = (env: TestEnv) => createServices(env, createLogger('job-test', 'job'), ORIGIN);
const types = (detail: { events: Array<{ type: string }> }) => detail.events.map((e) => e.type);

let con: ReturnType<typeof captureConsole>;
const realFetch = globalThis.fetch;
beforeEach(() => (con = captureConsole()));
afterEach(() => {
  con.restore();
  globalThis.fetch = realFetch;
});

test('lokalnie (noop): zamówienie → płatność → opłacone, przesyłka, e-maile i pełny dziennik', async () => {
  const env = testEnv();
  const res = await post(env, '/api/orders', ORDER_BODY);
  assert.equal(res.status, 201);
  const correlationId = res.headers.get('correlation-id');
  const { orderId, number, redirect } = await res.json();
  assert.equal(redirect, `${ORIGIN}/api/dev/payments/${orderId}/complete`);

  assert.equal((await (await call(env, `/api/orders/${orderId}`)).json()).status, 'pending');
  const pay = await call(env, `/api/dev/payments/${orderId}/complete`);
  assert.equal(pay.status, 303);
  assert.equal(pay.headers.get('Location'), `${ORIGIN}/zamowienie/dziekuje/?id=${orderId}`);
  assert.equal((await (await call(env, `/api/orders/${orderId}`)).json()).status, 'paid');

  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'PAID');
  assert.equal(detail.order.shipmentId, `mock-${number}`);
  assert.ok(detail.order.emailSentAt && detail.order.shopNotifiedAt);
  assert.deepEqual(detail.problems, []);
  assert.deepEqual(types(detail), [
    OrderEvent.ORDER_CREATED, OrderEvent.PAYMENT_REGISTERED, OrderEvent.WEBHOOK_RECEIVED, OrderEvent.PAYMENT_VERIFIED,
    OrderEvent.ORDER_PAID, OrderEvent.SHIPMENT_CREATED, OrderEvent.EMAIL_SENT, OrderEvent.SHOP_NOTIFIED,
  ]);
  assert.equal(detail.events[0].correlationId, correlationId, 'dziennik wskazuje żądanie w logach');
  assert.equal(detail.webhooks[0].outcome, 'ACCEPTED');
  assert.ok(con.logs.some((l) => l.correlationId === correlationId && (l.metadata as Record<string, unknown>)?.orderNumber === number));
  assert.ok(!JSON.stringify(con.logs).includes('anna@example.pl'), 'adres e-mail klienta nie trafia do logów');
});

test('katalog: sprzedane i zarezerwowane sztuki znikają z /katalog.json, ETag → 304', async () => {
  const env = testEnv();
  const { orderId } = await (await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'roza', qty: 1 }] })).json();
  await call(env, `/api/dev/payments/${orderId}/complete`);
  await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  const res = await call(env, '/katalog.json');
  const catalog = await res.json();
  assert.equal(catalog.muszla, undefined, 'zarezerwowana');
  assert.equal(catalog.roza[2], 1, 'jedna sprzedana');
  const again = await call(env, '/katalog.json', { headers: { 'If-None-Match': res.headers.get('ETag')! } });
  assert.equal(again.status, 304);
});

test('błędy: walidacja 400 z polami, brak sztuk 409, zły Content-Type 415 - zawsze z correlationId', async () => {
  const env = testEnv();
  const bad = await post(env, '/api/orders', { ...ORDER_BODY, email: 'zly' });
  assert.equal(bad.status, 400);
  const badJson = await bad.json();
  assert.deepEqual(badJson.fields, ['email']);
  assert.equal(badJson.correlationId, bad.headers.get('correlation-id'));

  await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  const sold = await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  assert.equal(sold.status, 409);
  assert.equal((await sold.json()).error, 'stock');

  // Formularz z obcej strony (text/plain nie wymaga preflightu CORS) nie złoży zamówienia.
  const csrf = await call(env, '/api/orders', { method: 'POST', body: JSON.stringify(ORDER_BODY), headers: { 'Content-Type': 'text/plain' } });
  assert.equal(csrf.status, 415);
  assert.equal((await post(env, '/api/orders', '{nie json')).status, 400);
  assert.equal((await call(env, '/api/nie-ma')).status, 404);
});

test('limit żądań: seryjne zamówienia z jednego IP → 429', async () => {
  const env = testEnv({ RATE_LIMITER: rateLimiter(2) });
  const ip = { 'CF-Connecting-IP': '1.2.3.4' };
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await post(env, '/api/orders', { ...ORDER_BODY, email: 'zly' }, ip)).status);
  assert.deepEqual(statuses, [400, 400, 429]);
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, email: 'zly' }, { 'CF-Connecting-IP': '5.6.7.8' })).status, 400, 'inne IP bez limitu');
});

test('paczkomat: nieistniejący kod → 400 z powodem, zanim klient zapłaci; awaria API InPost nie blokuje', async () => {
  const env = testEnv({ MOCK_INPOST: undefined });
  globalThis.fetch = routeFetch([['/points/NIEMA1', 404, {}], ['/points/KRA01M', 200, { name: 'KRA01M' }]]);
  const res = await post(env, '/api/orders', { ...ORDER_BODY, locker: 'niema1' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json().then((j) => [j.fields, j.reasons]), [['locker'], { locker: 'not_found' }]);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 0, 'nic nie zarezerwowano');

  assert.equal((await post(env, '/api/orders', ORDER_BODY)).status, 201);
  globalThis.fetch = routeFetch([]); // API punktów zwraca 500
  assert.equal((await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] })).status, 201);
});

test('ponowna próba z tej samej przeglądarki zwalnia sztukę poprzedniego zamówienia', async () => {
  const env = testEnv();
  const body = { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] };
  const first = await (await post(env, '/api/orders', body)).json();
  const retry = await post(env, '/api/orders', { ...body, previous: first.orderId });
  assert.equal(retry.status, 201);
  const old = await admin(env, first.number);
  assert.equal(old.order.status, 'CANCELED');
  assert.equal(old.events.at(-1).type, OrderEvent.ORDER_CANCELED_BY_RETRY);
});

const P24_ENV = { MOCK_PAYMENTS: undefined, P24_MERCHANT_ID: '11111', P24_API_KEY: 'k', P24_CRC: 'crc' };

test('P24: brak konfiguracji → 503, zamówienia nie są przyjmowane bez płatności', async () => {
  const env = testEnv({ MOCK_PAYMENTS: undefined });
  const res = await post(env, '/api/orders', ORDER_BODY);
  assert.equal(res.status, 503);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM orders').get()?.n, 0);
});

test('P24: awaria rejestracji płatności → 502, sztuki zwolnione, błąd w dzienniku', async () => {
  const env = testEnv(P24_ENV);
  globalThis.fetch = routeFetch([['/transaction/register', 400, { error: 'Incorrect CRC' }]]);
  const res = await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  assert.equal(res.status, 502);
  const [{ number }] = env.DB.raw.prepare('SELECT number FROM orders').all() as Array<{ number: string }>;
  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'FAILED');
  assert.equal(detail.events.at(-1).type, OrderEvent.PAYMENT_REGISTER_FAILED);
  assert.match(JSON.stringify(detail.events.at(-1).data), /Incorrect CRC/);
  assert.ok((await (await call(env, '/katalog.json')).json()).muszla, 'sztuka wraca do sprzedaży');
});

async function p24Order(env: TestEnv) {
  globalThis.fetch = routeFetch([['/transaction/register', 200, { data: { token: 'T' } }], ['/transaction/verify', 200, { data: { status: 'success' } }]]);
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  const total = 4000 + 1499;
  const n = { merchantId: 11111, posId: 11111, sessionId: orderId, amount: total, originAmount: total, currency: 'PLN', orderId: 555, methodId: 1, statement: 's' };
  return { orderId, number, n, signed: async (o = n) => ({ ...o, sign: await p24Sign({ ...o, crc: 'crc' }) }) };
}

test('P24: podrobione powiadomienie odrzucone i zapisane z surową treścią; prawdziwe opłaca; powtórka bez skutków', async () => {
  const env = testEnv(P24_ENV);
  const { number, n, signed } = await p24Order(env);
  assert.equal((await post(env, '/api/payments/webhook', { ...n, sign: 'zly' })).status, 400);
  assert.equal((await post(env, '/api/payments/webhook', await signed())).status, 200);
  assert.equal((await post(env, '/api/payments/webhook', await signed())).status, 200);

  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'PAID');
  assert.equal(detail.order.paymentReference, '555');
  assert.deepEqual(detail.webhooks.map((w: { outcome: string }) => w.outcome), ['REJECTED', 'ACCEPTED', 'DUPLICATE']);
  assert.match(detail.webhooks[0].rawPayload, /"sign":"zly"/);
  assert.equal(types(detail).filter((t) => t === OrderEvent.SHIPMENT_CREATED).length, 1, 'jedna przesyłka mimo powtórki');
});

test('P24: kwota niezgodna z zamówieniem → nie opłacamy, P24 ponowi; nieudana weryfikacja → 500', async () => {
  const env = testEnv(P24_ENV);
  const { number, n, signed } = await p24Order(env);
  const res = await post(env, '/api/payments/webhook', await signed({ ...n, amount: 1, originAmount: 1 }));
  assert.equal(res.status, 400);
  globalThis.fetch = routeFetch([['/transaction/verify', 400, { error: 'bad' }]]);
  assert.equal((await post(env, '/api/payments/webhook', await signed())).status, 502);
  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'PAYMENT_PENDING');
  assert.ok(types(detail).includes(OrderEvent.PAYMENT_AMOUNT_MISMATCH));
  assert.ok(types(detail).includes(OrderEvent.PAYMENT_VERIFY_FAILED));
  assert.deepEqual(detail.webhooks.map((w: { outcome: string }) => w.outcome), ['ERROR', 'ERROR']);
});

test('P24: powiadomienie zginęło → cron pyta P24 i opłaca; nieopłacone po rezerwacji → EXPIRED', async () => {
  const env = testEnv(P24_ENV);
  const paid = await p24Order(env);
  const unpaid = await (await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] })).json();
  env.DB.raw.prepare('UPDATE orders SET created_at = created_at - ?').run(2 * 60 * 60_000); // 2 h temu
  globalThis.fetch = routeFetch([
    [`/by/sessionId/${paid.orderId}`, 200, { data: { status: 2, orderId: 555, amount: 5499 } }],
    [`/by/sessionId/${unpaid.orderId}`, 404, {}],
  ]);
  const stats = await reconcileOrders(services(env));
  assert.deepEqual([stats.paid, stats.expired, stats.failed], [1, 1, 0]);
  assert.equal((await admin(env, paid.number)).order.status, 'PAID');
  assert.equal((await admin(env, unpaid.number)).order.status, 'EXPIRED');
});

test('P24: powiadomienie nie dociera (np. localhost) → strona powrotu pyta P24 i pokazuje „opłacone”', async () => {
  const env = testEnv(P24_ENV);
  const { orderId, number } = await p24Order(env);
  globalThis.fetch = routeFetch([[`/by/sessionId/${orderId}`, 200, { data: { status: 0, orderId: 0, amount: 0 } }]]);
  assert.equal((await (await call(env, `/api/orders/${orderId}`)).json()).status, 'pending', 'jeszcze nie zapłacone');

  globalThis.fetch = routeFetch([]); // P24 niedostępne - strona działa, status z bazy
  assert.equal((await call(env, `/api/orders/${orderId}`)).status, 200);

  globalThis.fetch = routeFetch([
    [`/by/sessionId/${orderId}`, 200, { data: { status: 1, orderId: 555, amount: 5499 } }],
    ['/transaction/verify', 200, { data: { status: 'success' } }],
  ]);
  assert.equal((await (await call(env, `/api/orders/${orderId}`)).json()).status, 'paid');
  const detail = await admin(env, number);
  assert.equal(detail.order.paymentReference, '555');
  const recovered = detail.events.find((e: { type: string }) => e.type === OrderEvent.PAYMENT_RECOVERED);
  assert.deepEqual([recovered.level, recovered.data.source], ['info', 'return_page']);
  assert.ok(types(detail).includes(OrderEvent.PAYMENT_VERIFIED), 'wpłata wstępna potwierdzona w P24');
});

test('admin: „klient pisze, że zapłacił” → sprawdzenie płatności w P24 na żądanie', async () => {
  const env = testEnv(P24_ENV);
  const { orderId, number } = await p24Order(env);
  globalThis.fetch = routeFetch([[`/by/sessionId/${orderId}`, 200, { data: { status: 2, orderId: 777, amount: 5499 } }]]);
  const res = await call(env, `/api/admin/orders/${number}/check-payment`, { method: 'POST', headers: adminAuth });
  assert.equal((await res.json()).order.status, 'PAID');
  assert.equal((await call(env, `/api/admin/orders/${number}/check-payment`, { method: 'POST', headers: adminAuth })).status, 409, 'już opłacone');
  assert.equal((await call(env, `/api/admin/orders/${number}/check-payment`, { method: 'POST' })).status, 401);
});

test('ShipX niedostępny: błąd w dzienniku, sklep czeka, cron kończy; po wyczerpaniu prób sklep dostaje ostrzeżenie', async () => {
  const env = testEnv({ MOCK_INPOST: undefined, SHIPX_TOKEN: 't', SHIPX_ORG_ID: '1' });
  globalThis.fetch = routeFetch([['/points/', 200, {}], ['/shipments', 503, { error: 'down' }]]);
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  await call(env, `/api/dev/payments/${orderId}/complete`);

  let detail = await admin(env, number);
  assert.equal(detail.order.shipmentId, null);
  assert.equal(detail.order.shopNotifiedAt, null, 'sklep czeka na rozstrzygnięcie przesyłki');
  assert.ok(detail.order.emailSentAt, 'klient dostaje potwierdzenie niezależnie od ShipX');
  assert.deepEqual(detail.problems, ['brak przesyłki', 'sklep niepowiadomiony']);

  for (let i = 1; i < MAX_ATTEMPTS; i++) await reconcileOrders(services(env));
  detail = await admin(env, number);
  assert.equal(detail.order.shipmentAttempts, MAX_ATTEMPTS);
  assert.ok(detail.order.shopNotifiedAt, 'po wyczerpaniu prób sklep dostaje powiadomienie z błędem');
  assert.equal((await reconcileOrders(services(env))).followedUp, 0, 'bez kolejnych prób');

  // Po naprawie (np. tokenu) - ręczne ponowienie z panelu.
  globalThis.fetch = routeFetch([['/shipments', 201, { id: 99, status: 'created' }]]);
  const retried = await (await call(env, `/api/admin/orders/${number}/retry`, { method: 'POST', headers: adminAuth })).json();
  assert.equal(retried.order.shipmentId, '99');
  assert.deepEqual(retried.problems, []);
});

test('realizacja: webhook i cron równolegle → jedna przesyłka (lease)', async () => {
  const env = testEnv({ MOCK_INPOST: undefined, SHIPX_TOKEN: 't', SHIPX_ORG_ID: '1' });
  const calls: string[] = [];
  globalThis.fetch = routeFetch([['/points/', 200, {}], ['/shipments', 503, {}]]);
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  await call(env, `/api/dev/payments/${orderId}/complete`); // 1. próba nieudana

  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  globalThis.fetch = (async (input: string) => {
    calls.push(String(input));
    await gate;
    return new Response(JSON.stringify({ id: 7, status: 'created' }), { status: 201 });
  }) as unknown as typeof fetch;
  const order = (await services(env).storage.getByNumber(number))!;
  const a = services(env).fulfillment.fulfill(order);
  const b = services(env).fulfillment.fulfill(order);
  release();
  const results = await Promise.all([a, b]);
  assert.equal(calls.filter((u) => u.includes('/shipments')).length, 1);
  assert.equal(results.filter((r) => r === null).length, 1, 'drugi wykonawca odpuszcza');
});

test('Resend chwilowo niedostępny: sklep czeka z powiadomieniem, aż e-mail klienta się rozstrzygnie', async () => {
  const env = testEnv({ MOCK_EMAIL: undefined, RESEND_API_KEY: 'k', MAIL_FROM: 'sklep <a@b.pl>' });
  globalThis.fetch = routeFetch([['api.resend.com', 500, { message: 'down' }]]);
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  await call(env, `/api/dev/payments/${orderId}/complete`);
  let detail = await admin(env, number);
  assert.equal(detail.order.emailAttempts, 1);
  assert.equal(detail.order.shopNotifiedAt, null);

  const sent: string[] = [];
  globalThis.fetch = (async (_: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).text);
    return new Response(JSON.stringify({ id: `m${sent.length}` }), { status: 200 });
  }) as unknown as typeof fetch;
  await reconcileOrders(services(env));
  detail = await admin(env, number);
  assert.ok(detail.order.emailSentAt && detail.order.shopNotifiedAt);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(sent[1], /klient nie dostał/, 'bez fałszywego alarmu');
});

test('admin: bez hasła lub ze złym 401, lista z problemami', async () => {
  const env = testEnv();
  assert.equal((await call(env, '/api/admin/orders')).status, 401);
  assert.equal((await call(env, '/api/admin/orders', { headers: { Authorization: `Basic ${btoa('a:zle')}` } })).status, 401);
  assert.equal((await call(env, '/api/admin/orders', { headers: { Authorization: 'Basic !!!' } })).status, 401);
  assert.equal((await call(testEnv({ ADMIN_PASSWORD: undefined }), '/api/admin/orders', { headers: adminAuth })).status, 401, 'brak hasła = panel wyłączony');
  await post(env, '/api/orders', ORDER_BODY);
  const list = await (await call(env, '/api/admin/orders?status=PAYMENT_PENDING', { headers: adminAuth })).json();
  assert.equal(list.length, 1);
  assert.equal((await call(env, '/api/admin/orders?status=XYZ', { headers: adminAuth })).status, 400);
  assert.equal((await (await call(env, '/api/admin/orders?status=payment_pending&limit=abc', { headers: adminAuth })).json()).length, 1, 'wielkość liter i zły limit');
});
