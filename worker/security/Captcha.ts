/**
 * „Nie jestem robotem” przed rezerwacją sztuk - jedyna ochrona przed botami zmieniającymi IP
 * (limit per IP i limit nieopłaconych rezerwacji tego nie zatrzymają). Wzorzec z lavirant-vc: port + noop.
 *
 * Cloudflare Turnstile: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 * Awaria API Turnstile przepuszcza zamówienie (z ostrzeżeniem w logach) - nie blokujemy sprzedaży przez cudzą awarię;
 * pozostałe limity nadal działają.
 */
import * as z from 'zod/mini';
import type { LoggerPort } from '../utils/logger.ts';
import { callProvider, defaultFetch } from '../utils/providerHttp.ts';

export interface CaptchaVerifier {
  readonly name: string;
  /** null = poprawny; tekst = powód odrzucenia. */
  verify(token: unknown, ip: string): Promise<string | null>;
}

const siteverifyResponse = z.object({ success: z.boolean(), 'error-codes': z.optional(z.array(z.string())) });
const TOKEN_MAX = 2048; // limit Turnstile

export class TurnstileVerifier implements CaptchaVerifier {
  readonly name = 'turnstile';
  private readonly secret: string;
  private readonly logger: LoggerPort;
  private readonly fetchFn: typeof fetch;

  constructor(secret: string, logger: LoggerPort, fetchFn: typeof fetch = defaultFetch) {
    this.secret = secret;
    this.logger = logger;
    this.fetchFn = fetchFn;
  }

  async verify(token: unknown, ip: string): Promise<string | null> {
    if (typeof token !== 'string' || !token || token.length > TOKEN_MAX) return 'missing-input-response';
    try {
      const res = await callProvider(
        this.name,
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: this.secret, response: token, remoteip: ip }) },
        this.fetchFn,
        5_000,
      );
      const parsed = z.safeParse(siteverifyResponse, res.json);
      if (!parsed.success) throw new Error(`unexpected response HTTP ${res.status}`);
      return parsed.data.success ? null : (parsed.data['error-codes']?.join(',') || 'rejected');
    } catch (error) {
      this.logger.warn({ message: 'Captcha verification unavailable - allowing request', error });
      return null;
    }
  }
}

/** Bez TURNSTILE_SECRET (lokalnie, testy) - każde żądanie przechodzi. */
export const CaptchaNoop: CaptchaVerifier = { name: 'noop', verify: async () => null };
