/**
 * Worker sklepu: API zamówień i płatności. Strona pozostaje statyczna - Worker dostaje tylko ścieżki
 * z `assets.run_worker_first` w wrangler.jsonc (/api/*, /katalog.json); resztę Cloudflare serwuje z CDN.
 *
 * Każde żądanie: correlationId (nagłówek `correlation-id` z żądania albo nowy UUID; zwracany w odpowiedzi
 * i w treści błędów) → limit żądań / autoryzacja (wg trasy) → handler → centralna obsługa błędów → log.
 */
import type { Env } from './config/env.ts';
import { checkPrerequisites } from './config/prerequisites.ts';
import { LogKey } from './constants/logKeys.ts';
import { AppError, RateLimitedError, ValidationError } from './errors/AppError.ts';
import { AdminListOrdersHandler, AdminOrderHandler, AdminRetryOrderHandler } from './handlers/AdminOrdersHandler.ts';
import { CatalogHandler } from './handlers/CatalogHandler.ts';
import { DevPaymentHandler } from './handlers/DevPaymentHandler.ts';
import { CreateOrderHandler, OrderStatusHandler, PaymentWebhookHandler } from './handlers/OrderHandlers.ts';
import type { Handler } from './handlers/types.ts';
import { reconcileOrders } from './jobs/ReconcileOrdersJob.ts';
import { createServices, type Services } from './services/init.ts';
import { WEBHOOK_PATH } from './services/PlaceOrderService.ts';
import type { ExecutionContext, ScheduledController } from './storage/d1.ts';
import { clientIp, CORRELATION_HEADER, json, requireAdmin } from './utils/http.ts';
import { createLogger, type LoggerPort } from './utils/logger.ts';
import { CryptoIdProvider, isUuid, Stopwatch, SystemClock } from './utils/ports.ts';

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  /** Basic auth hasłem ADMIN_PASSWORD. */
  admin?: boolean;
  /**
   * Limit żądań per IP: `write` (RATE_LIMITER, ostry) - zamówienia i panel admina (rezerwowanie sztuk seryjnymi
   * zamówieniami, zgadywanie hasła); `read` (READ_LIMITER, łagodny) - odczyty odpytywane przez koszyki.
   */
  rateLimit?: { kind: 'write' | 'read'; key: string };
  /** Nie loguj udanych, szybkich odpowiedzi (odpytywane co minutę przez każdy koszyk). */
  quiet?: boolean;
}

const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/katalog\.json$/, handler: CatalogHandler, quiet: true, rateLimit: { kind: 'read', key: 'catalog' } },
  { method: 'POST', pattern: /^\/api\/orders\/?$/, handler: CreateOrderHandler, rateLimit: { kind: 'write', key: 'orders' } },
  { method: 'GET', pattern: /^\/api\/orders\/(?<id>[^/]+)\/?$/, handler: OrderStatusHandler, rateLimit: { kind: 'read', key: 'status' } },
  { method: 'POST', pattern: new RegExp(`^${WEBHOOK_PATH}/?$`), handler: PaymentWebhookHandler },
  { method: 'GET', pattern: /^\/api\/dev\/payments\/(?<id>[^/]+)\/complete\/?$/, handler: DevPaymentHandler },
  { method: 'GET', pattern: /^\/api\/admin\/orders\/?$/, handler: AdminListOrdersHandler, admin: true, rateLimit: { kind: 'write', key: 'admin' } },
  { method: 'GET', pattern: /^\/api\/admin\/orders\/(?<key>[^/]+)\/?$/, handler: AdminOrderHandler, admin: true, rateLimit: { kind: 'write', key: 'admin' } },
  { method: 'POST', pattern: /^\/api\/admin\/orders\/(?<key>[^/]+)\/retry\/?$/, handler: AdminRetryOrderHandler, admin: true, rateLimit: { kind: 'write', key: 'admin' } },
];

const SLOW_MS = 1000;

function errorResponse(error: unknown, logger: LoggerPort): Response {
  const e = error instanceof AppError ? error : new AppError('Internal error', { isOperational: false });
  const level = e.isOperational && e.statusCode < 500 ? 'warn' : 'error';
  logger[level]({ message: `Request failed: ${e.code}`, metadata: { [LogKey.STATUS_CODE]: e.statusCode }, error });
  // Przeglądarka potrzebuje tylko pól do podświetlenia; reszta szczegółów zostaje w logach.
  const fields = e instanceof ValidationError ? { fields: e.fields, reasons: e.reasons } : {};
  return json({ error: e.code, correlationId: logger.correlationId, ...fields }, e.statusCode);
}

async function guard(route: Route, request: Request, env: Env, s: Services): Promise<void> {
  const limiter = route.rateLimit && (route.rateLimit.kind === 'write' ? env.RATE_LIMITER : env.READ_LIMITER);
  if (limiter) {
    const { success } = await limiter.limit({ key: `${route.rateLimit!.key}:${clientIp(request)}` });
    if (!success) throw new RateLimitedError();
  }
  if (route.admin) requireAdmin(request, s.config.adminPassword);
}

let prerequisitesLogged = false;

function logPrerequisitesOnce(s: Services): void {
  if (prerequisitesLogged) return;
  prerequisitesLogged = true;
  const r = checkPrerequisites(s.config);
  if (!r.errors.length && !r.warnings.length) return;
  s.logger[r.passed ? 'warn' : 'error']({ message: 'Configuration check', metadata: { [LogKey.ERRORS]: r.errors, [LogKey.WARNINGS]: r.warnings } });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.find((r) => r.method === request.method && r.pattern.test(url.pathname));
    // Ścieżka spoza API (np. HEAD /katalog.json) - zwykły plik statyczny.
    if (!route && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const incoming = request.headers.get(CORRELATION_HEADER);
    const correlationId = isUuid(incoming) ? incoming : CryptoIdProvider.uuid();
    const logger = createLogger(correlationId, 'http');
    const timer = new Stopwatch(SystemClock);

    let response: Response;
    try {
      if (!route) throw new AppError('Route not found', { statusCode: 404, code: 'not_found' });
      const services = createServices(env, logger, url.origin);
      logPrerequisitesOnce(services);
      await guard(route, request, env, services);
      response = await route.handler({ request, url, env, services, params: { ...url.pathname.match(route.pattern)!.groups } });
    } catch (error) {
      response = errorResponse(error, logger);
    }

    response = new Response(response.body, response);
    response.headers.set(CORRELATION_HEADER, correlationId);
    const { durationMs } = timer.stop();
    if (!(route?.quiet && response.status < 400 && durationMs < SLOW_MS)) {
      logger.info({
        message: 'API response',
        metadata: { [LogKey.METHOD]: request.method, [LogKey.PATH]: url.pathname, [LogKey.STATUS_CODE]: response.status, [LogKey.DURATION_MS]: durationMs },
      });
    }
    return response;
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(CryptoIdProvider.uuid(), 'job');
    ctx.waitUntil(
      reconcileOrders(createServices(env, logger)).catch((error) => logger.error({ message: 'Reconcile job failed', metadata: { [LogKey.JOB]: 'reconcile-orders' }, error })),
    );
  },
};
