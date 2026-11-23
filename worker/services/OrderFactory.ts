/**
 * Czysta funkcja: surowe żądanie przeglądarki → dane zamówienia.
 * Klient przysyła tylko dane formularza oraz id + qty - ceny i nazwy bierzemy wyłącznie z katalogu z buildu,
 * walidacja to te same reguły co w formularzu (src/lib/checkout.ts).
 */
import { normalizeLocker, normalizePhone, validate } from '../../src/lib/checkout.ts';
import { totals, type ShopConfig } from '../../src/lib/pricing.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import { MIN_ORDER_TOTAL, type NewOrder, type OrderItem } from '../domain/order.ts';
import { InsufficientStockError, ValidationError } from '../errors/AppError.ts';
import { isUuid } from '../utils/ports.ts';

const MAX_QTY = 50;
const MAX_LINES = 30;
const LIMITS = { name: 100, email: 254, phone: 30, locker: 20, notes: 500 };

/** Tekst z pola: przycięty, bez znaków sterujących (poza nową linią w uwagach), z limitem długości. */
const text = (v: unknown, max: number, multiline = false) =>
  typeof v === 'string'
    ? v
        .replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ')
        .trim()
        .slice(0, max)
    : '';

export interface ParsedOrder {
  fields: Pick<NewOrder, 'customerName' | 'email' | 'phone' | 'deliveryPointId' | 'gift' | 'notes' | 'itemsTotal' | 'discount' | 'deliveryCost' | 'total'>;
  items: OrderItem[];
  previousOrderId?: string;
}

/** Ilości z żądania: unikalne id, liczby całkowite 1..MAX_QTY. null = pozycje niepoprawne. */
function parseQuantities(raw: unknown): Map<string, number> | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const out = new Map<string, number>();
  for (const i of raw as Array<Record<string, unknown>>) {
    const id = typeof i?.id === 'string' ? i.id : '';
    const qty = Number(i?.qty);
    if (!id || out.has(id) || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return null;
    out.set(id, qty);
  }
  return out;
}

/**
 * @param catalog katalog po odjęciu zajętych sztuk - wstępna kontrola stanu (ostateczna: rezerwacja w D1)
 * @throws ValidationError | InsufficientStockError
 */
export function parseOrderRequest(body: unknown, catalog: Catalog, cfg: ShopConfig): ParsedOrder {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const form = {
    name: text(b.name, LIMITS.name),
    email: text(b.email, LIMITS.email),
    phone: normalizePhone(text(b.phone, LIMITS.phone)),
    locker: normalizeLocker(text(b.locker, LIMITS.locker)),
    gift: b.gift === true,
    notes: text(b.notes, LIMITS.notes, true),
    terms: b.terms === true,
  };
  const quantities = parseQuantities(b.items);
  const invalid: string[] = [...validate(form), ...(quantities ? [] : ['items'])];
  if (invalid.length || !quantities) throw new ValidationError(invalid);

  const missing = [...quantities].filter(([id, qty]) => !catalog[id] || qty > catalog[id][2]).map(([id]) => id);
  if (missing.length) throw new InsufficientStockError(missing);

  const items: OrderItem[] = [...quantities].map(([id, qty]) => ({ productId: id, name: catalog[id][0], unitPrice: catalog[id][1], quantity: qty }));
  const sum = totals(items.map((i) => ({ id: i.productId, price: i.unitPrice, qty: i.quantity })), cfg);
  // P24 nie przyjmie transakcji poniżej 1 zł (np. produkt z ceną 0 w panelu).
  if (sum.total < MIN_ORDER_TOTAL) throw new ValidationError(['items']);

  return {
    fields: {
      customerName: form.name,
      email: form.email,
      phone: form.phone,
      deliveryPointId: form.locker,
      gift: form.gift,
      notes: form.notes || null,
      itemsTotal: sum.subtotal,
      discount: sum.discount,
      deliveryCost: sum.shipping,
      total: sum.total,
    },
    items,
    previousOrderId: isUuid(b.previous) ? b.previous : undefined,
  };
}
