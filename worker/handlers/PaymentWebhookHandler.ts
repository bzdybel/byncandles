/**
 * POST /api/payments/webhook - powiadomienie o wpłacie od Przelewy24 (urlStatus).
 * Każde powiadomienie - także z błędnym podpisem i powtórzone - zapisujemy w webhook_events z surową treścią,
 * żeby dało się odtworzyć, co dokładnie przyszło. Odpowiedź ≠ 200 = P24 ponowi powiadomienie.
 */
import { LogKey } from '../constants/logKeys.ts';
import { OrderEvent, OrderStatus, WebhookOutcome, type WebhookOutcomeType } from '../constants/orderStatus.ts';
import { AppError, NotFoundError } from '../errors/AppError.ts';
import type { Order } from '../storage/OrderStorage.ts';
import { readBody } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler } from './types.ts';

export const PaymentWebhookHandler: Handler = async ({ request, services: s }) => {
  const raw = await readBody(request, 8_192);
  const parsed = await s.payments.parseNotification(raw);
  const sessionId = parsed.valid ? parsed.notification.sessionId : parsed.sessionId;
  const reference = parsed.valid ? parsed.notification.reference : (parsed.reference ?? null);
  const order: Order | null = isUuid(sessionId) ? await s.storage.getById(sessionId) : null;

  let outcome: WebhookOutcomeType = WebhookOutcome.ERROR;
  try {
    if (!parsed.valid) {
      outcome = WebhookOutcome.REJECTED;
      if (order) await s.journal.warn(order, OrderEvent.WEBHOOK_REJECTED, { reason: parsed.reason, [LogKey.PAYMENT_REFERENCE]: reference });
      else s.logger.warn({ message: 'Webhook rejected', metadata: { reason: parsed.reason, sessionId } });
      throw new AppError(`Webhook rejected: ${parsed.reason}`, { statusCode: 400, code: 'webhook_rejected' });
    }
    if (!order) {
      outcome = WebhookOutcome.REJECTED;
      throw new NotFoundError('Order');
    }
    if (order.status === OrderStatus.PAID) {
      outcome = WebhookOutcome.DUPLICATE;
      await s.journal.info(order, OrderEvent.WEBHOOK_DUPLICATE, { [LogKey.PAYMENT_REFERENCE]: reference });
      return new Response('OK');
    }

    await s.journal.info(order, OrderEvent.WEBHOOK_RECEIVED, {
      [LogKey.PAYMENT_REFERENCE]: reference,
      [LogKey.AMOUNT]: parsed.notification.amount,
      [LogKey.STATUS]: order.status,
    });
    const first = await s.paymentStatus.confirmPaid(order, parsed.notification);
    outcome = first ? WebhookOutcome.ACCEPTED : WebhookOutcome.DUPLICATE;
    return new Response('OK');
  } finally {
    try {
      await s.storage.recordWebhook({
        receivedAt: s.clock.now(),
        provider: s.payments.name,
        orderId: order?.id ?? null,
        paymentReference: reference,
        signatureValid: parsed.valid,
        outcome,
        correlationId: s.logger.correlationId,
        rawPayload: raw,
      });
    } catch (error) {
      s.logger.error({ message: 'Webhook record failed', metadata: { [LogKey.ORDER_ID]: order?.id, raw }, error });
    }
  }
};
