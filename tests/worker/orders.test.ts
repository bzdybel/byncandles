import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderNumber, parseOrderRequest } from '../../worker/services/OrderFactory.ts';
import { InsufficientStockError, ValidationError } from '../../worker/errors/AppError.ts';
import { applyReserved } from '../../worker/services/StockService.ts';
import { CATALOG, CONFIG, ORDER_BODY } from './helpers.ts';

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

test('zamówienie: błędne pola i pozycje → ValidationError z listą pól', () => {
  assert.throws(
    () => parseOrderRequest({ ...ORDER_BODY, email: 'x', terms: false, items: [{ id: 'roza', qty: 0 }] }, CATALOG, CONFIG),
    (e: unknown) => e instanceof ValidationError && JSON.stringify(e.details) === JSON.stringify({ fields: ['email', 'terms', 'items'] }),
  );
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'roza', qty: 1 }, { id: 'roza', qty: 1 }] }, CATALOG, CONFIG), ValidationError);
  assert.throws(() => parseOrderRequest(null, CATALOG, CONFIG), ValidationError);
});

test('zamówienie: więcej niż na stanie albo produkt spoza katalogu → InsufficientStockError', () => {
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'muszla', qty: 2 }] }, CATALOG, CONFIG), InsufficientStockError);
  assert.throws(() => parseOrderRequest({ ...ORDER_BODY, items: [{ id: 'nie-ma', qty: 1 }] }, CATALOG, CONFIG), InsufficientStockError);
});

test('numer zamówienia: BN- + 6 znaków bez mylących', () => {
  assert.match(orderNumber(new Uint8Array([0, 1, 2, 3, 4, 255])), /^BN-[2-9A-HJKMNP-Z]{6}$/);
});

test('katalog: odejmuje zajęte sztuki, wyprzedane znikają', () => {
  const out = applyReserved(CATALOG, new Map([['roza', 1], ['muszla', 1]]));
  assert.deepEqual(Object.keys(out), ['roza']);
  assert.equal(out.roza[2], 1);
});
