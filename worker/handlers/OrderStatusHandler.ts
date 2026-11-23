/**
 * GET /api/orders/:id - status dla strony podziękowania (po powrocie z P24).
 * Klucz to UUID z linku powrotu - nie do zgadnięcia; zwracamy tylko numer i status, bez danych osobowych.
 */
import { HOLDING_STATUSES, OrderStatus } from '../constants/orderStatus.ts';
import { NotFoundError } from '../errors/AppError.ts';
import { RESERVATION_MS } from '../services/StockService.ts';
import type { Order } from '../storage/OrderStorage.ts';
import { json } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler } from './types.ts';

export type PublicOrderStatus = 'paid' | 'pending' | 'expired';

export function publicStatus(o: Pick<Order, 'status' | 'createdAt'>, now: number): PublicOrderStatus {
  if (o.status === OrderStatus.PAID) return 'paid';
  if (HOLDING_STATUSES.includes(o.status) && o.createdAt > now - RESERVATION_MS) return 'pending';
  return 'expired';
}

export const OrderStatusHandler: Handler = async ({ params, services: s }) => {
  const order = isUuid(params.id) ? await s.storage.getById(params.id) : null;
  if (!order) throw new NotFoundError('Order');
  return json({ number: order.number, status: publicStatus(order, s.clock.now()) });
};
