/**
 * Podgląd zamówień dla sklepu / dewelopera (Basic auth i limit żądań - w routerze, worker/index.ts):
 *
 *   GET  /api/admin/orders?status=PAID&limit=20   lista ostatnich zamówień z problemami
 *   GET  /api/admin/orders/BN-7K3Q9X              zamówienie + pozycje + dziennik + surowe powiadomienia P24
 *   POST /api/admin/orders/BN-7K3Q9X/retry        ponów brakujące kroki (przesyłka, e-maile) po naprawie przyczyny
 *   POST /api/admin/orders/BN-7K3Q9X/check-payment  zapytaj P24 o stan płatności („klient pisze, że zapłacił”)
 *
 * `correlationIds` w odpowiedzi = filtry do Cloudflare → Workers → Logs (pełne logi ze stosem błędów).
 */
import * as z from 'zod/mini';
import { LogKey } from '../constants/logKeys.ts';
import { isAwaitingPayment, orderProblems, OrderStatus, type Order } from '../domain/order.ts';
import { AppError, NotFoundError } from '../errors/AppError.ts';
import { json } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler, HandlerContext } from './types.ts';

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

/** ?status=paid&limit=20 - status bez względu na wielkość liter; zły limit → domyślny, zły status → 400. */
const limit = z.pipe(z.pipe(z.string().check(z.regex(/^\d+$/)), z.transform((v: string) => Number(v))), z.int().check(z.gte(1), z.lte(100)));
const listQuery = z.object({
  status: z.optional(z.pipe(z.string().check(z.toUpperCase()), z.enum(Object.values(OrderStatus)))),
  limit: z.catch(limit, 20),
});

async function findOrder({ params, services: s }: HandlerContext): Promise<Order> {
  const key = params.key ?? '';
  const order = isUuid(key) ? await s.storage.getById(key) : await s.storage.getByNumber(key);
  if (!order) throw new NotFoundError('Order');
  return order;
}

export const AdminListOrdersHandler: Handler = async ({ url, services: s }) => {
  const query = z.safeParse(listQuery, Object.fromEntries(url.searchParams));
  if (!query.success) throw new AppError('Unknown status', { statusCode: 400, code: 'invalid' });
  const orders = await s.storage.listRecent(query.data.limit, query.data.status);
  return json(
    orders.map((o) => ({
      number: o.number,
      status: o.status,
      createdAt: iso(o.createdAt),
      total: o.total,
      customer: o.customerName,
      shipmentId: o.shipmentId,
      problems: orderProblems(o),
    })),
  );
};

export const AdminOrderHandler: Handler = async (ctx) => {
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
    problems: orderProblems(order),
    items,
    events: events.map((e) => ({ ...e, createdAt: iso(e.createdAt) })),
    webhooks: webhooks.map((w) => ({ ...w, receivedAt: iso(w.receivedAt) })),
    correlationIds: [...new Set([order.correlationId, ...events.map((e) => e.correlationId)].filter(Boolean))],
  });
};

/** Ręczne ponowienie: nowa pula prób dla kroków, które się nie udały (np. po poprawieniu tokenu ShipX). */
export const AdminRetryOrderHandler: Handler = async (ctx) => {
  const s = ctx.services;
  const order = await findOrder(ctx);
  if (order.status !== OrderStatus.PAID) throw new AppError(`Order is ${order.status}, not PAID`, { statusCode: 409, code: 'not_paid' });
  await s.storage.resetAttempts(order.id);
  s.logger.info({ message: 'Admin retry', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number } });
  const fresh = await s.storage.getById(order.id);
  const results = fresh ? await s.fulfillment.fulfill(fresh) : null;
  if (!results) throw new AppError('Order is being processed right now, try again in a minute', { statusCode: 409, code: 'busy' });
  return AdminOrderHandler(ctx);
};

/** „Klient pisze, że zapłacił”: zapytaj dostawcę płatności teraz, zamiast czekać na powiadomienie lub cron. */
export const AdminCheckPaymentHandler: Handler = async (ctx) => {
  const s = ctx.services;
  const order = await findOrder(ctx);
  if (!isAwaitingPayment(order)) throw new AppError(`Order is ${order.status}, not awaiting payment`, { statusCode: 409, code: 'not_awaiting' });
  const { result, providerStatus } = await s.payment.checkWithProvider(order, 'admin');
  s.logger.info({ message: 'Admin payment check', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number, result, [LogKey.PROVIDER_STATUS]: providerStatus } });
  return AdminOrderHandler(ctx);
};
