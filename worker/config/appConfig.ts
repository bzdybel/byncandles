/**
 * Jedna interpretacja zmiennych środowiska (schemat Zod): który dostawca (prawdziwy / noop / brak) i z jakimi
 * ustawieniami. Korzystają z niej: wybór adapterów (services/init.ts) i sprawdzenie konfiguracji (prerequisites.ts).
 *
 * Wartość niepoprawna (np. P24_MERCHANT_ID „abc”, SHIPX_PARCEL „mały”) jest traktowana jak brak i trafia do
 * `issues` - prerequisites pokaże ją w logach, a brak kluczy P24 zatrzyma przyjmowanie zamówień.
 */
import * as z from 'zod/mini';
import type { P24Config } from '../payments/Przelewy24Provider.ts';
import type { ShipXConfig } from '../shipping/ShipXProvider.ts';
import type { Env } from './env.ts';

/** Pusty / same spacje = brak. */
const text = z.pipe(z.optional(z.string()), z.transform((v) => v?.trim() || undefined));
const flag = z.pipe(text, z.transform((v) => v === '1' || v === 'true'));
/** Identyfikator liczbowy (P24 merchant/POS): same cyfry, bez zera na początku. */
const positiveInt = z.pipe(text, z.optional(z.pipe(z.string().check(z.regex(/^[1-9]\d*$/)), z.transform((v: string) => Number(v)))));

export const PARCEL_TEMPLATES = ['small', 'medium', 'large'] as const;
export const SENDING_METHODS = ['parcel_locker', 'dispatch_order', 'pop'] as const;
export const MIN_ADMIN_PASSWORD = 12;

export const envSchema = z.object({
  SITE_URL: z.pipe(text, z.optional(z.url())),
  SANDBOX: flag,
  MOCK_PAYMENTS: flag,
  MOCK_INPOST: flag,
  MOCK_EMAIL: flag,
  P24_MERCHANT_ID: positiveInt,
  P24_POS_ID: positiveInt,
  P24_API_KEY: text,
  P24_CRC: text,
  SHIPX_TOKEN: text,
  SHIPX_ORG_ID: text,
  SHIPX_PARCEL: z.pipe(text, z.optional(z.enum(PARCEL_TEMPLATES))),
  SHIPX_SENDING_METHOD: z.pipe(text, z.optional(z.enum(SENDING_METHODS))),
  RESEND_API_KEY: text,
  MAIL_FROM: text,
  SHOP_EMAIL: z.pipe(text, z.optional(z.email())),
  ADMIN_PASSWORD: text,
  TURNSTILE_SECRET: text,
  CLIENT_HASH_SALT: text,
});
type ParsedEnv = z.infer<typeof envSchema>;

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
  turnstileSecret?: string;
  clientHashSalt: string;
  /** Niepoprawne wartości zmiennych (zignorowane), np. "SHIPX_PARCEL: Invalid option". */
  issues: string[];
}

/** Parsuje env; zmienne z niepoprawną wartością traktuje jak nieustawione i zwraca opis problemu. */
function parseEnv(env: Env): { values: ParsedEnv; issues: string[] } {
  const raw: Record<string, unknown> = { ...env };
  const first = z.safeParse(envSchema, raw);
  if (first.success) return { values: first.data, issues: [] };
  const issues = first.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
  for (const i of first.error.issues) delete raw[String(i.path[0])];
  return { values: z.parse(envSchema, raw), issues };
}

function payments(e: ParsedEnv, sandbox: boolean): PaymentsConfig {
  if (e.MOCK_PAYMENTS) return { kind: 'noop' };
  const required = { P24_MERCHANT_ID: e.P24_MERCHANT_ID, P24_API_KEY: e.P24_API_KEY, P24_CRC: e.P24_CRC };
  const missing = Object.entries(required).filter(([, v]) => v === undefined).map(([k]) => k);
  if (missing.length) return { kind: 'missing', missing };
  const merchantId = e.P24_MERCHANT_ID!;
  return { kind: 'przelewy24', config: { merchantId, posId: e.P24_POS_ID ?? merchantId, apiKey: e.P24_API_KEY!, crc: e.P24_CRC!, sandbox } };
}

function shipping(e: ParsedEnv, sandbox: boolean): ShippingConfig {
  if (e.MOCK_INPOST) return { kind: 'noop' };
  if (!e.SHIPX_TOKEN || !e.SHIPX_ORG_ID) return { kind: 'disabled' };
  return {
    kind: 'shipx',
    config: { token: e.SHIPX_TOKEN, organizationId: e.SHIPX_ORG_ID, sandbox, parcelTemplate: e.SHIPX_PARCEL ?? 'small', sendingMethod: e.SHIPX_SENDING_METHOD ?? 'parcel_locker' },
  };
}

function email(e: ParsedEnv): EmailConfig {
  if (e.MOCK_EMAIL) return { kind: 'noop' };
  return e.RESEND_API_KEY && e.MAIL_FROM ? { kind: 'resend', apiKey: e.RESEND_API_KEY, from: e.MAIL_FROM } : { kind: 'disabled' };
}

/** Stała sól, gdy nie ustawiono CLIENT_HASH_SALT - skrót i tak nie wychodzi poza bazę. */
const DEFAULT_SALT = 'byncandles-client';

/**
 * Adaptery „na niby” tylko w sandboxie: MOCK_PAYMENTS na produkcji oznaczałby zamówienia opłacane jednym
 * żądaniem bez pieniędzy (i prawdziwe przesyłki). Poza SANDBOX=1 flagi MOCK_* są ignorowane z ostrzeżeniem.
 */
function enforceSandbox(e: ParsedEnv, issues: string[]): ParsedEnv {
  if (e.SANDBOX) return e;
  const mocks = (['MOCK_PAYMENTS', 'MOCK_INPOST', 'MOCK_EMAIL'] as const).filter((k) => e[k]);
  for (const k of mocks) issues.push(`${k}: dozwolone tylko z SANDBOX=1 - zignorowane`);
  return { ...e, MOCK_PAYMENTS: false, MOCK_INPOST: false, MOCK_EMAIL: false };
}

export function loadConfig(env: Env): AppConfig {
  const parsed = parseEnv(env);
  const issues = parsed.issues;
  const e = enforceSandbox(parsed.values, issues);
  return {
    sandbox: e.SANDBOX,
    siteUrl: e.SITE_URL,
    payments: payments(e, e.SANDBOX),
    shipping: shipping(e, e.SANDBOX),
    email: email(e),
    validatePoints: !e.MOCK_INPOST,
    shopEmail: e.SHOP_EMAIL,
    adminPassword: e.ADMIN_PASSWORD,
    turnstileSecret: e.TURNSTILE_SECRET,
    clientHashSalt: e.CLIENT_HASH_SALT ?? DEFAULT_SALT,
    issues,
  };
}
