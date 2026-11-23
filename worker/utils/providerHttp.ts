/**
 * Wspólne wywołanie API dostawcy (P24, ShipX, Resend, punkty InPost): limit czasu, JSON, jednolity błąd sieci.
 * Zawieszony dostawca nie blokuje żądania klienta ani lease'a realizacji zamówienia.
 */
import * as z from 'zod/mini';
import { ProviderError } from '../errors/AppError.ts';

export const PROVIDER_TIMEOUT_MS = 15_000;

export interface ProviderResponse<T = unknown> {
  status: number;
  ok: boolean;
  json: T;
}

export async function callProvider<T = unknown>(
  provider: string,
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): Promise<ProviderResponse<T>> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new ProviderError(provider, timeout ? `timeout after ${timeoutMs} ms` : 'network error', { url, cause: String(e) });
  }
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, ok: res.ok, json };
}

const providerMessage = z.object({ error: z.catch(z.optional(z.string()), undefined), message: z.catch(z.optional(z.string()), undefined) });

/**
 * Odpowiedź dostawcy zgodna ze schematem albo ProviderError z całą odpowiedzią (i listą niezgodności) -
 * zmiana API po stronie dostawcy widać w dzienniku zamówienia, zamiast wybuchać dalej `undefined`.
 */
export function expectResponse<S extends z.ZodMiniType>(provider: string, label: string, res: ProviderResponse, schema: S): z.infer<S> {
  const parsed = z.safeParse(schema, res.json);
  if (res.ok && parsed.success) return parsed.data;
  const issues = res.ok && !parsed.success ? parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) : undefined;
  // Komunikat dostawcy (np. ShipX „validation_failed”) w treści błędu - trafia do e-maila sklepu i dziennika.
  const hint = z.safeParse(providerMessage, res.json);
  const detail = hint.success ? [hint.data.error, hint.data.message].filter(Boolean).join(' ') : '';
  throw new ProviderError(provider, `${label} HTTP ${res.status}${detail ? ` ${detail}` : ''}`, { response: res.json, ...(issues && { issues }) });
}

/** Domyślny fetch opakowany - bez tego `this` przy wywołaniu metody bywa niepoprawne w Workers. */
export const defaultFetch: typeof fetch = (...args) => fetch(...args);
