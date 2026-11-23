/**
 * Płatności po stronie sklepu: obsługa powiadomienia od dostawcy, potwierdzenie wpłaty, odzyskanie
 * zgubionego powiadomienia (cron). Po pierwszym opłaceniu przekazuje zamówienie do realizacji.
 */
import { LogKey } from '../constants/logKeys.ts';
import { OrderEvent, WebhookOutcome, type WebhookOutcomeType } from '../domain/events.ts';
import { isPaidLate, OrderStatus, reservationCutoff, type Order } from '../domain/order.ts';
import { AppError } from '../errors/AppError.ts';
import type { PaymentNotification, PaymentProvider } from '../payments/PaymentProvider.ts';
import type { OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import { isUuid, type ClockPort } from '../utils/ports.ts';
import type { FulfillmentService } from './FulfillmentService.ts';
import type { OrderJournal } from './OrderJournal.ts';

export interface PaymentDeps {
  storage: OrderStorage;
  journal: OrderJournal;
  logger: LoggerPort;
  clock: ClockPort;
  payments: PaymentProvider;
  fulfillment: FulfillmentService;
}

export class PaymentAmountMismatchError extends AppError {
  constructor() {
    super('Payment amount does not match order total', { statusCode: 400, code: 'amount_mismatch' });
  }
}

/** Wynik obsługi powiadomienia: co zapisać w webhook_events i co odpowiedzieć dostawcy. */
export interface NotificationResult {
  outcome: WebhookOutcomeType;
  /** Błąd do zwrócenia dostawcy (≠ 200 → P24 ponowi powiadomienie). */
  error?: unknown;
}

export class PaymentService {
  private readonly d: PaymentDeps;
  constructor(deps: PaymentDeps) {
    this.d = deps;
  }

  /**
   * Powiadomienie od dostawcy. Każde - także odrzucone i powtórzone - trafia do webhook_events
   * z surową treścią, żeby dało się odtworzyć, co dokładnie przyszło.
   */
  async handleNotification(raw: string): Promise<NotificationResult> {
    const { payments, storage } = this.d;
    const parsed = await payments.parseNotification(raw);
    const sessionId = parsed.valid ? parsed.notification.sessionId : parsed.sessionId;
    const reference = (parsed.valid ? parsed.notification.reference : parsed.reference) ?? null;
    const order = isUuid(sessionId) ? await storage.getById(sessionId) : null;

    const result = await this.process(parsed, order, reference);
    await this.recordWebhook(raw, order, reference, parsed.valid, result.outcome);
    return result;
  }

  private async process(parsed: Awaited<ReturnType<PaymentProvider['parseNotification']>>, order: Order | null, reference: string | null): Promise<NotificationResult> {
    const { journal, logger } = this.d;
    if (!parsed.valid) {
      if (order) await journal.warn(order, OrderEvent.WEBHOOK_REJECTED, { reason: parsed.reason, [LogKey.PAYMENT_REFERENCE]: reference });
      else logger.warn({ message: 'Webhook rejected', metadata: { reason: parsed.reason } });
      return { outcome: WebhookOutcome.REJECTED, error: new AppError(`Webhook rejected: ${parsed.reason}`, { statusCode: 400, code: 'webhook_rejected' }) };
    }
    if (!order) {
      logger.warn({ message: 'Webhook for unknown order', metadata: { [LogKey.PAYMENT_REFERENCE]: reference } });
      return { outcome: WebhookOutcome.REJECTED, error: new AppError('Order not found', { statusCode: 404, code: 'not_found' }) };
    }
    if (order.status === OrderStatus.PAID) {
      await journal.info(order, OrderEvent.WEBHOOK_DUPLICATE, { [LogKey.PAYMENT_REFERENCE]: reference });
      return { outcome: WebhookOutcome.DUPLICATE };
    }

    await journal.info(order, OrderEvent.WEBHOOK_RECEIVED, {
      [LogKey.PAYMENT_REFERENCE]: reference,
      [LogKey.AMOUNT]: parsed.notification.amount,
      [LogKey.STATUS]: order.status,
    });
    try {
      const first = await this.confirmPaid(order, parsed.notification);
      return { outcome: first ? WebhookOutcome.ACCEPTED : WebhookOutcome.DUPLICATE };
    } catch (error) {
      return { outcome: WebhookOutcome.ERROR, error };
    }
  }

  private async recordWebhook(raw: string, order: Order | null, reference: string | null, signatureValid: boolean, outcome: WebhookOutcomeType) {
    const { storage, clock, logger, payments } = this.d;
    try {
      await storage.recordWebhook({
        receivedAt: clock.now(),
        provider: payments.name,
        orderId: order?.id ?? null,
        paymentReference: reference,
        signatureValid,
        outcome,
        correlationId: logger.correlationId,
        rawPayload: raw,
      });
    } catch (error) {
      logger.error({ message: 'Webhook record failed', metadata: { [LogKey.ORDER_ID]: order?.id, raw }, error });
    }
  }

  /**
   * Potwierdza wpłatę u dostawcy i oznacza zamówienie jako opłacone; przy pierwszym opłaceniu - realizacja.
   * @param verify false, gdy dostawca już ją potwierdził (stan „paid” odczytany przez cron)
   * @returns true przy pierwszym opłaceniu, false przy powtórzeniu
   * @throws przy niezgodnej kwocie lub nieudanej weryfikacji - P24 albo cron spróbują ponownie
   */
  async confirmPaid(order: Order, n: PaymentNotification, verify = true): Promise<boolean> {
    const { journal, payments, storage, clock, fulfillment } = this.d;
    const meta = { [LogKey.PAYMENT_REFERENCE]: n.reference, [LogKey.AMOUNT]: n.amount, [LogKey.PROVIDER]: payments.name };

    if (n.amount !== order.total || n.currency !== 'PLN') {
      await journal.error(order, OrderEvent.PAYMENT_AMOUNT_MISMATCH, { ...meta, expected: order.total, currency: n.currency });
      throw new PaymentAmountMismatchError();
    }
    if (verify) await this.verify(order, n, meta);

    const now = clock.now();
    if (!(await storage.markPaid(order.id, n.reference, now))) return false;

    const late = isPaidLate(order, now);
    await journal.info(order, OrderEvent.ORDER_PAID, { ...meta, previousStatus: order.status });
    if (late) await journal.warn(order, OrderEvent.PAID_AFTER_EXPIRY, { previousStatus: order.status, createdAt: order.createdAt });

    const paid = await storage.getById(order.id);
    if (paid) await fulfillment.fulfill(paid, { paidLate: late });
    return true;
  }

  private async verify(order: Order, n: PaymentNotification, meta: Record<string, unknown>): Promise<void> {
    try {
      await this.d.payments.verify(n);
    } catch (e) {
      await this.d.journal.error(order, OrderEvent.PAYMENT_VERIFY_FAILED, meta, e);
      throw e;
    }
    await this.d.journal.info(order, OrderEvent.PAYMENT_VERIFIED, meta);
  }

  /**
   * Cron: zamówienie bez rozstrzygnięcia płatności. Opłacone u dostawcy (zgubione powiadomienie) → opłacamy;
   * nieopłacone po czasie rezerwacji → EXPIRED.
   */
  async reconcile(order: Order): Promise<'paid' | 'expired' | 'unchanged'> {
    const { payments, journal, storage, clock } = this.d;
    const state = await payments.status(order.id);
    if (state.state !== 'unpaid') {
      await journal.warn(order, OrderEvent.PAYMENT_RECOVERED, { [LogKey.PAYMENT_REFERENCE]: state.reference, [LogKey.PROVIDER_STATUS]: state.providerStatus });
      const notification = { sessionId: order.id, reference: state.reference, amount: state.amount, currency: 'PLN' };
      return (await this.confirmPaid(order, notification, state.state === 'paid_unverified')) ? 'paid' : 'unchanged';
    }
    if (order.createdAt > reservationCutoff(clock.now())) return 'unchanged';
    if (!(await storage.markReleased(order.id, OrderStatus.EXPIRED))) return 'unchanged';
    await journal.info(order, OrderEvent.ORDER_EXPIRED, { [LogKey.PROVIDER_STATUS]: state.providerStatus });
    return 'expired';
  }
}
