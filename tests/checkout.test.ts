import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, summaryText, validate } from '../src/lib/checkout.ts';
import { totals } from '../src/lib/pricing.ts';
import { cart, checkout } from '../src/i18n/pl.ts';

const texts = { text: checkout.text, free: cart.free };

const ok = { name: 'Anna Kowalska', email: 'anna@example.pl', phone: '+48 600-100-200', locker: 'kra01m', terms: true };

test('walidacja: poprawne dane i typowe błędy', () => {
  assert.deepEqual(validate(ok), []);
  assert.deepEqual(validate({ ...ok, name: 'Anna', email: 'anna@', phone: '123', locker: '', terms: false }), ['name', 'email', 'phone', 'locker', 'terms']);
  assert.equal(normalizePhone('(0048) 600 100 200'), '600100200');
});

test('podsumowanie do wiadomości', () => {
  const lines = [{ id: 'a', name: 'Róża', price: 1900, qty: 3 }];
  const text = summaryText(lines, totals(lines, { shipping: 1499, promo2plus1: true }), { ...ok, gift: true }, texts);
  assert.match(text, /Róża × 3/);
  assert.match(text, /Promocja 2\+1: −19,00/);
  assert.match(text, /Paczkomat KRA01M/);
  assert.match(text, /600100200/);
  assert.match(text, /Pakowanie na prezent: tak/);
  assert.doesNotMatch(text, /Uwagi/);
});
