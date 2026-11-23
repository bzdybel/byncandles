import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuplicateOrderNumberError, OrderStorage } from '../../worker/storage/OrderStorage.ts';
import { InsufficientStockError } from '../../worker/errors/AppError.ts';
import { OrderStatus, RESERVATION_MS, type NewOrder, type OrderItem } from '../../worker/domain/order.ts';
import { createD1 } from './helpers.ts';

const NOW = 1_800_000_000_000;
let seq = 0;
const newOrder = (createdAt = NOW, number?: string): NewOrder => {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    number: number ?? `BN-T${seq}`,
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
const sold = (db: ReturnType<typeof createD1>, id = 'muszla') => (db.raw.prepare('SELECT sold FROM product_sales WHERE product_id = ?').get(id) as { sold: number } | undefined)?.sold;

test('rezerwacja: ostatniej sztuki nie kupią dwie osoby, nieudany batch nic nie zapisuje', async () => {
  const s = new OrderStorage(createD1());
  const a = newOrder();
  const b = newOrder();
  await s.insertWithReservation(a, [ITEM], { muszla: 1 }, cutoff);
  await assert.rejects(s.insertWithReservation(b, [ITEM], { muszla: 1 }, cutoff), InsufficientStockError);
  assert.equal(await s.getById(b.id), null, 'zamówienie B wycofane razem z pozycją');
  assert.equal((await s.reservedCounts(cutoff)).get('muszla'), 1);
});

test('rezerwacja: brak jednej z pozycji wycofuje całe zamówienie', async () => {
  const s = new OrderStorage(createD1());
  const roza: OrderItem = { productId: 'roza', name: 'Róża', unitPrice: 4000, quantity: 1 };
  await assert.rejects(s.insertWithReservation(newOrder(), [roza, { ...ITEM, quantity: 2 }], { roza: 5, muszla: 1 }, cutoff), InsufficientStockError);
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
  assert.equal((await s.reservedCounts(NOW + 10 * RESERVATION_MS)).get('muszla'), 1, 'opłacone nie wygasa');
});

test('sprzedaż: licznik doliczany raz - powtórzone opłacenie nie podwaja sztuk', async () => {
  const db = createD1();
  const s = new OrderStorage(db);
  const o = newOrder();
  await s.insertWithReservation(o, [{ ...ITEM, quantity: 2 }], { muszla: 5 }, cutoff);
  assert.equal(await s.markPaid(o.id, 'p24-1', NOW), true);
  assert.equal(await s.markPaid(o.id, 'p24-1', NOW), false);
  assert.equal(sold(db), 2);
  assert.equal((await s.reservedCounts(cutoff)).get('muszla'), 2, 'opłacone liczone z licznika, nie podwójnie z rezerwacji');

  const next = newOrder();
  await s.insertWithReservation(next, [{ ...ITEM, quantity: 3 }], { muszla: 5 }, cutoff);
  await assert.rejects(s.insertWithReservation(newOrder(), [ITEM], { muszla: 5 }, cutoff), InsufficientStockError, '2 sprzedane + 3 zarezerwowane = 5');
});

test('sprzedaż: opłacenie zamówienia po wygaśnięciu też dolicza sprzedaż', async () => {
  const db = createD1();
  const s = new OrderStorage(db);
  const o = newOrder();
  await s.insertWithReservation(o, [ITEM], { muszla: 1 }, cutoff);
  await s.markReleased(o.id, OrderStatus.EXPIRED);
  assert.ok(await s.markPaid(o.id, 'late', NOW));
  assert.equal(sold(db), 1);
});

test('rezerwacja: ponowna próba z tej samej przeglądarki zwalnia poprzednie zamówienie', async () => {
  const s = new OrderStorage(createD1());
  const first = newOrder();
  await s.insertWithReservation(first, [ITEM], { muszla: 1 }, cutoff);
  const r = await s.insertWithReservation(newOrder(), [ITEM], { muszla: 1 }, cutoff, first.id);
  assert.equal(r.canceledPrevious, true);
  assert.equal((await s.getById(first.id))?.status, OrderStatus.CANCELED);
});

test('rezerwacja: opłaconego zamówienia nie da się anulować ani wygasić', async () => {
  const s = new OrderStorage(createD1());
  const o = newOrder();
  await s.insertWithReservation(o, [ITEM], { muszla: 1 }, cutoff);
  await s.markPaid(o.id, 'x', NOW);
  assert.equal(await s.markReleased(o.id, OrderStatus.EXPIRED), false);
  await assert.rejects(s.insertWithReservation(newOrder(), [ITEM], { muszla: 1 }, cutoff, o.id), InsufficientStockError);
  assert.equal((await s.getById(o.id))?.status, OrderStatus.PAID);
});

test('numer zamówienia: kolizja → DuplicateOrderNumberError (serwis losuje nowy)', async () => {
  const s = new OrderStorage(createD1());
  await s.insertWithReservation(newOrder(NOW, 'BN-SAME'), [ITEM], { muszla: 5 }, cutoff);
  await assert.rejects(s.insertWithReservation(newOrder(NOW, 'BN-SAME'), [ITEM], { muszla: 5 }, cutoff), DuplicateOrderNumberError);
});

test('lease: drugi wykonawca nie dostaje zamówienia, wygasły lease można przejąć', async () => {
  const s = new OrderStorage(createD1());
  const o = newOrder();
  await s.insertWithReservation(o, [ITEM], { muszla: 1 }, cutoff);
  assert.equal(await s.acquireLease(o.id, NOW, NOW + 1000), false, 'nieopłacone - bez realizacji');
  await s.markPaid(o.id, 'x', NOW);
  assert.equal(await s.acquireLease(o.id, NOW, NOW + 1000), true);
  assert.equal(await s.acquireLease(o.id, NOW + 500, NOW + 1500), false);
  assert.equal(await s.acquireLease(o.id, NOW + 1001, NOW + 2000), true, 'po awarii lease wygasa');
});

test('migracja 0002: dotychczasowa sprzedaż trafia do licznika', async () => {
  const db = createD1(['0001_orders.sql']);
  const s = new OrderStorage(db);
  db.raw.exec(`INSERT INTO orders (id, number, status, correlation_id, created_at, customer_name, email, phone, delivery_point_id, items_total, discount, delivery_cost, total)
    VALUES ('o1', 'BN-1', 'PAID', 'c', 1, 'A B', 'a@b.pl', '600100200', 'KRA01M', 1, 0, 0, 1),
           ('o2', 'BN-2', 'EXPIRED', 'c', 1, 'A B', 'a@b.pl', '600100200', 'KRA01M', 1, 0, 0, 1);
    INSERT INTO order_items VALUES ('o1', 'muszla', 'Muszla', 1, 2), ('o2', 'muszla', 'Muszla', 1, 7);`);
  db.raw.exec((await import('node:fs')).readFileSync(new URL('../../migrations/0002_sales_and_lease.sql', import.meta.url), 'utf8'));
  assert.equal(sold(db), 2);
  assert.equal(await s.markPaid('o1', 'x', NOW), false, 'już opłacone');
  assert.equal(sold(db), 2, 'bez podwójnego liczenia po migracji');
});
