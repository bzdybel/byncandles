/** Pomocnicze funkcje HTTP. */
import { AppError, UnauthorizedError } from '../errors/AppError.ts';

export const CORRELATION_HEADER = 'correlation-id';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

/**
 * Treść żądania z limitem rozmiaru, liczonym w bajtach i egzekwowanym PODCZAS czytania -
 * 20 MB śmieci nie trafia do pamięci Workera (najpierw Content-Length, potem strumień).
 */
export async function readBody(request: Request, maxBytes = 16_384): Promise<string> {
  const tooLarge = () => new AppError('Request body too large', { statusCode: 413, code: 'too_large' });
  if (Number(request.headers.get('Content-Length') ?? 0) > maxBytes) throw tooLarge();
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function readJson(request: Request, maxBytes?: number): Promise<unknown> {
  try {
    return JSON.parse(await readBody(request, maxBytes));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Invalid JSON', { statusCode: 400, code: 'invalid_json' });
  }
}

/** Porównanie w stałym czasie - sekret nie „wycieka” przez czas odpowiedzi. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Basic auth: dowolny użytkownik, hasło = ADMIN_PASSWORD. Brak hasła w konfiguracji = zawsze odmowa. */
export function requireAdmin(request: Request, password: string | undefined): void {
  const header = request.headers.get('Authorization') ?? '';
  if (!password || !header.startsWith('Basic ')) throw new UnauthorizedError();
  let decoded = '';
  try {
    decoded = atob(header.slice(6));
  } catch {
    throw new UnauthorizedError();
  }
  if (!safeEqual(decoded.slice(decoded.indexOf(':') + 1), password)) throw new UnauthorizedError();
}

/** Krótki SHA-1 treści jako ETag (przeglądarki walidują katalog przez If-None-Match → 304). */
export async function etag(body: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
  return `"${[...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/**
 * Identyfikator klienta do limitów: skrót SHA-256 z soli i IP (CF-Connecting-IP ustawia Cloudflare - klient go nie podrobi).
 * Samo IP nie trafia do bazy.
 */
export async function clientHash(request: Request, salt: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'unknown';
