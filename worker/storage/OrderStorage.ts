/**
 * Cały SQL zamówień w jednym miejscu. Kolumny snake_case w D1 ↔ pola camelCase w kodzie (aliasy w SELECT).
 */
import { HOLDING_STATUSES, OrderStatus, type OrderEventType, type OrderStatusType, type WebhookOutcomeType } from '../constants/orderStatus.ts';
import { InsufficientStockError } from '../errors/AppError.ts';
import type { D1Database, D1PreparedStatement } from './d1.ts';

export interface Order {
  id: string;
  number: string;
  status: OrderStatusType;
  correlationId: string;
  createdAt: number;
  paymentProvider: string | null;
  paymentPendingAt: number | null;
  paymentReference: string | null;
  paymentConfirmedAt: number | null;
  customerName: string;
  email: string;
  phone: string;
  deliveryPointId: string;
  gift: boolean;
  notes: string | null;
  itemsTotal: number;
  discount: number;
  deliveryCost: number;
  total: number;
  shipmentId: string | null;
  shipmentStatus: string | null;
  shipmentAttempts: number;
  shipmentError: string | null;
  emailSentAt: number | null;
  emailAttempts: number;
  shopNotifiedAt: number | null;
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export type NewOrder = Pick<
  Order,
  'id' | 'number' | 'correlationId' | 'createdAt' | 'customerName' | 'email' | 'phone' | 'deliveryPointId' | 'gift' | 'notes' | 'itemsTotal' | 'discount' | 'deliveryCost' | 'total'
>;

export interface OrderEventRecord {
  id: number;
  createdAt: number;
  level: 'info' | 'warn' | 'error';
  type: OrderEventType;
  correlationId: string | null;
  data: unknown;
}

export interface WebhookEventInput {
  receivedAt: number;
  provider: string;
  orderId: string | null;
  paymentReference: string | null;
  signatureValid: boolean;
  outcome: WebhookOutcomeType;
  correlationId: string;
  rawPayload: string;
}

const ORDER_COLUMNS = `id, number, status, correlation_id AS correlationId, created_at AS createdAt,
  payment_provider AS paymentProvider, payment_pending_at AS paymentPendingAt, payment_reference AS paymentReference,
  payment_confirmed_at AS paymentConfirmedAt, customer_name AS customerName, email, phone, delivery_point_id AS deliveryPointId,
  gift, notes, items_total AS itemsTotal, discount, delivery_cost AS deliveryCost, total, shipment_id AS shipmentId,
  shipment_status AS shipmentStatus, shipment_attempts AS shipmentAttempts, shipment_error AS shipmentError,
  email_sent_at AS emailSentAt, email_attempts AS emailAttempts, shop_notified_at AS shopNotifiedAt`;

const toOrder = (row: Record<string, unknown> | null): Order | null => (row ? ({ ...row, gift: Boolean(row.gift) } as unknown as Order) : null);

/** Warunek „zamówienie trzyma sztuki”; parametr: granica rezerwacji (created_at musi być późniejsze). */
const HOLDS_STOCK = `(o.status = '${OrderStatus.PAID}' OR (o.status IN (${HOLDING_STATUSES.map((s) => `'${s}'`).join(', ')}) AND o.created_at > ?))`;

export class OrderStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  // ── Stan magazynowy ──────────────────────────────────────────

  /** @param excludeOrderId zamówienie, które i tak zostanie zwolnione (ponowna próba z tej samej przeglądarki) */
  async reservedCounts(cutoff: number, excludeOrderId = ''): Promise<Map<string, number>> {
    const { results } = await this.db
      .prepare(`SELECT i.product_id AS productId, SUM(i.quantity) AS quantity FROM order_items i JOIN orders o ON o.id = i.order_id WHERE ${HOLDS_STOCK} AND o.id != ? GROUP BY i.product_id`)
      .bind(cutoff, excludeOrderId)
      .all<{ productId: string; quantity: number }>();
    return new Map(results.map((r) => [r.productId, r.quantity]));
  }

