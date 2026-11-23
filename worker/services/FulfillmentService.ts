/**
 * Realizacja opłaconego zamówienia: przesyłka → e-mail do klienta → powiadomienie sklepu.
 *
 * - Lease: webhook, cron i ręczne ponowienie nie wykonają kroków równolegle (podwójna przesyłka).
 * - Każdy krok ma ten sam cykl (wspólny `runStep`): pomiń wykonany/wyłączony/wyczerpany → wykonaj →
 *   zapisz próbę → dziennik. Błąd kroku nie blokuje pozostałych; cron ponawia do MAX_ATTEMPTS.
 * - Sklep dostaje jedno powiadomienie, gdy wiadomo, co z przesyłką i e-mailem klienta - przy chwilowej awarii
 *   czeka na kolejną próbę, żeby nie zakładał paczki ręcznie, zanim zrobi to automat.
 */
import { LogKey } from '../constants/logKeys.ts';
import { OrderEvent, type OrderEventType } from '../domain/events.ts';
import { MAX_ATTEMPTS, RESERVATION_MS, type Order, type OrderItem } from '../domain/order.ts';
import type { EmailProvider } from '../email/EmailProvider.ts';
import { customerConfirmation, shopNotification, type ShipmentOutcome } from '../email/templates.ts';
import { PROVIDER_TIMEOUT_MS } from '../utils/providerHttp.ts';
import type { ShippingProvider } from '../shipping/ShippingProvider.ts';
import type { FulfillmentStep, OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import type { ClockPort } from '../utils/ports.ts';
import type { OrderJournal } from './OrderJournal.ts';

/** Dłużej niż wszystkie kroki z limitem czasu dostawców; po awarii Workera lease sam wygasa. */
export const LEASE_MS = 4 * PROVIDER_TIMEOUT_MS + 30_000;

export interface FulfillmentDeps {
  storage: OrderStorage;
  journal: OrderJournal;
  logger: LoggerPort;
  clock: ClockPort;
  /** null = krok wyłączony w konfiguracji */
  shipping: ShippingProvider | null;
  email: EmailProvider | null;
  shopEmail?: string;
  siteUrl: string;
}

/** Wynik kroku: wykonany | wyłączony | bez prób | czeka na inny krok | do ponowienia. */
export type StepResult = 'done' | 'disabled' | 'exhausted' | 'waiting' | 'retry';

interface Context {
  order: Order;
  items: OrderItem[];
  paidLate: boolean;
  results: Partial<Record<FulfillmentStep, StepResult>>;
  errors: Partial<Record<FulfillmentStep, string>>;
}

interface StepDefinition {
  step: FulfillmentStep;
  events: { ok: OrderEventType; failed: OrderEventType };
  provider: string;
  enabled: boolean;
  isDone(o: Order): boolean;
  attempts(o: Order): number;
  /** false = poczekaj (np. powiadomienie sklepu na rozstrzygnięcie przesyłki) */
  ready?(ctx: Context): boolean;
  run(ctx: Context): Promise<{ done: string | number; status?: string; data?: Record<string, unknown> }>;
}

/** Krok rozstrzygnięty - wiadomo, co napisać sklepowi. */
const SETTLED: readonly (StepResult | undefined)[] = ['done', 'disabled', 'exhausted'];

export class FulfillmentService {
  private readonly d: FulfillmentDeps;
  private readonly steps: StepDefinition[];

  constructor(deps: FulfillmentDeps) {
    this.d = deps;
    this.steps = [this.shipmentStep(), this.customerEmailStep(), this.shopNotificationStep()];
  }

  /** Kroki włączone w konfiguracji - cron szuka zamówień tylko z nimi. */
  enabledSteps(): FulfillmentStep[] {
    return this.steps.filter((s) => s.enabled).map((s) => s.step);
  }

  /**
   * Wykonuje brakujące kroki. Bez lease'a (ktoś inny właśnie realizuje) - nic nie robi.
   * @param opts.paidLate znane przy opłaceniu; przy ponowieniu z crona wyliczane z czasów
   */
  async fulfill(order: Order, opts: { paidLate?: boolean } = {}): Promise<Partial<Record<FulfillmentStep, StepResult>> | null> {
    const { storage, clock, logger } = this.d;
    const now = clock.now();
    if (!(await storage.acquireLease(order.id, now, now + LEASE_MS))) {
      logger.info({ message: 'Fulfillment skipped: lease held', metadata: { [LogKey.ORDER_ID]: order.id, [LogKey.ORDER_NUMBER]: order.number } });
      return null;
    }
    try {
      const ctx: Context = {
        order: { ...order }, // kopia - kroki uzupełniają ją o wyniki (ID przesyłki, czas e-maila)
        items: await storage.getItems(order.id),
        paidLate: opts.paidLate ?? (order.paymentConfirmedAt ?? 0) - order.createdAt > RESERVATION_MS,
        results: {},
        errors: {},
      };
      for (const step of this.steps) ctx.results[step.step] = await this.runStep(step, ctx);
      return ctx.results;
    } finally {
      await storage.releaseLease(order.id);
    }
  }

  private async runStep(def: StepDefinition, ctx: Context): Promise<StepResult> {
    const { order } = ctx;
    if (def.isDone(order)) return 'done';
    if (!def.enabled) return 'disabled';
    if (def.attempts(order) >= MAX_ATTEMPTS) return 'exhausted';
    if (def.ready && !def.ready(ctx)) return 'waiting';

    const attempt = def.attempts(order) + 1;
    try {
      const r = await def.run(ctx);
      await this.d.storage.recordStepAttempt(order.id, def.step, { done: r.done, status: r.status });
      await this.d.journal.info(order, def.events.ok, { ...r.data, [LogKey.ATTEMPT]: attempt });
      return 'done';
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      ctx.errors[def.step] = error;
      await this.d.storage.recordStepAttempt(order.id, def.step, { error });
      await this.d.journal.error(order, def.events.failed, { [LogKey.ATTEMPT]: attempt, [LogKey.PROVIDER]: def.provider }, e);
      return attempt >= MAX_ATTEMPTS ? 'exhausted' : 'retry';
    }
  }

  // ── Definicje kroków ─────────────────────────────────────────

  private shipmentStep(): StepDefinition {
    const shipping = this.d.shipping;
    return {
      step: 'shipment',
      events: { ok: OrderEvent.SHIPMENT_CREATED, failed: OrderEvent.SHIPMENT_FAILED },
      provider: shipping?.name ?? 'none',
      enabled: Boolean(shipping),
      isDone: (o) => Boolean(o.shipmentId),
      attempts: (o) => o.shipmentAttempts,
      run: async ({ order }) => {
        const s = await shipping!.createShipment({
          orderNumber: order.number,
          customerName: order.customerName,
          email: order.email,
          phone: order.phone,
          deliveryPointId: order.deliveryPointId,
        });
        order.shipmentId = s.id;
        return { done: s.id, status: s.status, data: { [LogKey.PROVIDER_SHIPMENT_ID]: s.id, [LogKey.STATUS]: s.status } };
      },
    };
  }

  private customerEmailStep(): StepDefinition {
    const { email, clock, siteUrl, shopEmail } = this.d;
    return {
      step: 'customerEmail',
      events: { ok: OrderEvent.EMAIL_SENT, failed: OrderEvent.EMAIL_FAILED },
      provider: email?.name ?? 'none',
      enabled: Boolean(email),
      isDone: (o) => Boolean(o.emailSentAt),
      attempts: (o) => o.emailAttempts,
      run: async ({ order, items }) => {
        const { messageId } = await email!.send({ to: order.email, ...customerConfirmation(order, items, siteUrl), replyTo: shopEmail });
        order.emailSentAt = clock.now();
        return { done: order.emailSentAt, data: { [LogKey.MESSAGE_ID]: messageId } };
      },
    };
  }

  private shopNotificationStep(): StepDefinition {
    const { email, clock, siteUrl, shopEmail } = this.d;
    return {
      step: 'shopNotification',
      events: { ok: OrderEvent.SHOP_NOTIFIED, failed: OrderEvent.SHOP_NOTIFY_FAILED },
      provider: email?.name ?? 'none',
      enabled: Boolean(email && shopEmail),
      isDone: (o) => Boolean(o.shopNotifiedAt),
      attempts: (o) => o.shopNotifyAttempts,
      // Czeka, aż przesyłka i e-mail klienta się rozstrzygną - inaczej ostrzeżenia w treści mogłyby być nieaktualne.
      ready: (ctx) => SETTLED.includes(ctx.results.shipment) && SETTLED.includes(ctx.results.customerEmail),
      run: async (ctx) => {
        const { order, items } = ctx;
        const msg = shopNotification(order, items, {
          shipment: shipmentOutcome(ctx),
          paidLate: ctx.paidLate,
          customerEmailSent: Boolean(order.emailSentAt),
          adminUrl: `${siteUrl}/api/admin/orders/${order.number}`,
        });
        const { messageId } = await email!.send({ to: shopEmail!, ...msg, replyTo: order.email });
        return { done: clock.now(), data: { [LogKey.MESSAGE_ID]: messageId } };
      },
    };
  }
}

function shipmentOutcome({ order, results, errors }: Context): ShipmentOutcome {
  if (order.shipmentId) return { kind: 'created', id: order.shipmentId };
  if (results.shipment === 'disabled') return { kind: 'disabled' };
  return { kind: 'failed', error: errors.shipment ?? order.shipmentError ?? 'unknown' };
}
