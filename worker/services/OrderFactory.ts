/**
 * Surowe żądanie przeglądarki → dane zamówienia (czysta funkcja).
 *
 * 1. `requestSchema` (Zod): kształt żądania - tekst oczyszczony ze znaków sterujących i przycięty do limitów,
 *    nie-obiekt / zły typ pola → wartość pusta (błąd pokaże reguła pola), pozycje osobnym, ścisłym schematem.
 * 2. `parseOrderForm`: reguły pól - TEN SAM schemat co formularz w przeglądarce (src/lib/checkout.ts).
 * 3. Ceny i nazwy wyłącznie z katalogu z buildu - klient przysyła tylko id + qty.
 */
import * as z from 'zod/mini';
import { parseOrderForm, type Field } from '../../src/lib/checkout.ts';
import { totals, type ShopConfig } from '../../src/lib/pricing.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import { MIN_ORDER_TOTAL, type NewOrder, type OrderItem } from '../domain/order.ts';
import { InsufficientStockError, ValidationError } from '../errors/AppError.ts';
import { uuidSchema } from '../utils/ports.ts';

const MAX_QTY = 50;
const MAX_LINES = 30;

/** Tekst z pola: zły typ → '', bez znaków sterujących (nowa linia dozwolona w uwagach), przycięty do `max`. */
const text = (max: number, multiline = false) =>
  z.pipe(
    z.catch(z.string(), ''),
    z.transform((v) =>
      v
        .replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ')
        .trim()
        .slice(0, max),
    ),
  );

/** Wyłącznie `true` z JSON-a (nie "true", nie 1) - zgoda na regulamin musi być jawna. */
const flag = z.catch(z.boolean(), false);

export const itemsSchema = z.array(z.object({ id: z.string().check(z.minLength(1), z.maxLength(100)), qty: z.int().check(z.gte(1), z.lte(MAX_QTY)) })).check(
  z.minLength(1),
  z.maxLength(MAX_LINES),
  z.refine((items) => new Set(items.map((i) => i.id)).size === items.length, 'duplicate product'),
);

export const requestSchema = z.pipe(
  z.transform((v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})),
  z.object({
    name: text(100),
    email: text(254),
    phone: text(30),
    locker: text(20),
    notes: text(500, true),
    gift: flag,
    terms: flag,
    items: z.optional(z.unknown()),
    previous: z.catch(z.optional(uuidSchema), undefined),
  }),
);

export interface ParsedOrder {
  fields: Pick<NewOrder, 'customerName' | 'email' | 'phone' | 'deliveryPointId' | 'gift' | 'notes' | 'itemsTotal' | 'discount' | 'deliveryCost' | 'total'>;
  items: OrderItem[];
  previousOrderId?: string;
}

/**
 * @param catalog katalog po odjęciu zajętych sztuk - wstępna kontrola stanu (ostateczna: rezerwacja w D1)
 * @throws ValidationError (pola formularza + 'items') | InsufficientStockError
 */
export function parseOrderRequest(body: unknown, catalog: Catalog, cfg: ShopConfig): ParsedOrder {
  const req = z.parse(requestSchema, body); // nie rzuca: każde pole ma wartość zastępczą
  const form = parseOrderForm(req);
  const items = z.safeParse(itemsSchema, req.items);
  const invalid: (Field | 'items')[] = [...(form.ok ? [] : form.fields), ...(items.success ? [] : ['items' as const])];
  if (!form.ok || !items.success) throw new ValidationError(invalid);

  const missing = items.data.filter(({ id, qty }) => !catalog[id] || qty > catalog[id][2]).map(({ id }) => id);
  if (missing.length) throw new InsufficientStockError(missing);

  const lines: OrderItem[] = items.data.map(({ id, qty }) => ({ productId: id, name: catalog[id][0], unitPrice: catalog[id][1], quantity: qty }));
  const sum = totals(lines.map((i) => ({ id: i.productId, price: i.unitPrice, qty: i.quantity })), cfg);
  // P24 nie przyjmie transakcji poniżej 1 zł (np. produkt z ceną 0 w panelu).
  if (sum.total < MIN_ORDER_TOTAL) throw new ValidationError(['items']);

  const f = form.data;
  return {
    fields: {
      customerName: f.name,
      email: f.email,
      phone: f.phone,
      deliveryPointId: f.locker,
      gift: f.gift === true,
      notes: f.notes || null,
      itemsTotal: sum.subtotal,
      discount: sum.discount,
      deliveryCost: sum.shipping,
      total: sum.total,
    },
    items: lines,
    previousOrderId: req.previous,
  };
}
