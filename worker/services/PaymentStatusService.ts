/**
 * Opłacenie zamówienia i to, co po nim następuje: przesyłka ShipX, potwierdzenie dla klienta, powiadomienie sklepu.
 *
 * Każdy krok jest osobny i idempotentny (stan w kolumnach orders: shipment_id, email_sent_at, shop_notified_at),
 * a jego wynik trafia do dziennika. Błąd jednego kroku nie blokuje pozostałych; zadanie cykliczne
 * (jobs/ReconcileOrdersJob.ts) ponawia brakujące kroki do MAX_ATTEMPTS razy.
 */
import { LogKey } from '../constants/logKeys.ts';
import { HOLDING_STATUSES, MAX_ATTEMPTS, OrderEvent } from '../constants/orderStatus.ts';
import type { EmailProvider } from '../email/EmailProvider.ts';
import { customerConfirmation, shopNotification, type ShipmentOutcome } from '../email/templates.ts';
import { AppError } from '../errors/AppError.ts';
import type { PaymentNotification, PaymentProvider } from '../payments/PaymentProvider.ts';
import type { ShippingProvider } from '../shipping/ShippingProvider.ts';
import type { Order, OrderStorage } from '../storage/OrderStorage.ts';
import type { ClockPort } from '../utils/ports.ts';
import type { OrderJournal } from './OrderJournal.ts';
import { RESERVATION_MS } from './StockService.ts';

export interface PaymentStatusDeps {
  storage: OrderStorage;
  journal: OrderJournal;
  clock: ClockPort;
  payments: PaymentProvider;
  /** null = automatyczne przesyłki wyłączone (brak konfiguracji ShipX). */
  shipping: ShippingProvider | null;
  email: EmailProvider | null;
  shopEmail?: string;
  siteUrl: string;
}

export class PaymentAmountMismatchError extends AppError {
  constructor() {
    super('Payment amount does not match order total', { statusCode: 400, code: 'amount_mismatch' });
  }
}

export class PaymentStatusService {
  private readonly d: PaymentStatusDeps;
  constructor(deps: PaymentStatusDeps) {
    this.d = deps;
  }

  /**
   * Potwierdza wpłatę u dostawcy i oznacza zamówienie jako opłacone.
   * @param needsVerify false, gdy dostawca już ją potwierdził (stan „paid” z odpytania przez cron)
   * @returns true przy pierwszym opłaceniu, false przy powtórzeniu
   * @throws gdy weryfikacja się nie uda - powiadomienie zostanie ponowione przez P24 albo cron
   */
  async confirmPaid(order: Order, n: PaymentNotification, needsVerify = true): Promise<boolean> {
    const { journal, payments, storage, clock } = this.d;
    const meta = { [LogKey.PAYMENT_REFERENCE]: n.reference, [LogKey.AMOUNT]: n.amount, [LogKey.PROVIDER]: payments.name };

    if (n.amount !== order.total || n.currency !== 'PLN') {
      await journal.error(order, OrderEvent.PAYMENT_AMOUNT_MISMATCH, { ...meta, expected: order.total, currency: n.currency });
      throw new PaymentAmountMismatchError();
    }
    if (needsVerify) {
      try {
        await payments.verify(n);
      } catch (e) {
        await journal.error(order, OrderEvent.PAYMENT_VERIFY_FAILED, meta, e);
        throw e;
      }
      await journal.info(order, OrderEvent.PAYMENT_VERIFIED, meta);
    }

    const first = await storage.markPaid(order.id, n.reference, clock.now());
    if (!first) return false;

    const late = this.paidLate(order);
    await journal.info(order, OrderEvent.ORDER_PAID, { ...meta, previousStatus: order.status });
    if (late) await journal.warn(order, OrderEvent.PAID_AFTER_EXPIRY, { previousStatus: order.status, createdAt: order.createdAt });

    const paid = (await storage.getById(order.id))!;
    await this.fulfill(paid, { paidLate: late });
    return true;
  }

  /** Opłacone po zwolnieniu rezerwacji - sztuki mogły w międzyczasie trafić do kogoś innego. */
  private paidLate(before: Order): boolean {
    return !HOLDING_STATUSES.includes(before.status) || before.createdAt <= this.d.clock.now() - RESERVATION_MS;
  }

