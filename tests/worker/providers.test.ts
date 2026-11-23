import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { p24Sign, Przelewy24Provider } from '../../worker/payments/Przelewy24Provider.ts';
import { shipmentBody, ShipXProvider } from '../../worker/shipping/ShipXProvider.ts';
import { ProviderError } from '../../worker/errors/AppError.ts';
import { InPostPoints } from '../../worker/shipping/PointsDirectory.ts';
import { callProvider } from '../../worker/utils/providerHttp.ts';

const cfg = { merchantId: 11111, posId: 11111, apiKey: 'key', crc: 'crc123', sandbox: true };
type Call = { url: string; init: RequestInit };
function mockFetch(responses: Array<[number, unknown]>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const [status, body] = responses.shift() ?? [500, {}];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test('P24: podpis = SHA-384 z JSON-a bez escapowania „/” i polskich znaków', async () => {
  const fields = { sessionId: 'a/ż', merchantId: 1, amount: 100, currency: 'PLN', crc: 'x' };
  const expected = createHash('sha384').update('{"sessionId":"a/ż","merchantId":1,"amount":100,"currency":"PLN","crc":"x"}').digest('hex');
  assert.equal(await p24Sign(fields), expected);
});

test('P24: rejestracja wysyła podpisaną transakcję i zwraca adres bramki sandbox', async () => {
  const { fn, calls } = mockFetch([[200, { data: { token: 'TOKEN' } }]]);
  const p24 = new Przelewy24Provider(cfg, fn);
  const { redirectUrl } = await p24.register({
    sessionId: 's1', amount: 5499, description: 'd', email: 'a@b.pl', client: 'Anna', phone: '600100200', urlReturn: 'https://x/r', urlStatus: 'https://x/s',
  });
  assert.equal(redirectUrl, 'https://sandbox.przelewy24.pl/trnRequest/TOKEN');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(calls[0].url, 'https://sandbox.przelewy24.pl/api/v1/transaction/register');
  assert.equal(body.sign, await p24Sign({ sessionId: 's1', merchantId: 11111, amount: 5499, currency: 'PLN', crc: 'crc123' }));
  assert.equal(body.timeLimit, 30);
});

test('P24: błąd rejestracji → ProviderError z odpowiedzią P24 (do dziennika)', async () => {
  const { fn } = mockFetch([[400, { error: 'Incorrect CRC', code: 400 }]]);
  await assert.rejects(new Przelewy24Provider(cfg, fn).register({} as never), (e: unknown) => e instanceof ProviderError && /Incorrect CRC/.test(JSON.stringify(e.details)));
});

async function notification(overrides: Record<string, unknown> = {}) {
  const n = { merchantId: 11111, posId: 11111, sessionId: 's1', amount: 5499, originAmount: 5499, currency: 'PLN', orderId: 777, methodId: 25, statement: 'p24-A1', ...overrides };
  const sign = await p24Sign({ ...n, crc: 'crc123' } as Record<string, string | number>);
  return { ...n, sign };
}

test('P24: powiadomienie - poprawny podpis przechodzi, podrobiony nie', async () => {
  const p24 = new Przelewy24Provider(cfg);
  const ok = await p24.parseNotification(JSON.stringify(await notification()));
  assert.deepEqual(ok, { valid: true, notification: { sessionId: 's1', reference: '777', amount: 5499, currency: 'PLN' } });
  const forged = { ...(await notification()), amount: 1 };
  assert.deepEqual(await p24.parseNotification(JSON.stringify(forged)), { valid: false, reason: 'bad_signature', sessionId: 's1', reference: '777' });
  assert.equal((await p24.parseNotification('nie json')).valid, false);
});

test('P24: stan transakcji - 2 opłacona, 1 do weryfikacji, 404 brak', async () => {
  const { fn } = mockFetch([[200, { data: { status: 2, orderId: 9, amount: 100 } }], [200, { data: { status: 1, orderId: 9, amount: 100 } }], [404, {}]]);
  const p24 = new Przelewy24Provider(cfg, fn);
  assert.equal((await p24.status('s')).state, 'paid');
  assert.equal((await p24.status('s')).state, 'paid_unverified');
  assert.equal((await p24.status('s')).state, 'unpaid');
});

test('ShipX: przesyłka paczkomatowa z imieniem, nazwiskiem i kodem paczkomatu', async () => {
  const shipCfg = { token: 't', organizationId: '42', sandbox: true, parcelTemplate: 'small', sendingMethod: 'parcel_locker' };
  const input = { orderNumber: 'BN-1', customerName: 'Anna Maria Kowalska', email: 'a@b.pl', phone: '600100200', deliveryPointId: 'KRA01M' };
  assert.deepEqual(shipmentBody(shipCfg, input).receiver, { first_name: 'Anna', last_name: 'Maria Kowalska', email: 'a@b.pl', phone: '600100200' });
  const { fn, calls } = mockFetch([[201, { id: 123, status: 'created' }], [422, { error: 'validation_failed', details: { target_point: ['does_not_exist'] } }]]);
  const shipx = new ShipXProvider(shipCfg, fn);
  assert.deepEqual(await shipx.createShipment(input), { id: '123', status: 'created' });
  assert.equal(calls[0].url, 'https://sandbox-api-shipx-pl.easypack24.net/v1/organizations/42/shipments');
  await assert.rejects(shipx.createShipment(input), (e: unknown) => e instanceof ProviderError && /does_not_exist/.test(JSON.stringify(e.details)));
});

test('dostawca: zawieszone API → ProviderError „timeout” zamiast wiszącego żądania', async () => {
  const hanging = ((_: string, init: RequestInit) =>
    new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
  const keepAlive = setTimeout(() => {}, 1000); // w Node timer AbortSignal.timeout nie podtrzymuje procesu
  await assert.rejects(callProvider('x', 'https://x', {}, hanging, 20), (e: unknown) => e instanceof ProviderError && /timeout after 20 ms/.test(e.message));
  clearTimeout(keepAlive);
});

test('P24: powiadomienie bez podpisu, z obcym merchantem albo niepełne → odrzucone', async () => {
  const p24 = new Przelewy24Provider(cfg);
  const n = await notification();
  assert.equal((await p24.parseNotification(JSON.stringify({ ...n, sign: undefined }))).valid, false);
  assert.equal((await p24.parseNotification('null')).valid, false);
  assert.deepEqual(await p24.parseNotification(JSON.stringify({ ...n, amount: '5499' })), { valid: false, reason: 'invalid_payload', sessionId: 's1', reference: '777' }, 'kwota jako tekst');
  const foreign = await notification({ merchantId: 999 });
  assert.deepEqual(await p24.parseNotification(JSON.stringify(foreign)), { valid: false, reason: 'merchant_mismatch', sessionId: 's1', reference: '777' });
});

test('paczkomaty: 200 istnieje, 404 nie istnieje, awaria API = nie wiadomo (nie blokuje)', async () => {
  const { fn } = mockFetch([[200, { name: 'KRA01M' }], [404, {}], [500, {}]]);
  const points = new InPostPoints(fn);
  assert.equal(await points.exists('KRA01M'), true);
  assert.equal(await points.exists('XXX99'), false);
  assert.equal(await points.exists('KRA01M'), null);
  assert.equal(await new InPostPoints((() => Promise.reject(new Error('offline'))) as unknown as typeof fetch).exists('KRA01M'), null);
});
