/**
 * Błędy aplikacji. `code` trafia do odpowiedzi JSON (przeglądarka dobiera komunikat),
 * `isOperational` = spodziewany (warn w logach), w przeciwnym razie error ze stosem.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly isOperational: boolean;
  readonly details?: unknown;

  constructor(message: string, opts: { statusCode?: number; code?: string; isOperational?: boolean; details?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.statusCode = opts.statusCode ?? 500;
    this.code = opts.code ?? 'internal';
    this.isOperational = opts.isOperational ?? true;
    this.details = opts.details;
  }
}

/** Błędne pola formularza; `reasons` doprecyzowuje komunikat (np. locker: 'not_found' - paczkomat nie istnieje). */
export class ValidationError extends AppError {
  readonly fields: string[];
  readonly reasons: Record<string, string>;
  constructor(fields: string[], reasons: Record<string, string> = {}) {
    super(`Invalid fields: ${fields.join(', ')}`, { statusCode: 400, code: 'invalid', details: { fields, reasons } });
    this.fields = fields;
    this.reasons = reasons;
  }
}

/** Klient ma już MAX_PENDING_PER_CLIENT nieopłaconych rezerwacji. */
export class TooManyPendingOrdersError extends AppError {
  constructor() {
    super('Too many unpaid orders from this client', { statusCode: 429, code: 'pending_limit' });
  }
}

/** Nieudana weryfikacja „nie jestem robotem” (Turnstile). */
export class CaptchaError extends AppError {
  constructor(reason: string) {
    super(`Captcha failed: ${reason}`, { statusCode: 400, code: 'captcha', details: { reason } });
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super('Too many requests', { statusCode: 429, code: 'rate_limited' });
  }
}

/** Wymagamy application/json: wymusza preflight CORS, więc obca strona nie złoży zamówienia w imieniu odwiedzającego. */
export class UnsupportedMediaTypeError extends AppError {
  constructor() {
    super('Expected application/json', { statusCode: 415, code: 'unsupported_media_type' });
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, { statusCode: 404, code: 'not_found' });
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super('Unauthorized', { statusCode: 401, code: 'unauthorized' });
  }
}

export class InsufficientStockError extends AppError {
  constructor(productIds: string[] = []) {
    super(`Insufficient stock${productIds.length ? `: ${productIds.join(', ')}` : ''}`, { statusCode: 409, code: 'stock', details: { productIds } });
  }
}

/** Dostawca zewnętrzny (P24, ShipX, Resend) odpowiedział błędem albo nie odpowiedział. */
export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super(`${provider}: ${message}`, { statusCode: 502, code: 'provider', details: { provider, ...((details as object) ?? {}) } });
  }
}

/** Brak wymaganej konfiguracji (sekretów) - sklep nie przyjmuje zamówień, zamiast przyjmować je źle. */
export class ConfigurationError extends AppError {
  constructor(errors: string[]) {
    super(`Configuration: ${errors.join('; ')}`, { statusCode: 503, code: 'unavailable', isOperational: false, details: { errors } });
  }
}

/** Do logów: Error → zwykły obiekt (JSON.stringify gubi message i stack). */
export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof AppError) return { name: error.name, message: error.message, code: error.code, details: error.details, stack: error.stack };
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
  return { message: String(error) };
}
