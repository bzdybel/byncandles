/**
 * Czysta funkcja: surowe żądanie przeglądarki → zamówienie do zapisu.
 * Klient przysyła tylko dane formularza oraz id + qty - ceny i nazwy bierzemy wyłącznie z katalogu z buildu,
 * walidacja to te same reguły co w formularzu (src/lib/checkout.ts).
 */
import { normalizeLocker, normalizePhone, validate } from '../../src/lib/checkout.ts';
import { totals, type ShopConfig } from '../../src/lib/pricing.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import { InsufficientStockError, ValidationError } from '../errors/AppError.ts';
import type { NewOrder, OrderItem } from '../storage/OrderStorage.ts';
import { isUuid } from '../utils/ports.ts';

const MAX_QTY = 50;
const LIMITS = { name: 100, email: 254, phone: 30, locker: 20, notes: 500 };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface ParsedOrder {
  fields: Pick<NewOrder, 'customerName' | 'email' | 'phone' | 'deliveryPointId' | 'gift' | 'notes' | 'itemsTotal' | 'discount' | 'deliveryCost' | 'total'>;
  items: OrderItem[];
  previousOrderId?: string;
}

/**
 * @param catalog katalog po odjęciu zajętych sztuk - wstępna kontrola stanu (ostateczna: rezerwacja w D1)
 * @throws ValidationError | InsufficientStockError
 */
export function parseOrderRequest(body: unknown, catalog: Catalog, cfg: ShopConfig): ParsedOrder {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const form = {
    name: str(b.name, LIMITS.name),
    email: str(b.email, LIMITS.email),
    phone: normalizePhone(str(b.phone, LIMITS.phone)),
    locker: normalizeLocker(str(b.locker, LIMITS.locker)),
    gift: b.gift === true,
    notes: str(b.notes, LIMITS.notes),
    terms: b.terms === true,
  };
  const invalid: string[] = validate(form);

  const raw = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
  const qtyById = new Map<string, number>();
  for (const i of raw) {
    const id = typeof i?.id === 'string' ? i.id : '';
    const qty = Number(i?.qty);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY || qtyById.has(id)) continue;
    qtyById.set(id, qty);
  }
  if (qtyById.size === 0 || qtyById.size !== raw.length) invalid.push('items');
  if (invalid.length) throw new ValidationError(invalid);

  const missing = [...qtyById].filter(([id, qty]) => !catalog[id] || qty > catalog[id][2]).map(([id]) => id);
  if (missing.length) throw new InsufficientStockError(missing);

  const items: OrderItem[] = [...qtyById].map(([id, qty]) => ({ productId: id, name: catalog[id][0], unitPrice: catalog[id][1], quantity: qty }));
  const sum = totals(items.map((i) => ({ id: i.productId, price: i.unitPrice, qty: i.quantity })), cfg);

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

/** Numer dla ludzi: BN- + 6 znaków bez mylących (0/O, 1/I/L). */
export function orderNumber(random: Uint8Array): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return `BN-${[...random].map((b) => alphabet[b % alphabet.length]).join('')}`;
}
