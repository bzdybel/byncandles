import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOrderRequest } from '../../worker/services/OrderFactory.ts';
import { InsufficientStockError, ValidationError } from '../../worker/errors/AppError.ts';
import { applyReserved } from '../../worker/services/StockService.ts';
import { holdsStock, isPaidLate, orderNumber, orderProblems, OrderStatus, publicStatus, RESERVATION_MS, type Order } from '../../worker/domain/order.ts';
import { CATALOG, CONFIG, ORDER_BODY } from './helpers.ts';

const invalidFields = (body: unknown) => {
  try {
    parseOrderRequest(body, CATALOG, CONFIG);
  } catch (e) {
    if (e instanceof ValidationError) return e.fields;
    throw e;
  }
  return [];
};

test('zamówienie: ceny z katalogu, nie od klienta', () => {
  const p = parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'roza', qty: 2, price: 1 }] }, CATALOG, CONFIG);
  assert.deepEqual(p.items, [{ productId: 'roza', name: 'Róża', unitPrice: 4000, quantity: 2 }]);
  assert.equal(p.fields.total, 8000 + 1499);
  assert.equal(p.fields.phone, '600100200');
  assert.equal(p.fields.deliveryPointId, 'KRA01M');
});

test('zamówienie: 2+1 i darmowa dostawa liczone jak w koszyku', () => {
  const p = parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'roza', qty: 2 }, { id: 'muszla', qty: 1 }] }, CATALOG, CONFIG);
  assert.equal(p.fields.discount, 3000);
  assert.equal(p.fields.deliveryCost, 1499); // 110 zł < 200 zł
});

test('zamówienie: błędne pola → ValidationError z listą pól', () => {
  assert.deepEqual(invalidFields({ ...ORDER_BODY, email: 'x', terms: false }), ['email', 'terms']);
  assert.deepEqual(invalidFields(null), ['name', 'email', 'phone', 'locker', 'terms', 'items']);
  assert.deepEqual(invalidFields({ ...ORDER_BODY, terms: 'true' }), ['terms'], 'tylko boolean true');
});

test('zamówienie: pozycje - duplikaty, ilości spoza zakresu, za dużo linii, pusta lista', () => {
  for (const items of [
    [{ id: 'roza', qty: 1 }, { id: 'roza', qty: 1 }],
    [{ id: 'roza', qty: 0 }],
    [{ id: 'roza', qty: 1.5 }],
    [{ id: 'roza', qty: 51 }],
    [{ id: 5, qty: 1 }],
    [],
    'roza',
    Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, qty: 1 })),
  ]) {
    assert.deepEqual(invalidFields({ ...ORDER_BODY, items }), ['items'], JSON.stringify(items).slice(0, 40));
  }
});

test('zamówienie: kwota poniżej minimum P24 (produkt za 0 zł) → błąd pozycji, nie 502 z P24', () => {
  const free = { gratis: ['Gratis', 0, 5, '/x/', ''] as [string, number, number, string, string] };
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'gratis', qty: 1 }] }, free, { shipping: 0, promo2plus1: false }), ValidationError);
});

test('zamówienie: znaki sterujące usunięte, nowe linie w uwagach zostają, limity długości', () => {
  const p = parseOrderRequest({ ...ORDER_BODY, name: 'Anna\u0000 Kowalska\r\n', notes: 'linia 1\nlinia 2\u0007', email: 'anna@example.pl' }, CATALOG, CONFIG);
  assert.equal(p.fields.customerName, 'Anna  Kowalska');
  assert.equal(p.fields.notes, 'linia 1\nlinia 2');
  assert.equal(parseOrderRequest({ ...ORDER_BODY, notes: 'x'.repeat(2000) }, CATALOG, CONFIG).fields.notes?.length, 500);
  assert.equal(parseOrderRequest({ ...ORDER_BODY, notes: '   ' }, CATALOG, CONFIG).fields.notes, null);
});

test('zamówienie: więcej niż na stanie albo produkt spoza katalogu → InsufficientStockError', () => {
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'muszla', qty: 2 }] }, CATALOG, CONFIG), InsufficientStockError);
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'nie-ma', qty: 1 }] }, CATALOG, CONFIG), InsufficientStockError);
});

test('domena: numer zamówienia BN- + 6 znaków bez mylących', () => {
  assert.match(orderNumber(new Uint8Array([0, 1, 2, 3, 4, 255])), /^BN-[2-9A-HJKMNP-Z]{6}$/);
});

test('domena: rezerwacja, status publiczny i opłacenie po czasie', () => {
  const now = 1_800_000_000_000;
  const fresh = { status: OrderStatus.PAYMENT_PENDING, createdAt: now - 1000 };
  const old = { status: OrderStatus.PAYMENT_PENDING, createdAt: now - RESERVATION_MS - 1 };
  assert.equal(holdsStock(fresh, now), true);
  assert.equal(holdsStock(old, now), false);
  assert.equal(holdsStock({ status: OrderStatus.PAID, createdAt: 0 }, now), true, 'opłacone trzyma zawsze');
  assert.equal(holdsStock({ status: OrderStatus.CANCELED, createdAt: now }, now), false);
  assert.deepEqual([publicStatus(fresh, now), publicStatus(old, now), publicStatus({ status: OrderStatus.FAILED, createdAt: now }, now)], ['pending', 'expired', 'expired']);
  assert.equal(isPaidLate(fresh, now), false);
  assert.equal(isPaidLate(old, now), true);
  assert.equal(isPaidLate({ status: OrderStatus.CANCELED, createdAt: now }, now), true, 'anulowane przez ponowną próbę');
});

test('domena: problemy tylko dla opłaconych', () => {
  const base = { status: OrderStatus.PAID, shipmentId: null, emailSentAt: 1, shopNotifiedAt: null } as unknown as Order;
  assert.deepEqual(orderProblems(base), ['brak przesyłki', 'sklep niepowiadomiony']);
  assert.deepEqual(orderProblems({ ...base, status: OrderStatus.PAYMENT_PENDING }), []);
});

test('katalog: odejmuje zajęte sztuki, wyprzedane znikają', () => {
  const out = applyReserved(CATALOG, new Map([['roza', 1], ['muszla', 1]]));
  assert.deepEqual(Object.keys(out), ['roza']);
  assert.equal(out.roza[2], 1);
  assert.deepEqual(Object.keys(applyReserved(CATALOG, new Map([['roza', 5]]))), ['muszla'], 'stan obniżony w panelu poniżej sprzedaży');
});
