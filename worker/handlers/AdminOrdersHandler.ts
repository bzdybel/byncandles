/**
 * Podgląd zamówień dla sklepu / dewelopera (Basic auth, hasło = ADMIN_PASSWORD):
 *
 *   GET  /api/admin/orders?status=PAID&limit=20   lista ostatnich zamówień
 *   GET  /api/admin/orders/BN-7K3Q9X              zamówienie + pozycje + dziennik + surowe powiadomienia P24
 *   POST /api/admin/orders/BN-7K3Q9X/retry        ponów brakujące kroki (przesyłka, e-maile) po naprawie przyczyny
 *
 * `correlationIds` w odpowiedzi = filtry do Cloudflare → Workers → Logs (pełne logi ze stosem błędów).
 */
import { LogKey } from '../constants/logKeys.ts';
import { OrderStatus, type OrderStatusType } from '../constants/orderStatus.ts';
import { AppError, NotFoundError } from '../errors/AppError.ts';
import { json, requireAdmin } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler, HandlerContext } from './types.ts';

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

async function findOrder({ params, services: s }: HandlerContext) {
  const key = params.key ?? '';
  const order = isUuid(key) ? await s.storage.getById(key) : await s.storage.getByNumber(key);
  if (!order) throw new NotFoundError('Order');
  return order;
}

export const AdminListOrdersHandler: Handler = async ({ request, url, env, services: s }) => {
  requireAdmin(request, env.ADMIN_PASSWORD);
  const status = url.searchParams.get('status')?.toUpperCase() as OrderStatusType | undefined;
  if (status && !Object.values(OrderStatus).includes(status)) throw new AppError('Unknown status', { statusCode: 400, code: 'invalid' });
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100);
  const orders = await s.storage.listRecent(limit, status);
  return json(
    orders.map((o) => ({
      number: o.number,
      status: o.status,
      createdAt: iso(o.createdAt),
      total: o.total,
      customer: o.customerName,
      shipmentId: o.shipmentId,
      problems: [
        o.status === OrderStatus.PAID && !o.shipmentId && 'brak przesyłki',
        o.status === OrderStatus.PAID && !o.emailSentAt && 'brak e-maila do klienta',
      ].filter(Boolean),
    })),
  );
};

export const AdminOrderHandler: Handler = async (ctx) => {
  requireAdmin(ctx.request, ctx.env.ADMIN_PASSWORD);
  const s = ctx.services;
  const order = await findOrder(ctx);
  const [items, events, webhooks] = await Promise.all([s.storage.getItems(order.id), s.storage.listEvents(order.id), s.storage.listWebhooks(order.id)]);
  return json({
    order: {
      ...order,
      createdAt: iso(order.createdAt),
      paymentPendingAt: iso(order.paymentPendingAt),
      paymentConfirmedAt: iso(order.paymentConfirmedAt),
      emailSentAt: iso(order.emailSentAt),
      shopNotifiedAt: iso(order.shopNotifiedAt),
    },
    items,
    events: events.map((e) => ({ ...e, createdAt: iso(e.createdAt) })),
    webhooks: webhooks.map((w) => ({ ...w, receivedAt: iso(w.receivedAt as number) })),
    correlationIds: [...new Set([order.correlationId, ...events.map((e) => e.correlationId)].filter(Boolean))],
  });
};

export const AdminRetryOrderHandler: Handler = async (ctx) => {
  requireAdmin(ctx.request, ctx.env.ADMIN_PASSWORD);
  const s = ctx.services;
  const order = await findOrder(ctx);
  if (order.status !== OrderStatus.PAID) throw new AppError(`Order is ${order.status}, not PAID`, { statusCode: 409, code: 'not_paid' });
  // Ręczne ponowienie: nowa pula prób dla kroków, które się nie udały.
  await s.storage.resetAttempts(order.id);
  s.logger.info({ message: 'Admin retry', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number } });
  await s.paymentStatus.fulfill((await s.storage.getById(order.id))!);
  return AdminOrderHandler(ctx);
};
