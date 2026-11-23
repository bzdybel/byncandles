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
import { OrderEvent } from '../../worker/constants/orderStatus.ts';
import { adminAuth, captureConsole, ORDER_BODY, testEnv } from './helpers.ts';

const ORIGIN = 'https://sklep.test';
const ctx = { waitUntil: () => {} };
type TestEnv = ReturnType<typeof testEnv>;

const call = (env: TestEnv, path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
const post = (env: TestEnv, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call(env, path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers } });
const admin = async (env: TestEnv, key: string) => (await call(env, `/api/admin/orders/${key}`, { headers: adminAuth })).json();

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
  assert.ok(correlationId);
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
  assert.deepEqual(
    detail.events.map((e: { type: string }) => e.type),
    [OrderEvent.ORDER_CREATED, OrderEvent.PAYMENT_REGISTERED, OrderEvent.WEBHOOK_RECEIVED, OrderEvent.PAYMENT_VERIFIED, OrderEvent.ORDER_PAID, OrderEvent.SHIPMENT_CREATED, OrderEvent.EMAIL_SENT, OrderEvent.SHOP_NOTIFIED],
  );
  assert.equal(detail.events[0].correlationId, correlationId, 'dziennik wskazuje żądanie w logach');
  assert.equal(detail.webhooks[0].outcome, 'ACCEPTED');
  assert.ok(detail.correlationIds.length >= 2, 'utworzenie i płatność to osobne żądania');

  // Log z utworzenia ma correlationId i numer zamówienia - po nich szukamy w Cloudflare Logs.
  assert.ok(con.logs.some((l) => l.correlationId === correlationId && (l.metadata as Record<string, unknown>)?.orderNumber === number));
});

test('katalog: sztuki zarezerwowane znikają z /katalog.json, ETag → 304', async () => {
  const env = testEnv();
  await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  const res = await call(env, '/katalog.json');
  const catalog = await res.json();
  assert.equal(catalog.muszla, undefined);
  assert.equal(catalog.roza[2], 2);
  const again = await call(env, '/katalog.json', { headers: { 'If-None-Match': res.headers.get('ETag')! } });
  assert.equal(again.status, 304);
});

test('błędy: walidacja 400 z polami, brak sztuk 409 - zawsze z correlationId', async () => {
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
  globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Incorrect CRC' }), { status: 400 })) as typeof fetch;
  const res = await post(env, '/api/orders', { ...ORDER_BODY, items: [{ id: 'muszla', qty: 1 }] });
  assert.equal(res.status, 502);
  const [{ number }] = env.DB.raw.prepare('SELECT number FROM orders').all() as Array<{ number: string }>;
  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'FAILED');
  const failed = detail.events.at(-1);
  assert.equal(failed.type, OrderEvent.PAYMENT_REGISTER_FAILED);
  assert.match(JSON.stringify(failed.data), /Incorrect CRC/);
  assert.ok((await (await call(env, '/katalog.json')).json()).muszla, 'sztuka wraca do sprzedaży');
});

test('P24: podrobione powiadomienie odrzucone i zapisane z surową treścią; prawdziwe opłaca', async () => {
  const env = testEnv(P24_ENV);
  globalThis.fetch = (async (url: string) =>
    new Response(JSON.stringify(String(url).includes('register') ? { data: { token: 'T' } } : { data: { status: 'success' } }), { status: 200 })) as typeof fetch;
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  const total = 4000 + 1499;
  const n = { merchantId: 11111, posId: 11111, sessionId: orderId, amount: total, originAmount: total, currency: 'PLN', orderId: 555, methodId: 1, statement: 's' };

  const forged = await post(env, '/api/payments/webhook', { ...n, sign: 'zly' });
  assert.equal(forged.status, 400);
  const ok = await post(env, '/api/payments/webhook', { ...n, sign: await p24Sign({ ...n, crc: 'crc' }) });
  assert.equal(ok.status, 200);
  const dup = await post(env, '/api/payments/webhook', { ...n, sign: await p24Sign({ ...n, crc: 'crc' }) });
  assert.equal(dup.status, 200);

  const detail = await admin(env, number);
  assert.equal(detail.order.status, 'PAID');
  assert.equal(detail.order.paymentReference, '555');
  assert.deepEqual(detail.webhooks.map((w: { outcome: string }) => w.outcome), ['REJECTED', 'ACCEPTED', 'DUPLICATE']);
  assert.match(detail.webhooks[0].rawPayload, /"sign":"zly"/);
});

test('ShipX niedostępny: błąd w dzienniku, sklep czeka na ponowienie, cron kończy sprawę', async () => {
  const env = testEnv({ MOCK_INPOST: undefined, SHIPX_TOKEN: 't', SHIPX_ORG_ID: '1' });
  let shipxUp = false;
  globalThis.fetch = (async () =>
    shipxUp ? new Response(JSON.stringify({ id: 99, status: 'created' }), { status: 201 }) : new Response('{"error":"down"}', { status: 503 })) as typeof fetch;
  const { orderId, number } = await (await post(env, '/api/orders', ORDER_BODY)).json();
  await call(env, `/api/dev/payments/${orderId}/complete`);

  let detail = await admin(env, number);
  assert.equal(detail.order.shipmentId, null);
  assert.equal(detail.order.shopNotifiedAt, null, 'sklep dostanie jedno powiadomienie, gdy przesyłka się rozstrzygnie');
  assert.ok(detail.order.emailSentAt, 'klient dostaje potwierdzenie niezależnie od ShipX');
  assert.ok(detail.events.some((e: { type: string; level: string }) => e.type === OrderEvent.SHIPMENT_FAILED && e.level === 'error'));

  shipxUp = true;
  const stats = await reconcileOrders(createServices(env, createLogger('job-test', 'job'), ORIGIN));
  assert.equal(stats.followedUp, 1);
  detail = await admin(env, number);
  assert.equal(detail.order.shipmentId, '99');
  assert.ok(detail.order.shopNotifiedAt);
});

test('admin: bez hasła 401, lista zamówień z problemami', async () => {
  const env = testEnv();
  assert.equal((await call(env, '/api/admin/orders')).status, 401);
  assert.equal((await call(env, '/api/admin/orders', { headers: { Authorization: `Basic ${btoa('a:zle')}` } })).status, 401);
  await post(env, '/api/orders', ORDER_BODY);
  const list = await (await call(env, '/api/admin/orders?status=PAYMENT_PENDING', { headers: adminAuth })).json();
  assert.equal(list.length, 1);
});
