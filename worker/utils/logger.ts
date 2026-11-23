/**
 * Logi strukturalne (JSON) → Cloudflare Workers Logs (`observability` w wrangler.jsonc).
 * Każdy wpis ma `correlationId` żądania lub zadania - jeden filtr pokazuje całą historię jednego kliknięcia
 * „Zamawiam”, jednego powiadomienia P24 albo jednego przebiegu crona.
 *
 * Zamiast AsyncLocalStorage (wzorzec z Node) logger jest jawnie przypięty do correlationId
 * i przekazywany w zależnościach - w Workerach to prostsze i nie wymaga flag zgodności.
 */
import type { LogKeyType } from '../constants/logKeys.ts';
import { serializeError } from '../errors/AppError.ts';

export type LogMetadata = Partial<Record<LogKeyType, unknown>> & Record<string, unknown>;

export interface LogEntry {
  message: string;
  metadata?: LogMetadata;
  error?: unknown;
}

export interface LoggerPort {
  readonly correlationId: string;
  info(entry: LogEntry): void;
  warn(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

type Level = 'info' | 'warn' | 'error';
type Sink = (level: Level, record: Record<string, unknown>) => void;

/** Obiekt (nie string) - Workers Logs indeksuje pola i pozwala po nich filtrować. */
const consoleSink: Sink = (level, record) => console[level === 'info' ? 'log' : level](record);

export function createLogger(correlationId: string, component: string, sink: Sink = consoleSink): LoggerPort {
  const write = (level: Level) => (e: LogEntry) =>
    sink(level, {
      level,
      timestamp: new Date().toISOString(),
      correlationId,
      component,
      message: e.message,
      ...(e.metadata && { metadata: e.metadata }),
      ...(e.error !== undefined && { error: serializeError(e.error) }),
    });
  return { correlationId, info: write('info'), warn: write('warn'), error: write('error') };
}
