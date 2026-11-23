/** Pomocnicze funkcje HTTP. */
import { AppError, UnauthorizedError } from '../errors/AppError.ts';

export const CORRELATION_HEADER = 'correlation-id';

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Treść żądania z limitem rozmiaru - zamówienie to kilka pól i kilka pozycji. */
export async function readBody(request: Request, maxBytes = 16_384): Promise<string> {
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError('Request body too large', { statusCode: 413, code: 'too_large' });
  return text;
}

export async function readJson(request: Request, maxBytes?: number): Promise<unknown> {
  try {
    return JSON.parse(await readBody(request, maxBytes));
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('Invalid JSON', { statusCode: 400, code: 'invalid_json' });
  }
}

function safeEqual(a: string, b: string): boolean {
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
