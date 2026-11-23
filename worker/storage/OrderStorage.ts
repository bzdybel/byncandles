/**
 * Repozytorium zamówień - cały SQL w jednym miejscu. Kolumny snake_case w D1 ↔ pola camelCase (aliasy w SELECT).
 *
 * Wydajność (D1 nalicza odczytane wiersze): stan liczymy z licznika `product_sales` (opłacone) +
 * aktywnych rezerwacji. Zapytania o rezerwacje idą od indeksu orders(status, created_at) - `CROSS JOIN`
 * wymusza tę kolejność w SQLite - więc czytają tylko zamówienia czekające na płatność, nie całą historię.
 */
import type { OrderEventType, WebhookOutcomeType } from '../domain/events.ts';
import { AWAITING_PAYMENT, OrderStatus, type NewOrder, type Order, type OrderItem, type OrderStatusType, type ReleasedStatus } from '../domain/order.ts';
import { InsufficientStockError } from '../errors/AppError.ts';
import type { D1Database, D1PreparedStatement } from './d1.ts';

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

/** Kroki realizacji opłaconego zamówienia i ich kolumny (znacznik wykonania, licznik prób, opcjonalnie błąd/status). */
export const FULFILLMENT_STEPS = {
  shipment: { done: 'shipment_id', attempts: 'shipment_attempts', error: 'shipment_error', status: 'shipment_status' },
  customerEmail: { done: 'email_sent_at', attempts: 'email_attempts' },
  shopNotification: { done: 'shop_notified_at', attempts: 'shop_notify_attempts' },
} as const;
export type FulfillmentStep = keyof typeof FULFILLMENT_STEPS;
type StepColumns = { done: string; attempts: string; error?: string; status?: string };

const ORDER_COLUMNS = `id, number, status, correlation_id AS correlationId, created_at AS createdAt,
  payment_provider AS paymentProvider, payment_pending_at AS paymentPendingAt, payment_reference AS paymentReference,
  payment_confirmed_at AS paymentConfirmedAt, customer_name AS customerName, email, phone, delivery_point_id AS deliveryPointId,
  gift, notes, items_total AS itemsTotal, discount, delivery_cost AS deliveryCost, total, shipment_id AS shipmentId,
  shipment_status AS shipmentStatus, shipment_attempts AS shipmentAttempts, shipment_error AS shipmentError,
  email_sent_at AS emailSentAt, email_attempts AS emailAttempts, shop_notified_at AS shopNotifiedAt,
  shop_notify_attempts AS shopNotifyAttempts`;

const AWAITING_SQL = AWAITING_PAYMENT.map((s) => `'${s}'`).join(', ');

/** Aktywne rezerwacje: zamówienia czekające na płatność, młodsze niż granica (parametr SQL `cutoff`). */
const ACTIVE_HOLDS = (cutoff: string) => `FROM orders o CROSS JOIN order_items i ON i.order_id = o.id
  WHERE o.status IN (${AWAITING_SQL}) AND o.created_at > ${cutoff}`;

const toOrder = (row: Record<string, unknown> | null): Order | null => (row ? ({ ...row, gift: Boolean(row.gift) } as unknown as Order) : null);
const toOrders = (rows: Record<string, unknown>[]) => rows.map((r) => toOrder(r)!);
const isConstraint = (e: unknown, pattern: RegExp) => pattern.test(String((e as Error)?.message ?? e));

export class DuplicateOrderNumberError extends Error {}

