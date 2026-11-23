/**
 * Przelewy24 REST API v1. Dokumentacja: https://developers.przelewy24.pl/
 * Podpisy: SHA-384 z JSON-a o ściśle określonej kolejności pól + klucz CRC.
 */
import { ProviderError } from '../errors/AppError.ts';
import {
  PAYMENT_TIME_LIMIT_MIN,
  type ParsedNotification,
  type PaymentNotification,
  type PaymentProvider,
  type ProviderPaymentState,
  type RegisterPaymentInput,
} from './PaymentProvider.ts';

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

/** Porównanie w stałym czasie - podpis nie „wycieka” przez czas odpowiedzi. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class Przelewy24Provider implements PaymentProvider {
  readonly name = 'przelewy24';
  private readonly cfg: P24Config;
  private readonly fetchFn: typeof fetch;

  constructor(cfg: P24Config, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  private get host() {
    return this.cfg.sandbox ? 'https://sandbox.przelewy24.pl' : 'https://secure.przelewy24.pl';
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; json: T }> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.host}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${this.cfg.posId}:${this.cfg.apiKey}`)}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new ProviderError(this.name, `${method} ${path} network error`, { cause: String(e) });
    }
    return { status: res.status, json: (await res.json().catch(() => ({}))) as T };
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
    const { status, json } = await this.call<{ data?: { token?: string }; error?: unknown; code?: number }>('POST', '/api/v1/transaction/register', body);
    if (status !== 200 || !json.data?.token) throw new ProviderError(this.name, `register HTTP ${status}`, { response: json });
    return { redirectUrl: `${this.host}/trnRequest/${json.data.token}` };
  }

  async parseNotification(rawBody: string): Promise<ParsedNotification> {
    let n: Record<string, unknown>;
    try {
      n = JSON.parse(rawBody);
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }
    const sessionId = typeof n.sessionId === 'string' ? n.sessionId : undefined;
    const reference = n.orderId !== undefined ? String(n.orderId) : undefined;
    const expected = await p24Sign({
      merchantId: n.merchantId as number,
      posId: n.posId as number,
      sessionId: n.sessionId as string,
      amount: n.amount as number,
      originAmount: n.originAmount as number,
      currency: n.currency as string,
      orderId: n.orderId as number,
      methodId: n.methodId as number,
      statement: n.statement as string,
      crc: this.cfg.crc,
    });
    if (typeof n.sign !== 'string' || !safeEqual(expected, n.sign)) return { valid: false, reason: 'bad_signature', sessionId, reference };
    if (n.merchantId !== this.cfg.merchantId) return { valid: false, reason: 'merchant_mismatch', sessionId, reference };
    return { valid: true, notification: { sessionId: sessionId!, reference: reference!, amount: Number(n.amount), currency: String(n.currency) } };
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
    if (status !== 200 || !json.data) throw new ProviderError(this.name, `status HTTP ${status}`, { response: json });
    const d = json.data;
    // 0 brak wpłaty, 1 wpłata wstępna (do weryfikacji), 2 wpłata potwierdzona, 3 zwrot
    if (d.status === 1) return { state: 'paid_unverified', reference: String(d.orderId), amount: Number(d.amount), providerStatus: d.status };
    if (d.status === 2) return { state: 'paid', reference: String(d.orderId), amount: Number(d.amount), providerStatus: d.status };
    return { state: 'unpaid', providerStatus: d.status };
  }
}
