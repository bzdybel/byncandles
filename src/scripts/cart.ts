/**
 * Koszyk po stronie przeglądarki (localStorage). Bez frameworka.
 * Wszystkie kwoty w groszach. Ceny i stany są ponownie weryfikowane po stronie serwera przy płatności (kolejny etap).
 */
export interface CartItem {
  id: string;
  name: string;
  price: number; // grosze
  qty: number;
  max: number; // stan magazynowy
  img?: string;
  url: string;
}

export interface CartConfig {
  shipping: number; // grosze — Paczkomat InPost
  freeFrom?: number; // grosze — darmowa dostawa od
  promo2plus1: boolean;
}

export interface CartTotals {
  count: number;
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  missingForFree?: number;
}

const KEY = 'byn-cart-v1';
export const CHANGE_EVENT = 'cart:change';

export function read(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : [];
    return Array.isArray(data) ? data.filter((i) => i && typeof i.id === 'string' && i.qty > 0) : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* tryb prywatny / brak miejsca — koszyk działa do końca sesji strony */
  }
  document.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: items }));
}

const clamp = (q: number, max: number) => Math.max(0, Math.min(Math.floor(q), Math.max(max, 0)));

/** Dodaje sztukę; zwraca false, gdy osiągnięto stan magazynowy. */
export function add(item: Omit<CartItem, 'qty'>, qty = 1): boolean {
  const items = read();
  const existing = items.find((i) => i.id === item.id);
  const current = existing?.qty ?? 0;
  const next = clamp(current + qty, item.max);
  if (next === current) return false;
  if (existing) Object.assign(existing, item, { qty: next });
  else items.push({ ...item, qty: next });
  write(items);
  return true;
}

export function setQty(id: string, qty: number) {
  const items = read()
    .map((i) => (i.id === id ? { ...i, qty: clamp(qty, i.max) } : i))
    .filter((i) => i.qty > 0);
  write(items);
}

export const remove = (id: string) => write(read().filter((i) => i.id !== id));
export const clear = () => write([]);

/** 2+1: w każdej trójce sztuk najtańsza gratis (liczone od najtańszych). */
export function promoDiscount(items: CartItem[]): number {
  const units = items.flatMap((i) => Array.from({ length: i.qty }, () => i.price)).sort((a, b) => a - b);
  const free = Math.floor(units.length / 3);
  return units.slice(0, free).reduce((s, p) => s + p, 0);
}

export function totals(items: CartItem[], cfg: CartConfig): CartTotals {
  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = cfg.promo2plus1 ? promoDiscount(items) : 0;
  const afterDiscount = subtotal - discount;
  const isFree = cfg.freeFrom !== undefined && afterDiscount >= cfg.freeFrom;
  const shipping = count === 0 || isFree ? 0 : cfg.shipping;
  return {
    count,
    subtotal,
    discount,
    shipping,
    total: afterDiscount + shipping,
    missingForFree: cfg.freeFrom !== undefined && !isFree ? cfg.freeFrom - afterDiscount : undefined,
  };
}

const pln = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' });
export const fmt = (grosze: number) => pln.format(grosze / 100);

/** „1 produkt”, „2 produkty”, „5 produktów”. */
export function plural(n: number, [one, few, many]: [string, string, string]) {
  if (n === 1) return one;
  const d = n % 10;
  const t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

export function readConfig(el: HTMLElement | null): CartConfig {
  const n = (v?: string) => (v === undefined || v === '' ? undefined : Number(v));
  return {
    shipping: n(el?.dataset.shipping) ?? 0,
    freeFrom: n(el?.dataset.freeFrom),
    promo2plus1: el?.dataset.promo === 'true',
  };
}