  /** Brakujące kroki po opłaceniu. Wywoływane po wpłacie i przez cron - pomija to, co już zrobione. */
  async fulfill(order: Order, opts: { paidLate?: boolean } = {}): Promise<void> {
    const items = await this.d.storage.getItems(order.id);
    const shipment = await this.ensureShipment(order);
    await this.ensureCustomerEmail(order, items);
    await this.ensureShopNotified(order, items, shipment, opts.paidLate ?? false);
  }

  private async ensureShipment(order: Order): Promise<ShipmentOutcome | 'retry'> {
    const { shipping, storage, journal } = this.d;
    if (order.shipmentId) return { kind: 'created', id: order.shipmentId };
    if (!shipping) return { kind: 'disabled' };
    if (order.shipmentAttempts >= MAX_ATTEMPTS) return { kind: 'failed', error: order.shipmentError ?? 'unknown' };

    const attempt = order.shipmentAttempts + 1;
    try {
      const s = await shipping.createShipment({
        orderNumber: order.number,
        customerName: order.customerName,
        email: order.email,
        phone: order.phone,
        deliveryPointId: order.deliveryPointId,
      });
      await storage.recordShipmentAttempt(order.id, { shipmentId: s.id, status: s.status });
      await journal.info(order, OrderEvent.SHIPMENT_CREATED, { [LogKey.PROVIDER_SHIPMENT_ID]: s.id, [LogKey.STATUS]: s.status, [LogKey.ATTEMPT]: attempt });
      return { kind: 'created', id: s.id };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await storage.recordShipmentAttempt(order.id, { error });
      await journal.error(order, OrderEvent.SHIPMENT_FAILED, { [LogKey.ATTEMPT]: attempt, [LogKey.PROVIDER]: shipping.name }, e);
      return attempt >= MAX_ATTEMPTS ? { kind: 'failed', error } : 'retry';
    }
  }

  private async ensureCustomerEmail(order: Order, items: Awaited<ReturnType<OrderStorage['getItems']>>): Promise<void> {
    const { email, storage, journal, clock } = this.d;
    if (!email || order.emailSentAt || order.emailAttempts >= MAX_ATTEMPTS) return;
    try {
      const msg = customerConfirmation(order, items, this.d.siteUrl);
      const { messageId } = await email.send({ to: order.email, ...msg, replyTo: this.d.shopEmail });
      await storage.recordEmailAttempt(order.id, clock.now());
      await journal.info(order, OrderEvent.EMAIL_SENT, { [LogKey.TO]: order.email, [LogKey.MESSAGE_ID]: messageId });
    } catch (e) {
      await storage.recordEmailAttempt(order.id, null);
      await journal.error(order, OrderEvent.EMAIL_FAILED, { [LogKey.TO]: order.email, [LogKey.ATTEMPT]: order.emailAttempts + 1 }, e);
    }
  }

  /**
   * Sklep dostaje jedno powiadomienie - gdy wiadomo, co z przesyłką (założona, wyłączona albo nieudana po
   * MAX_ATTEMPTS próbach). Przy chwilowej awarii ShipX czekamy na kolejną próbę crona, żeby nie zakładać paczki dwa razy.
   */
  private async ensureShopNotified(order: Order, items: Awaited<ReturnType<OrderStorage['getItems']>>, shipment: ShipmentOutcome | 'retry', paidLate: boolean) {
    const { email, storage, journal, clock, shopEmail } = this.d;
    if (order.shopNotifiedAt || shipment === 'retry' || !email || !shopEmail) return;
    try {
      const adminUrl = `${this.d.siteUrl}/api/admin/orders/${order.number}`;
      const { messageId } = await email.send({ to: shopEmail, ...shopNotification(order, items, { shipment, paidLate, adminUrl }), replyTo: order.email });
      await storage.markShopNotified(order.id, clock.now());
      await journal.info(order, OrderEvent.SHOP_NOTIFIED, { [LogKey.MESSAGE_ID]: messageId });
    } catch (e) {
      await journal.error(order, OrderEvent.SHOP_NOTIFY_FAILED, {}, e);
    }
  }
}
