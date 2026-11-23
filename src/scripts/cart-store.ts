/**
 * Stan koszyka w przeglądarce: trwałość (localStorage), zdarzenia i uzgadnianie z katalogiem.
 * Logika cen: src/lib/pricing.ts. Widok: src/scripts/cart-ui.ts.
 *
 * Wielu klientów naraz: koszyk każdego klienta żyje tylko w jego przeglądarce (serwer niczego nie trzyma),
 * a ceny i stany są uzgadniane z /katalog.json (statyczny, buforowany na CDN). Ostateczną weryfikację
 * i atomową rezerwację stanu robi serwer przy tworzeniu zamówienia.
 */
import type { CartLine, ShopConfig } from '../lib/pricing.ts';

export interface CartItem extends CartLine {
  name: string;
  max: number; // stan magazynowy znany klientowi
  url: string;
  img?: string;
}

/** Wpis katalogu: [nazwa, cena w groszach, stan, url, miniatura]. Tablice zamiast obiektów = mniej bajtów. */
export type CatalogRow = [name: string, price: number, max: number, url: string, img?: string];
export type Catalog = Record<string, CatalogRow>;

/** Zmiana wersji klucza unieważnia stare koszyki (np. po zmianie formatu). */
export const STORAGE_KEY = 'byn-cart-v1';
export const CHANGE_EVENT = 'cart:change';
export const UPDATED_EVENT = 'cart:updated';
const SYNC_KEY = 'byn-cart-sync';
const SYNC_TTL_MS = 60_000;

export function read(): CartItem[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(data) ? data.filter((i): i is CartItem => typeof i?.id === 'string' && i.qty > 0) : [];
  } catch {
    return [];
  }
}

function write(items: CartItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* tryb prywatny / brak miejsca - koszyk działa do końca życia strony */
  }
  document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

const clamp = (qty: number, max: number) => Math.max(0, Math.min(Math.floor(qty), Math.max(0, max)));

/** Dodaje sztukę; false, gdy osiągnięto stan magazynowy. */
export function add(item: Omit<CartItem, 'qty'>): boolean {
  const items = read();
  const current = items.find((i) => i.id === item.id);
  const next = clamp((current?.qty ?? 0) + 1, item.max);
  if (next === (current?.qty ?? 0)) return false;
  write(current ? items.map((i) => (i.id === item.id ? { ...i, ...item, qty: next } : i)) : [...items, { ...item, qty: next }]);
  return true;
}

export function setQty(id: string, qty: number): void {
  write(read().map((i) => (i.id === id ? { ...i, qty: clamp(qty, i.max) } : i)).filter((i) => i.qty > 0));
}

export const remove = (id: string): void => write(read().filter((i) => i.id !== id));

/** Czyści koszyk - po potwierdzonej płatności. */
export const clear = (): void => write([]);

/**
 * Ostatnie nieopłacone zamówienie z tej przeglądarki (UUID). Przy ponownej próbie serwer je anuluje
 * i zwalnia sztuki - inaczej klient blokowałby sam sobie ostatnią sztukę do końca rezerwacji.
 */
export const PENDING_ORDER_KEY = 'byn-pending-order';

/** Konfiguracja sklepu osadzona raz na stronie (Base.astro → #shop-config). */
export function readConfig(): ShopConfig {
  const el = document.getElementById('shop-config');
  return el ? (JSON.parse(el.textContent ?? '{}') as ShopConfig) : { shipping: 0, promo2plus1: false };
}

/** Czysta funkcja: dopasowuje koszyk do katalogu. Zwraca nowy koszyk i informację, czy coś się zmieniło. */
export function reconcile(items: CartItem[], catalog: Catalog): { items: CartItem[]; changed: boolean } {
  let changed = false;
  const next = items.flatMap((i) => {
    const row = catalog[i.id];
    if (!row) {
      changed = true;
      return [];
    }
    const [name, price, max, url, img] = row;
    const qty = clamp(i.qty, max);
    if (qty !== i.qty || price !== i.price || max !== i.max) changed = true;
    return qty > 0 ? [{ ...i, name, price, max, url, img, qty }] : [];
  });
  return { items: next, changed };
}

/** Uzgadnia koszyk z /katalog.json (najwyżej raz na minutę na kartę, chyba że `force`). */
export async function sync(force = false): Promise<void> {
  if (read().length === 0) return;
  try {
    const last = Number(sessionStorage.getItem(SYNC_KEY) ?? 0);
    if (!force && Date.now() - last < SYNC_TTL_MS) return;
    const res = await fetch('/katalog.json', { cache: 'no-cache' }); // walidacja ETag → zwykle 304
    if (!res.ok) return;
    const result = reconcile(read(), (await res.json()) as Catalog);
    sessionStorage.setItem(SYNC_KEY, String(Date.now()));
    if (result.changed) {
      write(result.items);
      document.dispatchEvent(new CustomEvent(UPDATED_EVENT));
    }
  } catch {
    /* offline - zostaje koszyk lokalny, serwer i tak zweryfikuje zamówienie */
  }
}

/** Synchronizacja między kartami przeglądarki. */
export function onExternalChange(cb: () => void): void {
  window.addEventListener('storage', (e) => e.key === STORAGE_KEY && cb());
}
