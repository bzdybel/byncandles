/**
 * GET /api/dev/payments/:id/complete - tylko przy MOCK_PAYMENTS=1 (lokalnie).
 * Udaje bramkę płatności: wysyła powiadomienie przez prawdziwy PaymentWebhookHandler i wraca na stronę podziękowania.
 */
import { flag } from '../config/env.ts';
import { NotFoundError } from '../errors/AppError.ts';
import { isUuid } from '../utils/ports.ts';
import { RETURN_PATH } from './CreateOrderHandler.ts';
import { PaymentWebhookHandler } from './PaymentWebhookHandler.ts';
import type { Handler } from './types.ts';

export const DevPaymentHandler: Handler = async (ctx) => {
  if (!flag(ctx.env.MOCK_PAYMENTS)) throw new NotFoundError('Route');
  const order = isUuid(ctx.params.id) ? await ctx.services.storage.getById(ctx.params.id) : null;
  if (!order) throw new NotFoundError('Order');
  const notification = { sessionId: order.id, reference: `noop-${order.number}`, amount: order.total, currency: 'PLN' };
  const request = new Request(ctx.url, { method: 'POST', body: JSON.stringify(notification) });
  await PaymentWebhookHandler({ ...ctx, request });
  return Response.redirect(`${ctx.url.origin}${RETURN_PATH}?id=${order.id}`, 303);
};
