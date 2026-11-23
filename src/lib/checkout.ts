/**
 * Zamówienie: reguły formularza (schemat Zod) i podsumowanie tekstowe.
 * Ten sam schemat sprawdza formularz w przeglądarce i żądanie w API zamówień (worker/services/OrderFactory.ts) -
 * jedno źródło reguł, a serwer nigdy nie ufa wyłącznie przeglądarce.
 * `zod/mini` zamiast `zod`: ta sama biblioteka, ale API funkcyjne, które się „wytrząsa” - ~5 KB gzip zamiast ~90 KB.
 * Teksty są wstrzykiwane (nie importowane), żeby nie trafiały do wspólnej paczki JS każdej strony.
 */
import * as z from 'zod/mini';
import type { cart, checkout } from '../i18n/pl.ts';
import { fill } from './i18n.ts';
import { formatGrosze } from './money.ts';
import type { Totals } from './pricing.ts';

/** Liberalnie: spacje, myślniki, nawiasy i prefiks +48/0048 są dozwolone. */
export const normalizePhone = (v: string) => v.replace(/[\s\-()]/g, '').replace(/^(\+48|0048)/, '');
export const normalizeLocker = (v: string) => v.trim().toUpperCase();

/**
 * Schemat danych formularza. Pola są normalizowane (`overwrite`) przed sprawdzeniem,
 * więc wynik parsowania to od razu dane do zapisu: telefon 9 cyfr, kod paczkomatu wielkimi literami.
 */
export const orderFormSchema = z.object({
  /** Imię i nazwisko - trafią na etykietę paczki. */
  name: z.string().check(z.trim(), z.regex(/^\S+(\s+\S+)+$/)),
  /** z.email(): bez przecinków, nawiasów i kilku adresów w jednym polu (e-mail trafia do Resend jako odbiorca). */
  email: z.pipe(z.string().check(z.trim(), z.maxLength(254)), z.email()),
  phone: z.string().check(z.overwrite(normalizePhone), z.regex(/^\d{9}$/)),
  locker: z.string().check(z.overwrite(normalizeLocker), z.regex(/^[A-Z0-9-]{4,12}$/)),
  terms: z.literal(true),
  gift: z.optional(z.boolean()),
  notes: z.optional(z.string()),
});

/** Surowe dane z formularza (przed walidacją). */
export interface OrderForm {
  name: string;
  email: string;
  phone: string;
  locker: string;
  gift?: boolean;
  notes?: string;
  terms: boolean;
}
export type ValidOrderForm = z.output<typeof orderFormSchema>;

/** Limity zamówienia (wspólne dla formularza i API): rezerwacja bez płatności zabiera sztuki innym na 45 min. */
export const MAX_QTY_PER_LINE = 10;
export const MAX_UNITS_PER_ORDER = 20;
export const MAX_LINES_PER_ORDER = 20;

/** Czy koszyk mieści się w limitach zamówienia. */
export const withinOrderLimits = (lines: readonly { qty: number }[]) =>
  lines.length <= MAX_LINES_PER_ORDER && lines.every((l) => l.qty <= MAX_QTY_PER_LINE) && lines.reduce((s, l) => s + l.qty, 0) <= MAX_UNITS_PER_ORDER;

/** Pola z komunikatem błędu w formularzu - w kolejności wyświetlania. */
export const FIELDS = ['name', 'email', 'phone', 'locker', 'terms'] as const;
export type Field = (typeof FIELDS)[number];

const isField = (key: unknown): key is Field => (FIELDS as readonly unknown[]).includes(key);

/** Sprawdza formularz: dane znormalizowane albo lista pól z błędami (w kolejności FIELDS). */
export function parseOrderForm(form: unknown): { ok: true; data: ValidOrderForm } | { ok: false; fields: Field[] } {
  const r = z.safeParse(orderFormSchema, form);
  if (r.success) return { ok: true, data: r.data };
  const invalid = new Set(r.error.issues.map((i) => i.path[0]).filter(isField));
  return { ok: false, fields: FIELDS.filter((f) => invalid.has(f)) };
}

/** Zwraca listę pól z błędami (pusta = poprawne). */
export const validate = (form: OrderForm): Field[] => {
  const r = parseOrderForm(form);
  return r.ok ? [] : r.fields;
};

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
