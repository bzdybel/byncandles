/**
 * Zadanie cykliczne (cron w wrangler.jsonc, co 10 min) - siatka bezpieczeństwa na wypadek zgubionych zdarzeń:
 *
 * 1. Zamówienia czekające na płatność dłużej niż limit P24 → pytamy P24 o stan transakcji:
 *    opłacone (zgubione powiadomienie) → opłacamy; nieopłacone po czasie rezerwacji → EXPIRED.
 * 2. Opłacone zamówienia bez przesyłki / e-maila / powiadomienia sklepu → ponawiamy brakujące kroki.
 *
 * Każdy przebieg ma własny correlationId; błąd jednego zamówienia nie przerywa pozostałych.
 */
import { LogKey } from '../constants/logKeys.ts';
import { MAX_ATTEMPTS, OrderEvent, OrderStatus } from '../constants/orderStatus.ts';
import { PAYMENT_TIME_LIMIT_MIN } from '../payments/PaymentProvider.ts';
import type { Services } from '../services/init.ts';
import { RESERVATION_MS } from '../services/StockService.ts';
import { Stopwatch } from '../utils/ports.ts';

/** Opłacone dawniej niż tyle nie są już ponawiane automatycznie (wtedy: /api/admin/orders/:numer/retry). */
const FOLLOW_UP_WINDOW_MS = 3 * 24 * 60 * 60_000;

export async function reconcileOrders(s: Services): Promise<{ checked: number; paid: number; expired: number; followedUp: number }> {
  const timer = new Stopwatch(s.clock);
  const stats = { checked: 0, paid: 0, expired: 0, followedUp: 0 };
  s.logger.info({ message: 'Reconcile job start', metadata: { [LogKey.JOB]: 'reconcile-orders' } });

  // 1. Płatności bez rozstrzygnięcia
  const awaiting = await s.storage.listAwaitingPayment(s.clock.now() - (PAYMENT_TIME_LIMIT_MIN + 5) * 60_000);
  for (const order of awaiting) {
    stats.checked++;
    try {
      const state = await s.payments.status(order.id);
      if (state.state !== 'unpaid') {
        const notification = { sessionId: order.id, reference: state.reference, amount: state.amount, currency: 'PLN' };
        await s.journal.warn(order, OrderEvent.PAYMENT_RECOVERED, { [LogKey.PAYMENT_REFERENCE]: state.reference, [LogKey.PROVIDER_STATUS]: state.providerStatus });
        if (await s.paymentStatus.confirmPaid(order, notification, state.state === 'paid_unverified')) stats.paid++;
      } else if (order.createdAt <= s.clock.now() - RESERVATION_MS) {
        if (await s.storage.markReleased(order.id, OrderStatus.EXPIRED)) {
          stats.expired++;
          await s.journal.info(order, OrderEvent.ORDER_EXPIRED, { [LogKey.PROVIDER_STATUS]: state.providerStatus });
        }
      }
    } catch (error) {
      s.logger.error({ message: 'Reconcile: payment check failed', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number }, error });
    }
  }

  // 2. Opłacone z brakującymi krokami
  const followUp = await s.storage.listPaidNeedingFollowUp({
    maxAttempts: MAX_ATTEMPTS,
    paidAfter: s.clock.now() - FOLLOW_UP_WINDOW_MS,
    shipping: Boolean(s.shipping),
    customerEmail: Boolean(s.email),
    shopEmail: Boolean(s.email && s.shopEmail),
  });
  for (const order of followUp) {
    try {
      await s.paymentStatus.fulfill(order);
      stats.followedUp++;
    } catch (error) {
      s.logger.error({ message: 'Reconcile: follow-up failed', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number }, error });
    }
  }

  s.logger.info({ message: 'Reconcile job done', metadata: { [LogKey.JOB]: 'reconcile-orders', ...stats, ...timer.stop() } });
  return stats;
}
