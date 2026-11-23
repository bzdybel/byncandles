/**
 * Wspólne wywołanie API dostawcy (P24, ShipX, Resend, punkty InPost): limit czasu, JSON, jednolity błąd sieci.
 * Zawieszony dostawca nie blokuje żądania klienta ani lease'a realizacji zamówienia.
 */
import { ProviderError } from '../errors/AppError.ts';

export const PROVIDER_TIMEOUT_MS = 15_000;

export interface ProviderResponse<T> {
  status: number;
  ok: boolean;
  json: T;
}

export async function callProvider<T>(
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

/** Domyślny fetch opakowany - bez tego `this` przy wywołaniu metody bywa niepoprawne w Workers. */
export const defaultFetch: typeof fetch = (...args) => fetch(...args);
