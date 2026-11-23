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

export class ValidationError extends AppError {
  constructor(fields: string[]) {
    super(`Invalid fields: ${fields.join(', ')}`, { statusCode: 400, code: 'invalid', details: { fields } });
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