  /**
   * Zapis zamówienia + rezerwacja sztuk w jednym batchu (transakcja D1).
   * Brak sztuk → INSERT z NULL w kolumnie NOT NULL → błąd → nic nie zostaje zapisane.
   * D1 ma jednego zapisującego, więc dwie osoby nie kupią tej samej ostatniej sztuki.
   * @param stock stan z panelu (przed odjęciem rezerwacji) dla każdego produktu w zamówieniu
   * @param cancelPreviousId nieopłacone zamówienie z tej samej przeglądarki - zwalniamy jego sztuki
   */
  async insertWithReservation(
    order: NewOrder,
    items: OrderItem[],
    stock: Record<string, number>,
    cutoff: number,
    cancelPreviousId?: string,
  ): Promise<{ canceledPrevious: boolean }> {
    const statements: D1PreparedStatement[] = [];
    if (cancelPreviousId) {
      statements.push(
        this.db
          .prepare(`UPDATE orders SET status = '${OrderStatus.CANCELED}' WHERE id = ? AND status IN (${HOLDING_STATUSES.map(() => '?').join(', ')})`)
          .bind(cancelPreviousId, ...HOLDING_STATUSES),
      );
    }
    statements.push(
      this.db
        .prepare(
          `INSERT INTO orders (id, number, status, correlation_id, created_at, customer_name, email, phone, delivery_point_id, gift, notes, items_total, discount, delivery_cost, total)
           VALUES (?, ?, '${OrderStatus.CREATED}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          order.id, order.number, order.correlationId, order.createdAt, order.customerName, order.email, order.phone,
          order.deliveryPointId, order.gift ? 1 : 0, order.notes, order.itemsTotal, order.discount, order.deliveryCost, order.total,
        ),
    );
    for (const item of items) {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity)
             SELECT ?1, ?2, ?3, ?4, CASE WHEN ?6 - COALESCE((
               SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
               WHERE i.product_id = ?2 AND o.id != ?1 AND (o.status = '${OrderStatus.PAID}' OR (o.status IN ('${OrderStatus.CREATED}', '${OrderStatus.PAYMENT_PENDING}') AND o.created_at > ?7))
             ), 0) >= ?5 THEN ?5 END`,
          )
          .bind(order.id, item.productId, item.name, item.unitPrice, item.quantity, stock[item.productId] ?? 0, cutoff),
      );
    }
    try {
      const results = await this.db.batch(statements);
      return { canceledPrevious: Boolean(cancelPreviousId && results[0].meta.changes > 0) };
    } catch (e) {
      if (/NOT NULL constraint failed: order_items\.quantity/i.test(String((e as Error)?.message ?? e))) {
        throw new InsufficientStockError(items.map((i) => i.productId));
      }
      throw e;
    }
  }

  // ── Odczyt ───────────────────────────────────────────────────

  async getById(id: string): Promise<Order | null> {
    return toOrder(await this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = ?`).bind(id).first());
  }

  async getByNumber(number: string): Promise<Order | null> {
    return toOrder(await this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE number = ?`).bind(number.toUpperCase()).first());
  }

  async getItems(orderId: string): Promise<OrderItem[]> {
    const { results } = await this.db
      .prepare(`SELECT product_id AS productId, name, unit_price AS unitPrice, quantity FROM order_items WHERE order_id = ? ORDER BY name`)
      .bind(orderId)
      .all<OrderItem>();
    return results;
  }

  async listRecent(limit: number, status?: OrderStatusType): Promise<Order[]> {
    const where = status ? 'WHERE status = ?' : '';
    const stmt = this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders ${where} ORDER BY created_at DESC LIMIT ?`);
    const { results } = await (status ? stmt.bind(status, limit) : stmt.bind(limit)).all();
    return results.map((r) => toOrder(r)!);
  }

  /** Zamówienia czekające na płatność dłużej niż `olderThan` - do sprawdzenia w P24. */
  async listAwaitingPayment(olderThan: number, limit = 50): Promise<Order[]> {
    const { results } = await this.db
      .prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE status IN ('${OrderStatus.CREATED}', '${OrderStatus.PAYMENT_PENDING}') AND created_at < ? ORDER BY created_at LIMIT ?`)
      .bind(olderThan, limit)
      .all();
    return results.map((r) => toOrder(r)!);
  }

  /**
   * Opłacone (po `paidAfter`) zamówienia, którym brakuje przesyłki, e-maila albo powiadomienia sklepu -
   * tylko kroki włączone w konfiguracji, żeby wyłączony krok nie był „ponawiany” w nieskończoność.
   */
  async listPaidNeedingFollowUp(
    opts: { maxAttempts: number; paidAfter: number; shipping: boolean; customerEmail: boolean; shopEmail: boolean },
    limit = 50,
  ): Promise<Order[]> {
    const { results } = await this.db
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders WHERE status = '${OrderStatus.PAID}' AND payment_confirmed_at > ?2 AND (
           (?3 AND shipment_id IS NULL AND shipment_attempts < ?1) OR (?4 AND email_sent_at IS NULL AND email_attempts < ?1) OR (?5 AND shop_notified_at IS NULL)
         ) ORDER BY created_at LIMIT ?6`,
      )
      .bind(opts.maxAttempts, opts.paidAfter, opts.shipping ? 1 : 0, opts.customerEmail ? 1 : 0, opts.shopEmail ? 1 : 0, limit)
      .all();
    return results.map((r) => toOrder(r)!);
  }

  // ── Zmiany statusu (warunkowe - idempotentne przy powtórzeniach) ──

  async markPaymentPending(id: string, provider: string, at: number): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE orders SET status = '${OrderStatus.PAYMENT_PENDING}', payment_provider = ?, payment_pending_at = ? WHERE id = ? AND status = '${OrderStatus.CREATED}'`)
      .bind(provider, at, id)
      .run();
    return r.meta.changes > 0;
  }

  /** Zwalnia sztuki: tylko z CREATED/PAYMENT_PENDING (opłaconego nigdy). */
  async markReleased(id: string, status: typeof OrderStatus.FAILED | typeof OrderStatus.EXPIRED | typeof OrderStatus.CANCELED): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE orders SET status = ? WHERE id = ? AND status IN ('${OrderStatus.CREATED}', '${OrderStatus.PAYMENT_PENDING}')`)
      .bind(status, id)
      .run();
    return r.meta.changes > 0;
  }

  /** true tylko przy pierwszym opłaceniu - powtórne powiadomienia nie uruchamiają drugi raz przesyłki i maili. */
  async markPaid(id: string, paymentReference: string, at: number): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE orders SET status = '${OrderStatus.PAID}', payment_reference = ?, payment_confirmed_at = ? WHERE id = ? AND status != '${OrderStatus.PAID}'`)
      .bind(paymentReference, at, id)
      .run();
    return r.meta.changes > 0;
  }

  async recordShipmentAttempt(id: string, result: { shipmentId?: string; status?: string; error?: string }): Promise<void> {
    await this.db
      .prepare(`UPDATE orders SET shipment_attempts = shipment_attempts + 1, shipment_id = COALESCE(?, shipment_id), shipment_status = COALESCE(?, shipment_status), shipment_error = ? WHERE id = ?`)
      .bind(result.shipmentId ?? null, result.status ?? null, result.error ?? null, id)
      .run();
  }

  async recordEmailAttempt(id: string, sentAt: number | null): Promise<void> {
    await this.db.prepare(`UPDATE orders SET email_attempts = email_attempts + 1, email_sent_at = COALESCE(?, email_sent_at) WHERE id = ?`).bind(sentAt, id).run();
  }

  /** Nowa pula prób dla kroków, które się nie udały (ręczne ponowienie z panelu admina). */
  async resetAttempts(id: string): Promise<void> {
    await this.db
      .prepare(
        `UPDATE orders SET shipment_attempts = CASE WHEN shipment_id IS NULL THEN 0 ELSE shipment_attempts END,
           email_attempts = CASE WHEN email_sent_at IS NULL THEN 0 ELSE email_attempts END WHERE id = ?`,
      )
      .bind(id)
      .run();
  }

  async markShopNotified(id: string, at: number): Promise<void> {
    await this.db.prepare(`UPDATE orders SET shop_notified_at = ? WHERE id = ?`).bind(at, id).run();
  }

  // ── Dziennik i webhooki ──────────────────────────────────────

  async appendEvent(orderId: string, e: Omit<OrderEventRecord, 'id'>): Promise<void> {
    await this.db
      .prepare(`INSERT INTO order_events (order_id, created_at, level, type, correlation_id, data) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(orderId, e.createdAt, e.level, e.type, e.correlationId, e.data === undefined ? null : JSON.stringify(e.data))
      .run();
  }

  async listEvents(orderId: string): Promise<OrderEventRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT id, created_at AS createdAt, level, type, correlation_id AS correlationId, data FROM order_events WHERE order_id = ? ORDER BY id`)
      .bind(orderId)
      .all<OrderEventRecord & { data: string | null }>();
    return results.map((r) => ({ ...r, data: r.data ? JSON.parse(r.data) : null }));
  }

  async recordWebhook(w: WebhookEventInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO webhook_events (received_at, provider, order_id, payment_reference, signature_valid, outcome, correlation_id, raw_payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(w.receivedAt, w.provider, w.orderId, w.paymentReference, w.signatureValid ? 1 : 0, w.outcome, w.correlationId, w.rawPayload)
      .run();
  }

  async listWebhooks(orderId: string) {
    const { results } = await this.db
      .prepare(
        `SELECT id, received_at AS receivedAt, provider, payment_reference AS paymentReference, signature_valid AS signatureValid, outcome, correlation_id AS correlationId, raw_payload AS rawPayload
         FROM webhook_events WHERE order_id = ? ORDER BY id`,
      )
      .bind(orderId)
      .all();
    return results;
  }
}
