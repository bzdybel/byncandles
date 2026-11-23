/**
 * GET /api/dev/payments/:id/complete - tylko przy MOCK_PAYMENTS=1 (lokalnie).
 * Udaje bramkę płatności: powiadomienie idzie tą samą ścieżką co z P24 (webhook_events → opłacenie → realizacja).
 */
import { NotFoundError } from '../errors/AppError.ts';
import { RETURN_PATH } from '../services/PlaceOrderService.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler } from './types.ts';

export const DevPaymentHandler: Handler = async ({ url, params, services: s }) => {
  if (s.config.payments.kind !== 'noop') throw new NotFoundError('Route');
  const order = isUuid(params.id) ? await s.storage.getById(params.id) : null;
  if (!order) throw new NotFoundError('Order');
  const notification = { sessionId: order.id, reference: `noop-${order.number}`, amount: order.total, currency: 'PLN' };
  const { error } = await s.payment.handleNotification(JSON.stringify(notification));
  if (error) throw error;
  return Response.redirect(`${url.origin}${RETURN_PATH}?id=${order.id}`, 303);
};
