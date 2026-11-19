import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoDiscount, totals } from '../src/lib/pricing.ts';
import { formatGrosze, toGrosze } from '../src/lib/money.ts';
import { fill, plural } from '../src/lib/i18n.ts';

const cfg = { shipping: 1499, freeFrom: 15000, promo2plus1: true };

test('2+1: najtańsza co trzecia sztuka gratis', () => {
  assert.equal(promoDiscount([{ id: 'a', price: 1900, qty: 2 }]), 0);
  assert.equal(promoDiscount([{ id: 'a', price: 1900, qty: 3 }]), 1900);
  // 5 × 19 zł + 39 zł → 6 sztuk → 2 gratis (dwie najtańsze)
  assert.equal(promoDiscount([{ id: 'a', price: 1900, qty: 5 }, { id: 'b', price: 3900, qty: 1 }]), 3800);
  assert.equal(promoDiscount([{ id: 'a', price: 2500, qty: 1 }, { id: 'b', price: 3500, qty: 1 }, { id: 'c', price: 4500, qty: 1 }]), 2500);
});

test('sumy: dostawa, darmowa dostawa po rabacie, pusty koszyk', () => {
  const t = totals([{ id: 'a', price: 2500, qty: 1 }], cfg);
  assert.deepEqual([t.subtotal, t.discount, t.shipping, t.total, t.missingForFree], [2500, 0, 1499, 3999, 12500]);
  const free = totals([{ id: 'a', price: 6000, qty: 3 }], cfg); // 180 − 60 = 120 < 150 → płatna
  assert.equal(free.shipping, 1499);
  const free2 = totals([{ id: 'a', price: 8000, qty: 3 }], cfg); // 240 − 80 = 160 ≥ 150 → darmowa
  assert.deepEqual([free2.shipping, free2.missingForFree, free2.freeProgress], [0, undefined, 1]);
  assert.equal(totals([], cfg).total, 0);
  assert.equal(totals([{ id: 'a', price: 1900, qty: 3 }], { ...cfg, promo2plus1: false }).discount, 0);
});

test('kwoty: grosze bez błędów zmiennoprzecinkowych', () => {
  assert.equal(toGrosze(19.99), 1999);
  assert.equal(toGrosze(0.1 + 0.2), 30);
  assert.equal(formatGrosze(1999).replace(/\s/g, ' '), '19,99 zł');
});

test('i18n: zmienne i odmiana', () => {
  assert.equal(fill('Zostało {n} szt.', { n: 2 }), 'Zostało 2 szt.');
  assert.equal(fill('{a} {b}', { a: 'x' }), 'x {b}');
  const p = ['produkt', 'produkty', 'produktów'] as const;
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25, 101].map((n) => plural(n, p)), ['produkt', 'produkty', 'produkty', 'produktów', 'produktów', 'produktów', 'produkty', 'produktów', 'produktów']);
});

test('uzgadnianie koszyka z katalogiem (zmiana ceny, stanu, wyprzedanie)', async () => {
  const { reconcile } = await import('../src/scripts/cart-store.ts');
  const items = [
    { id: 'roza', name: 'Róża', price: 2500, qty: 3, max: 5, url: '/sklep/roza/' },
    { id: 'muszla', name: 'Muszla', price: 3900, qty: 1, max: 2, url: '/sklep/muszla/' },
    { id: 'krowka', name: 'Krówka', price: 3500, qty: 1, max: 1, url: '/sklep/krowka/' },
  ];
  const catalog = {
    roza: ['Róża', 1900, 2, '/sklep/roza/'] as [string, number, number, string],
    muszla: ['Muszla', 3900, 2, '/sklep/muszla/'] as [string, number, number, string],
  };
  const { items: next, changed } = reconcile(items, catalog);
  assert.equal(changed, true);
  assert.deepEqual(next.map((i) => [i.id, i.price, i.qty]), [['roza', 1900, 2], ['muszla', 3900, 1]]);
  assert.equal(reconcile(next, catalog).changed, false);
});
