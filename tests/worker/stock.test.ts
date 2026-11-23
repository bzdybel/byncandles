import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderStorage, type NewOrder, type OrderItem } from '../../worker/storage/OrderStorage.ts';
import { InsufficientStockError } from '../../worker/errors/AppError.ts';
import { OrderStatus } from '../../worker/constants/orderStatus.ts';
import { RESERVATION_MS } from '../../worker/services/StockService.ts';
import { createD1 } from './helpers.ts';

const NOW = 1_800_000_000_000;
let seq = 0;
const newOrder = (createdAt = NOW): NewOrder => {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    number: `BN-T${seq}`,
    correlationId: 'c',
    createdAt,
    customerName: 'Anna Kowalska',
    email: 'a@b.pl',
    phone: '600100200',
    deliveryPointId: 'KRA01M',
    gift: false,
    notes: null,
    itemsTotal: 3000,
    discount: 0,
    deliveryCost: 0,
    total: 3000,
  };
};
const ITEM: OrderItem = { productId: 'muszla', name: 'Muszla', unitPrice: 3000, quantity: 1 };
const cutoff = NOW - RESERVATION_MS;

test('rezerwacja: ostatniej sztuki nie kupią dwie osoby, nieudany batch nic nie zapisuje', async () => {
  const db = createD1();
  const s = new OrderStorage(db);
  const a = newOrder();
  const b = newOrder();
  await s.insertWithReservation(a, [ITEM], { muszla: 1 }, cutoff);
  await assert.rejects(s.insertWithReservation(b, [ITEM], { muszla: 1 }, cutoff), InsufficientStockError);
  assert.equal(await s.getById(b.id), null, 'zamówienie B wycofane razem z pozycją');
  assert.equal((await s.reservedCounts(cutoff)).get('muszla'), 1);
});

test('rezerwacja: brak jednej z pozycji wycofuje całe zamówienie', async () => {
  const s = new OrderStorage(createD1());
  const o = newOrder();
  const roza: OrderItem = { productId: 'roza', name: 'Róża', unitPrice: 4000, quantity: 1 };
  await assert.rejects(s.insertWithReservation(o, [roza, { ...ITEM, quantity: 2 }], { roza: 5, muszla: 1 }, cutoff), InsufficientStockError);
  assert.equal((await s.reservedCounts(cutoff)).size, 0);
});

test('rezerwacja: nieopłacone po czasie rezerwacji oddaje sztukę, opłacone trzyma zawsze', async () => {
  const s = new OrderStorage(createD1());
  const old = newOrder(NOW - RESERVATION_MS - 1);
  await s.insertWithReservation(old, [ITEM], { muszla: 1 }, old.createdAt - RESERVATION_MS);
  assert.equal((await s.reservedCounts(cutoff)).get('muszla'), undefined, 'wygasła rezerwacja nie liczy się');

  const fresh = newOrder();
  await s.insertWithReservation(fresh, [ITEM], { muszla: 1 }, cutoff);
  assert.ok(await s.markPaid(fresh.id, 'p24-1', NOW));
  assert.equal(await s.markPaid(fresh.id, 'p24-1', NOW), false, 'drugie opłacenie = powtórzenie');
  assert.equal((await s.reservedCounts(NOW + 10 * RESERVATION_MS)).get('muszla'), 1, 'opłacone nie wygasa');
});

test('rezerwacja: ponowna próba z tej samej przeglądarki zwalnia poprzednie zamówienie', async () => {
  const s = new OrderStorage(createD1());
  const first = newOrder();
  await s.insertWithReservation(first, [ITEM], { muszla: 1 }, cutoff);
  const retry = newOrder();
  const r = await s.insertWithReservation(retry, [ITEM], { muszla: 1 }, cutoff, first.id);
  assert.equal(r.canceledPrevious, true);
  assert.equal((await s.getById(first.id))?.status, OrderStatus.CANCELED);
});

test('rezerwacja: opłaconego zamówienia nie da się anulować ani wygasić', async () => {
  const s = new OrderStorage(createD1());
  const o = newOrder();
  await s.insertWithReservation(o, [ITEM], { muszla: 1 }, cutoff);
  await s.markPaid(o.id, 'x', NOW);
  assert.equal(await s.markReleased(o.id, OrderStatus.EXPIRED), false);
  const retry = newOrder();
  await assert.rejects(s.insertWithReservation(retry, [ITEM], { muszla: 1 }, cutoff, o.id), InsufficientStockError);
  assert.equal((await s.getById(o.id))?.status, OrderStatus.PAID);
});
