/**
 * Składanie zależności (composition root) - jedyne miejsce, które wybiera adapter: prawdziwy, noop czy brak.
 * Konfigurację interpretuje config/appConfig.ts; tu tylko ją realizujemy.
 * Wywoływane raz na żądanie / przebieg crona z loggerem przypiętym do jego correlationId.
 */
import { loadConfig, type AppConfig } from '../config/appConfig.ts';
import type { Env } from '../config/env.ts';
import { EmailNoop } from '../email/EmailNoop.ts';
import type { EmailProvider } from '../email/EmailProvider.ts';
import { ResendProvider } from '../email/ResendProvider.ts';
import { PaymentNoop, PaymentUnavailable } from '../payments/PaymentNoop.ts';
import type { PaymentProvider } from '../payments/PaymentProvider.ts';
import { Przelewy24Provider } from '../payments/Przelewy24Provider.ts';
import { InPostPoints, PointsNoop } from '../shipping/PointsDirectory.ts';
import { ShipXProvider } from '../shipping/ShipXProvider.ts';
import { ShippingNoop } from '../shipping/ShippingNoop.ts';
import type { ShippingProvider } from '../shipping/ShippingProvider.ts';
import { CaptchaNoop, TurnstileVerifier, type CaptchaVerifier } from '../security/Captcha.ts';
import { OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import { CryptoIdProvider, SystemClock, type ClockPort } from '../utils/ports.ts';
import { CatalogService } from './CatalogService.ts';
import { FulfillmentService } from './FulfillmentService.ts';
import { OrderJournal } from './OrderJournal.ts';
import { PaymentService } from './PaymentService.ts';
import { PlaceOrderService } from './PlaceOrderService.ts';
import { StockService } from './StockService.ts';

/** Adres strony do linków w e-mailach - w cronie nie ma żądania, z którego dałoby się go wziąć. */
export const DEFAULT_SITE_URL = 'https://byncandles.devbz.workers.dev';

export interface Services {
  config: AppConfig;
  logger: LoggerPort;
  clock: ClockPort;
  storage: OrderStorage;
  stock: StockService;
  catalog: CatalogService;
  placeOrder: PlaceOrderService;
  payment: PaymentService;
  fulfillment: FulfillmentService;
  captcha: CaptchaVerifier;
}

/** Brak konfiguracji → dostawca odrzucający wszystko (nigdy noop - ten przyjmuje powiadomienia bez podpisu). */
function paymentProvider(c: AppConfig, siteUrl: string): PaymentProvider {
  if (c.payments.kind === 'przelewy24') return new Przelewy24Provider(c.payments.config);
  if (c.payments.kind === 'noop') return new PaymentNoop(siteUrl);
  return new PaymentUnavailable();
}

const shippingProvider = (c: AppConfig): ShippingProvider | null =>
  c.shipping.kind === 'shipx' ? new ShipXProvider(c.shipping.config) : c.shipping.kind === 'noop' ? new ShippingNoop() : null;

const emailProvider = (c: AppConfig, logger: LoggerPort): EmailProvider | null =>
  c.email.kind === 'resend' ? new ResendProvider(c.email) : c.email.kind === 'noop' ? new EmailNoop(logger) : null;

export function createServices(env: Env, logger: LoggerPort, origin?: string): Services {
  const config = loadConfig(env);
  const clock = SystemClock;
  const siteUrl = (origin ?? config.siteUrl ?? DEFAULT_SITE_URL).replace(/\/$/, '');
  const storage = new OrderStorage(env.DB);
  const journal = new OrderJournal({ storage, logger, clock });
  const stock = new StockService({ storage, clock });
  const catalog = new CatalogService(env.ASSETS, siteUrl);
  const payments = paymentProvider(config, siteUrl);

  const fulfillment = new FulfillmentService({
    storage, journal, logger, clock, siteUrl,
    shipping: shippingProvider(config),
    email: emailProvider(config, logger),
    shopEmail: config.shopEmail,
  });

  return {
    config,
    logger,
    clock,
    storage,
    stock,
    catalog,
    fulfillment,
    captcha: config.turnstileSecret ? new TurnstileVerifier(config.turnstileSecret, logger) : CaptchaNoop,
    payment: new PaymentService({ storage, journal, logger, clock, payments, fulfillment }),
    placeOrder: new PlaceOrderService({
      storage, journal, logger, clock, catalog, stock, payments,
      ids: CryptoIdProvider,
      points: config.validatePoints ? new InPostPoints() : PointsNoop,
    }),
  };
}