export class OrderStorage {
  private readonly db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }

  // ── Stan magazynowy ──────────────────────────────────────────

  /**
   * Sztuki zajęte per produkt: sprzedane (licznik) + zarezerwowane.
   * @param excludeOrderId rezerwacja, którą ponowna próba zaraz zwolni
   */
  async reservedCounts(cutoff: number, excludeOrderId = ''): Promise<Map<string, number>> {
    type Row = { productId: string; quantity: number };
    const [sold, held] = await Promise.all([
      this.db.prepare(`SELECT product_id AS productId, sold AS quantity FROM product_sales WHERE sold > 0`).all<Row>(),
      this.db
        .prepare(`SELECT i.product_id AS productId, SUM(i.quantity) AS quantity ${ACTIVE_HOLDS('?1')} AND o.id != ?2 GROUP BY i.product_id`)
        .bind(cutoff, excludeOrderId)
        .all<Row>(),
    ]);
    const out = new Map<string, number>();
    for (const r of [...sold.results, ...held.results]) out.set(r.productId, (out.get(r.productId) ?? 0) + r.quantity);
    return out;
  }

  /**
   * Zapis zamówienia + rezerwacja sztuk w jednym batchu (transakcja D1).
   * Brak sztuk → INSERT z NULL w kolumnie NOT NULL → błąd → nic nie zostaje zapisane.
   * D1 ma jednego zapisującego, więc dwie osoby nie kupią tej samej ostatniej sztuki.
   * @param stock stan z panelu (przed odjęciem sprzedaży i rezerwacji) dla każdego produktu w zamówieniu
   * @param cancelPreviousId nieopłacone zamówienie z tej samej przeglądarki - zwalniamy jego sztuki
   * @throws InsufficientStockError | DuplicateOrderNumberError
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
        this.db.prepare(`UPDATE orders SET status = '${OrderStatus.CANCELED}' WHERE id = ? AND status IN (${AWAITING_SQL})`).bind(cancelPreviousId),
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
             SELECT ?1, ?2, ?3, ?4, CASE WHEN ?6
               - COALESCE((SELECT sold FROM product_sales WHERE product_id = ?2), 0)
               - COALESCE((SELECT SUM(i.quantity) ${ACTIVE_HOLDS('?7')} AND o.id != ?1 AND i.product_id = ?2), 0)
               >= ?5 THEN ?5 END`,
          )
          .bind(order.id, item.productId, item.name, item.unitPrice, item.quantity, stock[item.productId] ?? 0, cutoff),
      );
    }
    try {
      const results = await this.db.batch(statements);
      return { canceledPrevious: Boolean(cancelPreviousId && results[0].meta.changes > 0) };
    } catch (e) {
      if (isConstraint(e, /NOT NULL constraint failed: order_items\.quantity/i)) throw new InsufficientStockError(items.map((i) => i.productId));
      if (isConstraint(e, /UNIQUE constraint failed: orders\.number/i)) throw new DuplicateOrderNumberError();
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
    const stmt = status
      ? this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ?`).bind(status, limit)
      : this.db.prepare(`SELECT ${ORDER_COLUMNS} FROM orders ORDER BY created_at DESC LIMIT ?`).bind(limit);
    return toOrders((await stmt.all()).results);
  }

  /** Zamówienia czekające na płatność utworzone przed `olderThan` - do sprawdzenia w P24. */
  async listAwaitingPayment(olderThan: number, limit = 50): Promise<Order[]> {
    const { results } = await this.db
      .prepare(`SELECT ${ORDER_COLUMNS} FROM orders WHERE status IN (${AWAITING_SQL}) AND created_at < ? ORDER BY created_at LIMIT ?`)
      .bind(olderThan, limit)
      .all();
    return toOrders(results);
  }

  /**
   * Opłacone (po `paidAfter`) zamówienia z niewykonanym krokiem realizacji, który ma jeszcze próby -
   * tylko kroki włączone w konfiguracji i bez aktywnego lease'a (ktoś właśnie je realizuje).
   */
  async listPaidNeedingFollowUp(opts: { steps: FulfillmentStep[]; maxAttempts: number; paidAfter: number; now: number }, limit = 50): Promise<Order[]> {
    if (opts.steps.length === 0) return [];
    const pending = opts.steps
      .map((s) => FULFILLMENT_STEPS[s] as StepColumns)
      .map((c) => `(${c.done} IS NULL AND ${c.attempts} < ?1)`)
      .join(' OR ');
    const { results } = await this.db
      .prepare(
        `SELECT ${ORDER_COLUMNS} FROM orders WHERE status = '${OrderStatus.PAID}' AND payment_confirmed_at > ?2
           AND (fulfillment_lease_until IS NULL OR fulfillment_lease_until < ?3) AND (${pending})
         ORDER BY created_at LIMIT ?4`,
      )
      .bind(opts.maxAttempts, opts.paidAfter, opts.now, limit)
      .all();
    return toOrders(results);
  }

  // ── Zmiany statusu (warunkowe - idempotentne przy powtórzeniach i wyścigach) ──

  async markPaymentPending(id: string, provider: string, at: number): Promise<boolean> {
    const r = await this.db
      .prepare(`UPDATE orders SET status = '${OrderStatus.PAYMENT_PENDING}', payment_provider = ?, payment_pending_at = ? WHERE id = ? AND status = '${OrderStatus.CREATED}'`)
      .bind(provider, at, id)
      .run();
    return r.meta.changes > 0;
  }

  /** Zwalnia sztuki - tylko z zamówienia czekającego na płatność (nigdy z opłaconego). */
  async markReleased(id: string, status: ReleasedStatus): Promise<boolean> {
    const r = await this.db.prepare(`UPDATE orders SET status = ? WHERE id = ? AND status IN (${AWAITING_SQL})`).bind(status, id).run();
    return r.meta.changes > 0;
  }

  /**
   * Opłacenie + doliczenie sprzedaży do licznika w jednej transakcji. Flaga `sales_counted` gwarantuje,
   * że powtórzone powiadomienie nie doliczy sztuk drugi raz.
   * @returns true tylko przy pierwszym opłaceniu
   */
  async markPaid(id: string, paymentReference: string, at: number): Promise<boolean> {
    const [paid] = await this.db.batch([
      this.db
        .prepare(`UPDATE orders SET status = '${OrderStatus.PAID}', payment_reference = ?, payment_confirmed_at = ? WHERE id = ? AND status != '${OrderStatus.PAID}'`)
        .bind(paymentReference, at, id),
      this.db
        .prepare(
          `INSERT INTO product_sales (product_id, sold)
           SELECT i.product_id, i.quantity FROM order_items i JOIN orders o ON o.id = i.order_id
           WHERE o.id = ? AND o.status = '${OrderStatus.PAID}' AND o.sales_counted = 0
           ON CONFLICT (product_id) DO UPDATE SET sold = sold + excluded.sold`,
        )
        .bind(id),
      this.db.prepare(`UPDATE orders SET sales_counted = 1 WHERE id = ? AND status = '${OrderStatus.PAID}'`).bind(id),
    ]);
    return paid.meta.changes > 0;
  }

  // ── Realizacja: lease i kroki ────────────────────────────────

  /** Wyłączność na realizację zamówienia do `until` - webhook i cron nie zrobią tego równolegle. */
  async acquireLease(id: string, now: number, until: number): Promise<boolean> {
    const r = await this.db
      .prepare(
        `UPDATE orders SET fulfillment_lease_until = ? WHERE id = ? AND status = '${OrderStatus.PAID}' AND (fulfillment_lease_until IS NULL OR fulfillment_lease_until < ?)`,
      )
      .bind(until, id, now)
      .run();
    return r.meta.changes > 0;
  }

  async releaseLease(id: string): Promise<void> {
    await this.db.prepare(`UPDATE orders SET fulfillment_lease_until = NULL WHERE id = ?`).bind(id).run();
  }

  /** Zapisuje próbę kroku: +1 do licznika, znacznik wykonania przy sukcesie, błąd/status (jeśli krok je ma). */
  async recordStepAttempt(id: string, step: FulfillmentStep, result: { done?: string | number; error?: string; status?: string }): Promise<void> {
    const c: StepColumns = FULFILLMENT_STEPS[step];
    const sets = [`${c.attempts} = ${c.attempts} + 1`, `${c.done} = COALESCE(?, ${c.done})`];
    const values: unknown[] = [result.done ?? null];
    if (c.error) {
      sets.push(`${c.error} = ?`);
      values.push(result.error ?? null);
    }
    if (c.status) {
      sets.push(`${c.status} = COALESCE(?, ${c.status})`);
      values.push(result.status ?? null);
    }
    await this.db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
  }

  /** Nowa pula prób dla niewykonanych kroków (ręczne ponowienie z panelu admina). */
  async resetAttempts(id: string): Promise<void> {
    const sets = Object.values(FULFILLMENT_STEPS).map((c) => `${c.attempts} = CASE WHEN ${c.done} IS NULL THEN 0 ELSE ${c.attempts} END`);
    await this.db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`).bind(id).run();
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
      .all<{ receivedAt: number } & Record<string, unknown>>();
    return results;
  }
}
