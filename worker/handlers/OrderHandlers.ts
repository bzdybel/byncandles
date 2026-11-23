/**
 * Zamówienia - warstwa HTTP (logika w services/PlaceOrderService.ts i services/PaymentService.ts):
 *   POST /api/orders               złożenie zamówienia z formularza /zamowienie/
 *   GET  /api/orders/:id           status dla strony podziękowania
 *   POST /api/payments/webhook     powiadomienie Przelewy24 (urlStatus)
 */
import { checkPrerequisites } from '../config/prerequisites.ts';
import { LogKey } from '../constants/logKeys.ts';
import { isAwaitingPayment, publicStatus } from '../domain/order.ts';
import { CaptchaError, ConfigurationError, NotFoundError, UnsupportedMediaTypeError } from '../errors/AppError.ts';
import { clientHash, clientIp, json, readBody, readJson } from '../utils/http.ts';
import { isUuid } from '../utils/ports.ts';
import type { Handler } from './types.ts';

export const CreateOrderHandler: Handler = async ({ request, url, services: s }) => {
  const config = checkPrerequisites(s.config);
  if (!config.passed) throw new ConfigurationError(config.errors);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new UnsupportedMediaTypeError();

  const body = await readJson(request);
  const captcha = await s.captcha.verify((body as { captcha?: unknown } | null)?.captcha, clientIp(request));
  if (captcha) throw new CaptchaError(captcha);

  const placed = await s.placeOrder.place(body, { origin: url.origin, clientHash: await clientHash(request, s.config.clientHashSalt) });
  return json(placed, 201);
};

/**
 * Status dla strony podziękowania. Klucz to UUID z linku powrotu - nie do zgadnięcia; zwracamy tylko numer i status.
 * Zamówienie czekające na płatność sprawdzamy od razu u dostawcy: klient wraca z P24 zwykle szybciej niż powiadomienie,
 * a gdy powiadomienie nie dotrze (awaria, lokalnie localhost), i tak zobaczy „opłacone”. Limit odczytów: READ_LIMITER.
 */
export const OrderStatusHandler: Handler = async ({ params, services: s }) => {
  let order = isUuid(params.id) ? await s.storage.getById(params.id) : null;
  if (!order) throw new NotFoundError('Order');
  if (s.config.payments.kind === 'przelewy24' && isAwaitingPayment(order) && order.paymentPendingAt) {
    try {
      if ((await s.payment.checkWithProvider(order, 'return_page')).result !== 'unpaid') order = (await s.storage.getById(order.id)) ?? order;
    } catch (error) {
      // Niedostępny dostawca nie psuje strony - zostaje status z bazy, a powiadomienie / cron dokończą sprawę.
      s.logger.warn({ message: 'Payment check on return page failed', metadata: { [LogKey.ORDER_ID]: order.id }, error });
    }
  }
  return json({ number: order.number, status: publicStatus(order, s.clock.now()) });
};

/** Odpowiedź ≠ 200 = P24 ponowi powiadomienie (błędny podpis, nieznane zamówienie, chwilowa awaria). */
export const PaymentWebhookHandler: Handler = async ({ request, services: s }) => {
  const { error } = await s.payment.handleNotification(await readBody(request, 8_192));
  if (error) throw error;
  return new Response('OK');
};
