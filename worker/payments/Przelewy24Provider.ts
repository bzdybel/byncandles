/**
 * Przelewy24 REST API v1. Dokumentacja: https://developers.przelewy24.pl/
 * Podpisy: SHA-384 z JSON-a o ściśle określonej kolejności pól + klucz CRC.
 */
import { PAYMENT_TIME_LIMIT_MIN } from '../domain/order.ts';
import { ProviderError } from '../errors/AppError.ts';
import { safeEqual } from '../utils/http.ts';
import { callProvider, defaultFetch } from '../utils/providerHttp.ts';
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

/** Pola powiadomienia P24 w kolejności wymaganej do podpisu. */
const NOTIFICATION_FIELDS = ['merchantId', 'posId', 'sessionId', 'amount', 'originAmount', 'currency', 'orderId', 'methodId', 'statement'] as const;

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

  private call<T>(method: string, path: string, body?: unknown) {
    return callProvider<T>(
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
    const { status, json } = await this.call<{ data?: { token?: string } }>('POST', '/api/v1/transaction/register', body);
    const token = json.data?.token;
    if (status !== 200 || !token) throw new ProviderError(this.name, `register HTTP ${status}`, { response: json });
    return { redirectUrl: `${this.host}/trnRequest/${token}` };
  }

  async parseNotification(rawBody: string): Promise<ParsedNotification> {
    let n: Record<string, unknown>;
    try {
      n = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }
    if (!n || typeof n !== 'object') return { valid: false, reason: 'invalid_json' };
    const sessionId = typeof n.sessionId === 'string' ? n.sessionId : undefined;
    const reference = n.orderId !== undefined ? String(n.orderId) : undefined;
    const rejected = (reason: string): ParsedNotification => ({ valid: false, reason, sessionId, reference });

    if (typeof n.sign !== 'string') return rejected('missing_signature');
    const signed = Object.fromEntries(NOTIFICATION_FIELDS.map((k) => [k, n[k] as string | number]));
    if (!safeEqual(await p24Sign({ ...signed, crc: this.cfg.crc }), n.sign)) return rejected('bad_signature');
    if (n.merchantId !== this.cfg.merchantId) return rejected('merchant_mismatch');
    if (!sessionId || !reference || !Number.isInteger(n.amount)) return rejected('incomplete');

    return { valid: true, notification: { sessionId, reference, amount: n.amount as number, currency: String(n.currency) } };
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
    const { status, json } = await this.call<{ data?: { status?: string } }>('PUT', '/api/v1/transaction/verify', body);
    if (status !== 200 || json.data?.status !== 'success') throw new ProviderError(this.name, `verify HTTP ${status}`, { response: json });
  }

  async status(sessionId: string): Promise<ProviderPaymentState> {
    const { status, json } = await this.call<{ data?: { status?: number; orderId?: number; amount?: number } }>(
      'GET',
      `/api/v1/transaction/by/sessionId/${encodeURIComponent(sessionId)}`,
    );
    // 404/400: klient nie wszedł do płatności - transakcji w P24 brak.
    if (status === 404 || status === 400) return { state: 'unpaid', providerStatus: { httpStatus: status } };
    const d = json.data;
    if (status !== 200 || !d) throw new ProviderError(this.name, `status HTTP ${status}`, { response: json });
    // 0 brak wpłaty, 1 wpłata wstępna (do weryfikacji), 2 wpłata potwierdzona, 3 zwrot
    if (d.status === 1) return { state: 'paid_unverified', reference: String(d.orderId), amount: Number(d.amount), providerStatus: d.status };
    if (d.status === 2) return { state: 'paid', reference: String(d.orderId), amount: Number(d.amount), providerStatus: d.status };
    return { state: 'unpaid', providerStatus: d.status };
  }
}
