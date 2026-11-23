/**
 * Zamówienia - warstwa HTTP (logika w services/PlaceOrderService.ts i services/PaymentService.ts):
 *   POST /api/orders               złożenie zamówienia z formularza /zamowienie/
 *   GET  /api/orders/:id           status dla strony podziękowania
 *   POST /api/payments/webhook     powiadomienie Przelewy24 (urlStatus)
 */
import { checkPrerequisites } from '../config/prerequisites.ts';
import { publicStatus } from '../domain/order.ts';
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

/** Klucz to UUID z linku powrotu - nie do zgadnięcia; zwracamy tylko numer i status, bez danych osobowych. */
export const OrderStatusHandler: Handler = async ({ params, services: s }) => {
  const order = isUuid(params.id) ? await s.storage.getById(params.id) : null;
  if (!order) throw new NotFoundError('Order');
  return json({ number: order.number, status: publicStatus(order, s.clock.now()) });
};

/** Odpowiedź ≠ 200 = P24 ponowi powiadomienie (błędny podpis, nieznane zamówienie, chwilowa awaria). */
export const PaymentWebhookHandler: Handler = async ({ request, services: s }) => {
  const { error } = await s.payment.handleNotification(await readBody(request, 8_192));
  if (error) throw error;
  return new Response('OK');
};
