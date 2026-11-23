/**
 * Zadanie cykliczne (cron w wrangler.jsonc, co 10 min) - siatka bezpieczeństwa na wypadek zgubionych zdarzeń:
 *
 * 1. Zamówienia czekające na płatność dłużej niż limit P24 → pytamy P24 o stan transakcji
 *    (opłacone - zgubione powiadomienie → opłacamy; nieopłacone po czasie rezerwacji → EXPIRED).
 * 2. Opłacone zamówienia z niewykonanym krokiem realizacji → ponawiamy (lease chroni przed równoległym webhookiem).
 *
 * Każdy przebieg ma własny correlationId; błąd jednego zamówienia nie przerywa pozostałych.
 */
import { LogKey } from '../constants/logKeys.ts';
import { MAX_ATTEMPTS, PAYMENT_TIME_LIMIT_MIN, type Order } from '../domain/order.ts';
import type { Services } from '../services/init.ts';
import { Stopwatch } from '../utils/ports.ts';

/** Zapas po limicie płatności, zanim zapytamy P24 (powiadomienie mogło być jeszcze w drodze). */
const PAYMENT_GRACE_MS = (PAYMENT_TIME_LIMIT_MIN + 5) * 60_000;
/** Opłacone dawniej nie są już ponawiane automatycznie (wtedy: /api/admin/orders/:numer/retry). */
const FOLLOW_UP_WINDOW_MS = 3 * 24 * 60 * 60_000;

export interface ReconcileStats {
  checked: number;
  paid: number;
  expired: number;
  followedUp: number;
  failed: number;
}

export async function reconcileOrders(s: Services): Promise<ReconcileStats> {
  const timer = new Stopwatch(s.clock);
  const stats: ReconcileStats = { checked: 0, paid: 0, expired: 0, followedUp: 0, failed: 0 };
  const now = s.clock.now();
  s.logger.info({ message: 'Reconcile job start', metadata: { [LogKey.JOB]: 'reconcile-orders' } });

  const safely = async (order: Order, label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      stats.failed++;
      s.logger.error({ message: `Reconcile: ${label} failed`, metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number }, error });
    }
  };

  for (const order of await s.storage.listAwaitingPayment(now - PAYMENT_GRACE_MS)) {
    stats.checked++;
    await safely(order, 'payment check', async () => {
      const result = await s.payment.reconcile(order);
      if (result === 'paid') stats.paid++;
      if (result === 'expired') stats.expired++;
    });
  }

  const followUp = await s.storage.listPaidNeedingFollowUp({
    steps: s.fulfillment.enabledSteps(),
    maxAttempts: MAX_ATTEMPTS,
    paidAfter: now - FOLLOW_UP_WINDOW_MS,
    now,
  });
  for (const order of followUp) {
    await safely(order, 'follow-up', async () => {
      if (await s.fulfillment.fulfill(order)) stats.followedUp++;
    });
  }

  s.logger.info({ message: 'Reconcile job done', metadata: { [LogKey.JOB]: 'reconcile-orders', ...stats, ...timer.stop() } });
  return stats;
}
