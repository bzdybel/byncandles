/**
 * Jedna interpretacja zmiennych środowiska: który dostawca (prawdziwy / noop / brak) i z jakimi ustawieniami.
 * Z tego korzystają: wybór adapterów (services/init.ts) i sprawdzenie konfiguracji (prerequisites.ts).
 */
import type { P24Config } from '../payments/Przelewy24Provider.ts';
import type { ShipXConfig } from '../shipping/ShipXProvider.ts';
import { flag, type Env } from './env.ts';

export type PaymentsConfig = { kind: 'noop' } | { kind: 'przelewy24'; config: P24Config } | { kind: 'missing'; missing: string[] };
export type ShippingConfig = { kind: 'noop' } | { kind: 'shipx'; config: ShipXConfig } | { kind: 'disabled' };
export type EmailConfig = { kind: 'noop' } | { kind: 'resend'; apiKey: string; from: string } | { kind: 'disabled' };

export interface AppConfig {
  sandbox: boolean;
  siteUrl?: string;
  payments: PaymentsConfig;
  shipping: ShippingConfig;
  email: EmailConfig;
  /** Sprawdzanie kodu paczkomatu w publicznym API InPost (wyłączone przy MOCK_INPOST). */
  validatePoints: boolean;
  shopEmail?: string;
  adminPassword?: string;
}

const value = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

function payments(env: Env, sandbox: boolean): PaymentsConfig {
  if (flag(env.MOCK_PAYMENTS)) return { kind: 'noop' };
  const required = { P24_MERCHANT_ID: value(env.P24_MERCHANT_ID), P24_API_KEY: value(env.P24_API_KEY), P24_CRC: value(env.P24_CRC) };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return { kind: 'missing', missing };
  const merchantId = Number(required.P24_MERCHANT_ID);
  return {
    kind: 'przelewy24',
    config: { merchantId, posId: Number(value(env.P24_POS_ID) ?? merchantId), apiKey: required.P24_API_KEY!, crc: required.P24_CRC!, sandbox },
  };
}

function shipping(env: Env, sandbox: boolean): ShippingConfig {
  if (flag(env.MOCK_INPOST)) return { kind: 'noop' };
  const token = value(env.SHIPX_TOKEN);
  const organizationId = value(env.SHIPX_ORG_ID);
  if (!token || !organizationId) return { kind: 'disabled' };
  return {
    kind: 'shipx',
    config: { token, organizationId, sandbox, parcelTemplate: value(env.SHIPX_PARCEL) ?? 'small', sendingMethod: value(env.SHIPX_SENDING_METHOD) ?? 'parcel_locker' },
  };
}

function email(env: Env): EmailConfig {
  if (flag(env.MOCK_EMAIL)) return { kind: 'noop' };
  const apiKey = value(env.RESEND_API_KEY);
  const from = value(env.MAIL_FROM);
  return apiKey && from ? { kind: 'resend', apiKey, from } : { kind: 'disabled' };
}

export function loadConfig(env: Env): AppConfig {
  const sandbox = env.SANDBOX === '1';
  return {
    sandbox,
    siteUrl: value(env.SITE_URL),
    payments: payments(env, sandbox),
    shipping: shipping(env, sandbox),
    email: email(env),
    validatePoints: !flag(env.MOCK_INPOST),
    shopEmail: value(env.SHOP_EMAIL),
    adminPassword: value(env.ADMIN_PASSWORD),
  };
}
