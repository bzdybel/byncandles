/**
 * Zamówienie: walidacja danych i podsumowanie tekstowe. Czyste funkcje - te same reguły
 * użyje przyszłe API zamówień po stronie serwera (nigdy nie ufamy wyłącznie przeglądarce).
 * Teksty są wstrzykiwane (nie importowane), żeby nie trafiały do wspólnej paczki JS każdej strony.
 */
import type { cart, checkout } from '../i18n/pl.ts';
import { fill } from './i18n.ts';
import { formatGrosze } from './money.ts';
import type { Totals } from './pricing.ts';

export interface OrderForm {
  name: string;
  email: string;
  phone: string;
  locker: string;
  gift?: boolean;
  notes?: string;
  terms: boolean;
}

/** Liberalnie: spacje, myślniki, nawiasy i prefiks +48/0048 są dozwolone. */
export const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/^(\+48|0048)/, '');
export const normalizeLocker = (v: string) => v.trim().toUpperCase();

const VALIDATORS = {
  name: (f: OrderForm) => f.name.trim().split(/\s+/).length >= 2,
  email: (f: OrderForm) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()),
  phone: (f: OrderForm) => /^\d{9}$/.test(normalizePhone(f.phone)),
  locker: (f: OrderForm) => /^[A-Z0-9-]{4,12}$/.test(normalizeLocker(f.locker)),
  terms: (f: OrderForm) => f.terms,
};

export type Field = keyof typeof VALIDATORS;
export const FIELDS = Object.keys(VALIDATORS) as Field[];

/** Zwraca listę pól z błędami (pusta = poprawne). */
export const validate = (form: OrderForm): Field[] => FIELDS.filter((f) => !VALIDATORS[f](form));

export interface SummaryTexts {
  text: (typeof checkout)['text'];
  free: (typeof cart)['free'];
}
export interface SummaryLine { name: string; qty: number; price: number }

export function summaryText(lines: SummaryLine[], totals: Totals, form: OrderForm, t: SummaryTexts): string {
  return [
    t.text.header,
    ...lines.map((l) => fill(t.text.line, { name: l.name, qty: l.qty, price: formatGrosze(l.price * l.qty) })),
    ...(totals.discount ? [fill(t.text.discount, { price: formatGrosze(totals.discount) })] : []),
    fill(t.text.shipping, { locker: normalizeLocker(form.locker), price: totals.shipping ? formatGrosze(totals.shipping) : t.free }),
    fill(t.text.total, { price: formatGrosze(totals.total) }),
    '',
    `${form.name.trim()} · ${form.email.trim()} · ${normalizePhone(form.phone)}`,
    ...(form.gift ? [t.text.gift] : []),
    ...(form.notes?.trim() ? [fill(t.text.notes, { notes: form.notes.trim() })] : []),
  ].join('\n');
}
