/**
 * Przelewy24 REST API v1. Dokumentacja: https://developers.przelewy24.pl/
 * Podpisy: SHA-384 z JSON-a o ściśle określonej kolejności pól + klucz CRC.
 */
import * as z from 'zod/mini';
import { PAYMENT_TIME_LIMIT_MIN } from '../domain/order.ts';
import { safeEqual } from '../utils/http.ts';
import { callProvider, defaultFetch, expectResponse } from '../utils/providerHttp.ts';
import type { ParsedNotification, PaymentNotification, PaymentProvider, ProviderPaymentState, RegisterPaymentInput } from './PaymentProvider.ts';

export interface P24Config {
  merchantId: number;
  posId: number;
  apiKey: string;
  crc: string;
  sandbox: boolean;
}

async function sha384(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-384', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** JSON.stringify nie escapuje „/” ani polskich znaków - zgodnie z wymaganiem P24 (PHP: UNESCAPED_SLASHES|UNICODE). */
export const p24Sign = (fields: Record<string, string | number>) => sha384(JSON.stringify(fields));

/** Powiadomienie P24 (urlStatus). Kolejność kluczy = kolejność pól w podpisie. */
export const notificationSchema = z.object({
  merchantId: z.int(),
  posId: z.int(),
  sessionId: z.string(),
  amount: z.int().check(z.positive()),
  originAmount: z.int(),
  currency: z.string(),
  orderId: z.int(),
  methodId: z.int(),
  statement: z.string(),
  sign: z.string(),
});
/** Tylko do opisu odrzuconego powiadomienia w dzienniku (bez ufania treści). */
const looseIds = z.object({ sessionId: z.catch(z.optional(z.string()), undefined), orderId: z.catch(z.optional(z.union([z.int(), z.string()])), undefined) });

const registerResponse = z.object({ data: z.object({ token: z.string().check(z.minLength(1)) }) });
const verifyResponse = z.object({ data: z.object({ status: z.literal('success') }) });
/** status: 0 brak wpłaty, 1 wpłata wstępna (do weryfikacji), 2 wpłata potwierdzona, 3 zwrot */
const statusResponse = z.object({ data: z.object({ status: z.int(), orderId: z.int(), amount: z.int() }) });

export class Przelewy24Provider implements PaymentProvider {
  readonly name = 'przelewy24';
  private readonly cfg: P24Config;
  private readonly fetchFn: typeof fetch;

  constructor(cfg: P24Config, fetchFn: typeof fetch = defaultFetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  private get host() {
    return this.cfg.sandbox ? 'https://sandbox.przelewy24.pl' : 'https://secure.przelewy24.pl';
  }

  private call(method: string, path: string, body?: unknown) {
    return callProvider(
      this.name,
      `${this.host}${path}`,
      {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${this.cfg.posId}:${this.cfg.apiKey}`)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      this.fetchFn,
    );
  }

  async register(input: RegisterPaymentInput): Promise<{ redirectUrl: string }> {
    const { merchantId, posId, crc } = this.cfg;
    const body = {
      merchantId,
      posId,
      ...input,
      currency: 'PLN',
      country: 'PL',
      language: 'pl',
      timeLimit: PAYMENT_TIME_LIMIT_MIN,
      waitForResult: true, // P24 czeka na wynik przed powrotem → strona podziękowania częściej od razu widzi „opłacone”
      encoding: 'UTF-8',
      sign: await p24Sign({ sessionId: input.sessionId, merchantId, amount: input.amount, currency: 'PLN', crc }),
    };
    const res = await this.call('POST', '/api/v1/transaction/register', body);
    const { token } = expectResponse(this.name, 'register', res, registerResponse).data;
    return { redirectUrl: `${this.host}/trnRequest/${token}` };
  }

  async parseNotification(rawBody: string): Promise<ParsedNotification> {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }
    const ids = z.safeParse(looseIds, json);
    const sessionId = ids.success ? ids.data.sessionId : undefined;
    const reference = ids.success && ids.data.orderId !== undefined ? String(ids.data.orderId) : undefined;
    const rejected = (reason: string): ParsedNotification => ({ valid: false, reason, sessionId, reference });

    const parsed = z.safeParse(notificationSchema, json);
    if (!parsed.success) return rejected('invalid_payload');
    const { sign, ...fields } = parsed.data;
    if (!safeEqual(await p24Sign({ ...fields, crc: this.cfg.crc }), sign)) return rejected('bad_signature');
    if (fields.merchantId !== this.cfg.merchantId) return rejected('merchant_mismatch');

    return { valid: true, notification: { sessionId: fields.sessionId, reference: String(fields.orderId), amount: fields.amount, currency: fields.currency } };
  }

  async verify(n: PaymentNotification): Promise<void> {
    const { merchantId, posId, crc } = this.cfg;
    const orderId = Number(n.reference);
    const body = {
      merchantId,
      posId,
      sessionId: n.sessionId,
      amount: n.amount,
      currency: n.currency,
      orderId,
      sign: await p24Sign({ sessionId: n.sessionId, orderId, amount: n.amount, currency: n.currency, crc }),
    };
    expectResponse(this.name, 'verify', await this.call('PUT', '/api/v1/transaction/verify', body), verifyResponse);
  }

  async status(sessionId: string): Promise<ProviderPaymentState> {
    const res = await this.call('GET', `/api/v1/transaction/by/sessionId/${encodeURIComponent(sessionId)}`);
    // 404/400: klient nie wszedł do płatności - transakcji w P24 brak.
    if (res.status === 404 || res.status === 400) return { state: 'unpaid', providerStatus: { httpStatus: res.status } };
    const d = expectResponse(this.name, 'status', res, statusResponse).data;
    if (d.status === 1) return { state: 'paid_unverified', reference: String(d.orderId), amount: d.amount, providerStatus: d.status };
    if (d.status === 2) return { state: 'paid', reference: String(d.orderId), amount: d.amount, providerStatus: d.status };
    return { state: 'unpaid', providerStatus: d.status };
  }
}
