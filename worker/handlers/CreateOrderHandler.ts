/**
 * POST /api/orders - zamówienie z formularza /zamowienie/.
 * 1. walidacja i przeliczenie cen po stronie serwera  2. zapis + atomowa rezerwacja sztuk (D1)
 * 3. rejestracja płatności w P24  4. adres przekierowania dla przeglądarki.
 * Każdy krok trafia do dziennika zamówienia (order_events) pod correlationId tego żądania.
 */
import { checkPrerequisites } from '../config/prerequisites.ts';
import { LogKey } from '../constants/logKeys.ts';
import { OrderEvent, OrderStatus } from '../constants/orderStatus.ts';
import { ConfigurationError, InsufficientStockError } from '../errors/AppError.ts';
import { orderNumber, parseOrderRequest } from '../services/OrderFactory.ts';
import { json, readJson } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler } from './types.ts';

export const RETURN_PATH = '/zamowienie/dziekuje/';
export const WEBHOOK_PATH = '/api/payments/webhook';

export const CreateOrderHandler: Handler = async ({ request, env, services: s }) => {
  const config = checkPrerequisites(env);
  if (!config.passed) throw new ConfigurationError(config.errors);

  const body = await readJson(request);
  const [base, cfg] = await Promise.all([s.catalog.catalog(), s.catalog.config()]);
  const previous = (body as { previous?: unknown } | null)?.previous;
  const parsed = parseOrderRequest(body, await s.stock.available(base, isUuid(previous) ? previous : undefined), cfg);
  const meta = {
    [LogKey.ITEMS]: parsed.items.map((i) => ({ [LogKey.PRODUCT_ID]: i.productId, qty: i.quantity, price: i.unitPrice })),
    [LogKey.AMOUNT]: parsed.fields.total,
  };

  const order = {
    id: s.ids.uuid(),
    number: orderNumber(s.ids.bytes(6)),
    correlationId: s.logger.correlationId,
    createdAt: s.clock.now(),
    ...parsed.fields,
  };
  const stock = Object.fromEntries(parsed.items.map((i) => [i.productId, base[i.productId][2]]));

  let canceledPrevious = false;
  try {
    ({ canceledPrevious } = await s.storage.insertWithReservation(order, parsed.items, stock, s.stock.cutoff(), parsed.previousOrderId));
  } catch (e) {
    if (e instanceof InsufficientStockError) s.logger.warn({ message: `Order ${OrderEvent.ORDER_REJECTED_STOCK}`, metadata: meta });
    throw e;
  }
  await s.journal.info(order, OrderEvent.ORDER_CREATED, {
    ...meta,
    itemsTotal: order.itemsTotal,
    discount: order.discount,
    deliveryCost: order.deliveryCost,
    deliveryPointId: order.deliveryPointId,
    ...(canceledPrevious && { canceledPreviousOrderId: parsed.previousOrderId }),
  });
  if (canceledPrevious) {
    const prev = await s.storage.getById(parsed.previousOrderId!);
    if (prev) await s.journal.info(prev, OrderEvent.ORDER_CANCELED_BY_RETRY, { replacedBy: order.number });
  }

  const origin = new URL(request.url).origin;
  try {
    const { redirectUrl } = await s.payments.register({
      sessionId: order.id,
      amount: order.total,
      description: `Zamówienie ${order.number} - by N. candles`,
      email: order.email,
      client: order.customerName,
      phone: order.phone,
      urlReturn: `${origin}${RETURN_PATH}?id=${order.id}`,
      urlStatus: `${origin}${WEBHOOK_PATH}`,
    });
    await s.storage.markPaymentPending(order.id, s.payments.name, s.clock.now());
    await s.journal.info(order, OrderEvent.PAYMENT_REGISTERED, { [LogKey.PROVIDER]: s.payments.name, [LogKey.AMOUNT]: order.total });
    return json({ orderId: order.id, number: order.number, redirect: redirectUrl }, 201);
  } catch (e) {
    // Bez płatności zamówienie nie ma sensu - zwalniamy sztuki od razu, nie czekając na koniec rezerwacji.
    await s.storage.markReleased(order.id, OrderStatus.FAILED);
    await s.journal.error(order, OrderEvent.PAYMENT_REGISTER_FAILED, { [LogKey.PROVIDER]: s.payments.name }, e);
    throw e;
  }
};
