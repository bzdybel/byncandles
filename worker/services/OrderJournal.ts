/**
 * Dziennik zamówienia: każde zdarzenie trafia jednocześnie do logów Workers (szukanie po correlationId)
 * i do tabeli order_events w D1 (trwała historia jednego zamówienia - logi Workers wygasają po kilku dniach).
 * Błąd zapisu dziennika nigdy nie przerywa obsługi zamówienia - zostaje w logach.
 */
import { LogKey } from '../constants/logKeys.ts';
import type { OrderEventType } from '../constants/orderStatus.ts';
import { serializeError } from '../errors/AppError.ts';
import type { OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import type { ClockPort } from '../utils/ports.ts';

export interface OrderRef {
  id: string;
  number: string;
}

export class OrderJournal {
  private readonly deps: { storage: OrderStorage; logger: LoggerPort; clock: ClockPort };
  constructor(deps: { storage: OrderStorage; logger: LoggerPort; clock: ClockPort }) {
    this.deps = deps;
  }

  info(order: OrderRef, type: OrderEventType, data?: Record<string, unknown>) {
    return this.record('info', order, type, data);
  }
  warn(order: OrderRef, type: OrderEventType, data?: Record<string, unknown>, error?: unknown) {
    return this.record('warn', order, type, data, error);
  }
  error(order: OrderRef, type: OrderEventType, data?: Record<string, unknown>, error?: unknown) {
    return this.record('error', order, type, data, error);
  }

  private async record(level: 'info' | 'warn' | 'error', order: OrderRef, type: OrderEventType, data?: Record<string, unknown>, error?: unknown) {
    const { storage, logger, clock } = this.deps;
    logger[level]({
      message: `Order ${type}`,
      metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number, [LogKey.EVENT]: type, ...data },
      ...(error !== undefined && { error }),
    });
    // W D1 bez stosu wywołań - wystarczy komunikat; pełny błąd jest w logach pod tym samym correlationId.
    const stored = error === undefined ? data : { ...data, error: (({ stack: _, ...rest }) => rest)(serializeError(error)) };
    try {
      await storage.appendEvent(order.id, { createdAt: clock.now(), level, type, correlationId: logger.correlationId, data: stored });
    } catch (e) {
      logger.error({ message: 'Order journal write failed', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.EVENT]: type }, error: e });
    }
  }
}
