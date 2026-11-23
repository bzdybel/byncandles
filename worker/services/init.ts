/**
 * Składanie zależności z konfiguracji (env) - jedyne miejsce, które wybiera adapter: prawdziwy czy noop.
 * Wywoływane raz na żądanie / przebieg crona z loggerem przypiętym do jego correlationId.
 */
import { flag, type Env } from '../config/env.ts';
import { EmailNoop } from '../email/EmailNoop.ts';
import type { EmailProvider } from '../email/EmailProvider.ts';
import { ResendProvider } from '../email/ResendProvider.ts';
import { PaymentNoop } from '../payments/PaymentNoop.ts';
import type { PaymentProvider } from '../payments/PaymentProvider.ts';
import { Przelewy24Provider } from '../payments/Przelewy24Provider.ts';
import { ShipXProvider } from '../shipping/ShipXProvider.ts';
import { ShippingNoop } from '../shipping/ShippingNoop.ts';
import type { ShippingProvider } from '../shipping/ShippingProvider.ts';
import { OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import { CryptoIdProvider, SystemClock, type ClockPort, type IdProviderPort } from '../utils/ports.ts';
import { CatalogService } from './CatalogService.ts';
import { OrderJournal } from './OrderJournal.ts';
import { PaymentStatusService } from './PaymentStatusService.ts';
import { StockService } from './StockService.ts';

/** Adres strony do linków w e-mailach i w P24 - w cronie nie ma żądania, z którego dałoby się go wziąć. */
export const DEFAULT_SITE_URL = 'https://byncandles.devbz.workers.dev';

export interface Services {
  logger: LoggerPort;
  clock: ClockPort;
  ids: IdProviderPort;
  storage: OrderStorage;
  journal: OrderJournal;
  catalog: CatalogService;
  stock: StockService;
  payments: PaymentProvider;
  shipping: ShippingProvider | null;
  email: EmailProvider | null;
  paymentStatus: PaymentStatusService;
  siteUrl: string;
  shopEmail?: string;
}

export function createServices(env: Env, logger: LoggerPort, origin?: string): Services {
  const clock = SystemClock;
  const siteUrl = (origin ?? env.SITE_URL ?? DEFAULT_SITE_URL).replace(/\/$/, '');
  const sandbox = env.SANDBOX === '1';
  const storage = new OrderStorage(env.DB);
  const journal = new OrderJournal({ storage, logger, clock });

  const payments: PaymentProvider = flag(env.MOCK_PAYMENTS)
    ? new PaymentNoop(siteUrl)
    : new Przelewy24Provider({
        merchantId: Number(env.P24_MERCHANT_ID),
        posId: Number(env.P24_POS_ID || env.P24_MERCHANT_ID),
        apiKey: env.P24_API_KEY ?? '',
        crc: env.P24_CRC ?? '',
        sandbox,
      });

  const shipping: ShippingProvider | null = flag(env.MOCK_INPOST)
    ? new ShippingNoop()
    : env.SHIPX_TOKEN && env.SHIPX_ORG_ID
      ? new ShipXProvider({
          token: env.SHIPX_TOKEN,
          organizationId: env.SHIPX_ORG_ID,
          sandbox,
          parcelTemplate: env.SHIPX_PARCEL || 'small',
          sendingMethod: env.SHIPX_SENDING_METHOD || 'parcel_locker',
        })
      : null;

  const email: EmailProvider | null = flag(env.MOCK_EMAIL)
    ? new EmailNoop(logger)
    : env.RESEND_API_KEY && env.MAIL_FROM
      ? new ResendProvider({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM })
      : null;

  return {
    logger,
    clock,
    ids: CryptoIdProvider,
    storage,
    journal,
    catalog: new CatalogService(env.ASSETS, siteUrl),
    stock: new StockService({ storage, clock }),
    payments,
    shipping,
    email,
    paymentStatus: new PaymentStatusService({ storage, journal, clock, payments, shipping, email, shopEmail: env.SHOP_EMAIL, siteUrl }),
    siteUrl,
    shopEmail: env.SHOP_EMAIL,
  };
}
