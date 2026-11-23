/**
 * Worker sklepu: API zamówień i płatności. Strona pozostaje statyczna - Worker dostaje tylko ścieżki
 * z `assets.run_worker_first` w wrangler.jsonc (/api/*, /katalog.json); resztę Cloudflare serwuje z CDN.
 *
 * Każde żądanie: correlationId (nagłówek `correlation-id` z żądania albo nowy UUID; zwracany w odpowiedzi
 * i w treści błędów) → log żądania i odpowiedzi → handler → centralna obsługa błędów.
 */
import type { Env } from './config/env.ts';
import { checkPrerequisites } from './config/prerequisites.ts';
import { LogKey } from './constants/logKeys.ts';
import { AppError } from './errors/AppError.ts';
import { AdminListOrdersHandler, AdminOrderHandler, AdminRetryOrderHandler } from './handlers/AdminOrdersHandler.ts';
import { CatalogHandler } from './handlers/CatalogHandler.ts';
import { CreateOrderHandler, WEBHOOK_PATH } from './handlers/CreateOrderHandler.ts';
import { DevPaymentHandler } from './handlers/DevPaymentHandler.ts';
import { OrderStatusHandler } from './handlers/OrderStatusHandler.ts';
import { PaymentWebhookHandler } from './handlers/PaymentWebhookHandler.ts';
import type { Handler } from './handlers/types.ts';
import { reconcileOrders } from './jobs/ReconcileOrdersJob.ts';
import { createServices } from './services/init.ts';
import type { ExecutionContext, ScheduledController } from './storage/d1.ts';
import { CORRELATION_HEADER, json } from './utils/http.ts';
import { createLogger, type LoggerPort } from './utils/logger.ts';
import { CryptoIdProvider, isUuid, Stopwatch, SystemClock } from './utils/ports.ts';

type Route = [method: string, pattern: RegExp, handler: Handler];

const ROUTES: Route[] = [
  ['GET', /^\/katalog\.json$/, CatalogHandler],
  ['POST', /^\/api\/orders\/?$/, CreateOrderHandler],
  ['GET', /^\/api\/orders\/(?<id>[^/]+)\/?$/, OrderStatusHandler],
  ['POST', new RegExp(`^${WEBHOOK_PATH}/?$`), PaymentWebhookHandler],
  ['GET', /^\/api\/dev\/payments\/(?<id>[^/]+)\/complete\/?$/, DevPaymentHandler],
  ['GET', /^\/api\/admin\/orders\/?$/, AdminListOrdersHandler],
  ['GET', /^\/api\/admin\/orders\/(?<key>[^/]+)\/?$/, AdminOrderHandler],
  ['POST', /^\/api\/admin\/orders\/(?<key>[^/]+)\/retry\/?$/, AdminRetryOrderHandler],
];

function errorResponse(error: unknown, logger: LoggerPort): Response {
  const e = error instanceof AppError ? error : new AppError('Internal error', { isOperational: false });
  const level = e.isOperational && e.statusCode < 500 ? 'warn' : 'error';
  logger[level]({ message: `Request failed: ${e.code}`, metadata: { [LogKey.STATUS_CODE]: e.statusCode }, error });
  // Szczegóły walidacji przeglądarka potrzebuje (które pola), resztę zostawiamy w logach.
  const fields = e.code === 'invalid' ? (e.details as { fields?: string[] })?.fields : undefined;
  return json({ error: e.code, correlationId: logger.correlationId, ...(fields && { fields }) }, e.statusCode);
}

let prerequisitesLogged = false;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const route = ROUTES.find(([m, re]) => m === request.method && re.test(url.pathname));
    // Ścieżka spoza API (np. HEAD /katalog.json) - zwykły plik statyczny.
    if (!route && !url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const incoming = request.headers.get(CORRELATION_HEADER);
    const correlationId = isUuid(incoming) ? incoming : CryptoIdProvider.uuid();
    const logger = createLogger(correlationId, 'http');
    const timer = new Stopwatch(SystemClock);
    const meta = { [LogKey.METHOD]: request.method, [LogKey.PATH]: url.pathname };

    if (!prerequisitesLogged) {
      prerequisitesLogged = true;
      const r = checkPrerequisites(env);
      if (r.errors.length || r.warnings.length) logger[r.passed ? 'warn' : 'error']({ message: 'Configuration check', metadata: { [LogKey.ERRORS]: r.errors, [LogKey.WARNINGS]: r.warnings } });
    }

    let response: Response;
    if (!route) {
      response = json({ error: 'not_found', correlationId }, 404);
    } else {
      try {
        const services = createServices(env, logger, url.origin);
        response = await route[2]({ request, url, env, services, params: { ...url.pathname.match(route[1])!.groups } });
      } catch (error) {
        response = errorResponse(error, logger);
      }
    }

    response = new Response(response.body, response);
    response.headers.set(CORRELATION_HEADER, correlationId);
    // /katalog.json odpytuje każdy koszyk co minutę - logujemy tylko wolne lub nieudane, reszta to szum.
    const { durationMs } = timer.stop();
    const quiet = route?.[2] === CatalogHandler && response.status < 400 && durationMs < 1000;
    if (!quiet) logger.info({ message: 'API response', metadata: { ...meta, [LogKey.STATUS_CODE]: response.status, [LogKey.DURATION_MS]: durationMs } });
    return response;
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const logger = createLogger(CryptoIdProvider.uuid(), 'job');
    ctx.waitUntil(
      reconcileOrders(createServices(env, logger)).catch((error) => logger.error({ message: 'Reconcile job failed', metadata: { [LogKey.JOB]: 'reconcile-orders' }, error })),
    );
  },
};
