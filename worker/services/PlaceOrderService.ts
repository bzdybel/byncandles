/**
 * Złożenie zamówienia (przypadek użycia): walidacja i ceny → sprawdzenie paczkomatu → zapis z atomową
 * rezerwacją → rejestracja płatności. Każdy krok w dzienniku pod correlationId żądania.
 */
import type { Catalog } from '../../src/scripts/cart-store.ts';
import { LogKey } from '../constants/logKeys.ts';
import { OrderEvent } from '../domain/events.ts';
import { orderNumber, OrderStatus, type NewOrder, type OrderItem } from '../domain/order.ts';
import { InsufficientStockError, TooManyPendingOrdersError, ValidationError } from '../errors/AppError.ts';
import type { PaymentProvider } from '../payments/PaymentProvider.ts';
import type { PointsDirectory } from '../shipping/PointsDirectory.ts';
import { DuplicateOrderNumberError, type OrderStorage } from '../storage/OrderStorage.ts';
import type { LoggerPort } from '../utils/logger.ts';
import { isUuid, type ClockPort, type IdProviderPort } from '../utils/ports.ts';
import type { CatalogService } from './CatalogService.ts';
import { parseOrderRequest, type ParsedOrder } from './OrderFactory.ts';
import type { OrderJournal } from './OrderJournal.ts';
import type { StockService } from './StockService.ts';

export const RETURN_PATH = '/zamowienie/dziekuje/';
export const WEBHOOK_PATH = '/api/payments/webhook';
const NUMBER_ATTEMPTS = 3;

export interface PlaceOrderDeps {
  storage: OrderStorage;
  journal: OrderJournal;
  logger: LoggerPort;
  clock: ClockPort;
  ids: IdProviderPort;
  catalog: CatalogService;
  stock: StockService;
  payments: PaymentProvider;
  points: PointsDirectory;
}

export interface PlacedOrder {
  orderId: string;
  number: string;
  redirect: string;
}

export class PlaceOrderService {
  private readonly d: PlaceOrderDeps;
  constructor(deps: PlaceOrderDeps) {
    this.d = deps;
  }

  /**
   * @param ctx.origin adres strony z żądania - powrót z P24 i powiadomienia trafiają do tego samego wdrożenia (także podglądów)
   * @param ctx.clientHash skrót IP klienta - limit nieopłaconych rezerwacji (MAX_PENDING_PER_CLIENT)
   */
  async place(body: unknown, ctx: { origin: string; clientHash: string | null }): Promise<PlacedOrder> {
    const { catalog, stock } = this.d;
    const [base, cfg] = await Promise.all([catalog.catalog(), catalog.config()]);
    const previous = (body as { previous?: unknown } | null)?.previous;
    const parsed = parseOrderRequest(body, await stock.available(base, isUuid(previous) ? previous : undefined), cfg);
    await this.assertDeliveryPoint(parsed.fields.deliveryPointId);

    const order = await this.save(parsed, base, ctx.clientHash);
    return { orderId: order.id, number: order.number, redirect: await this.registerPayment(order, ctx.origin) };
  }

  /** Nieistniejący paczkomat = błąd pola; niedostępne API InPost nie blokuje zamówienia (sprawdzi ShipX). */
  private async assertDeliveryPoint(pointId: string): Promise<void> {
    const exists = await this.d.points.exists(pointId);
    if (exists === false) throw new ValidationError(['locker'], { locker: 'not_found' });
    if (exists === null) this.d.logger.warn({ message: 'Delivery point check unavailable', metadata: { deliveryPointId: pointId } });
  }

  /** Zapis z rezerwacją; przy (bardzo rzadkiej) kolizji numeru losujemy nowy. */
  private async save(parsed: ParsedOrder, base: Catalog, clientHash: string | null): Promise<NewOrder> {
    const { storage, journal, logger, ids, clock, stock } = this.d;
    const stockByProduct = Object.fromEntries(parsed.items.map((i) => [i.productId, base[i.productId][2]]));
    const meta = { [LogKey.ITEMS]: summarize(parsed.items), [LogKey.AMOUNT]: parsed.fields.total };

    for (let attempt = 1; ; attempt++) {
      const order: NewOrder = { id: ids.uuid(), number: orderNumber(ids.bytes(6)), correlationId: logger.correlationId, createdAt: clock.now(), clientHash, ...parsed.fields };
      try {
        const { canceledPrevious } = await storage.insertWithReservation(order, parsed.items, stockByProduct, stock.cutoff(), parsed.previousOrderId);
        await journal.info(order, OrderEvent.ORDER_CREATED, {
          ...meta,
          itemsTotal: order.itemsTotal,
          discount: order.discount,
          deliveryCost: order.deliveryCost,
          deliveryPointId: order.deliveryPointId,
          ...(canceledPrevious && { canceledPreviousOrderId: parsed.previousOrderId }),
        });
        if (canceledPrevious) await this.journalCanceled(parsed.previousOrderId!, order.number);
        return order;
      } catch (e) {
        if (e instanceof DuplicateOrderNumberError && attempt < NUMBER_ATTEMPTS) continue;
        if (e instanceof InsufficientStockError) logger.warn({ message: 'Order rejected: stock', metadata: meta });
        if (e instanceof TooManyPendingOrdersError) logger.warn({ message: 'Order rejected: too many unpaid orders from client', metadata: { ...meta, clientHash } });
        throw e;
      }
    }
  }

  private async journalCanceled(previousId: string, replacedBy: string): Promise<void> {
    const prev = await this.d.storage.getById(previousId);
    if (prev) await this.d.journal.info(prev, OrderEvent.ORDER_CANCELED_BY_RETRY, { replacedBy });
  }

  /** Bez płatności zamówienie nie ma sensu - przy błędzie zwalniamy sztuki od razu, nie czekając na koniec rezerwacji. */
  private async registerPayment(order: NewOrder, origin: string): Promise<string> {
    const { payments, storage, journal, clock } = this.d;
    try {
      const { redirectUrl } = await payments.register({
        sessionId: order.id,
        amount: order.total,
        description: `Zamówienie ${order.number} - by N. candles`,
        email: order.email,
        client: order.customerName,
        phone: order.phone,
        urlReturn: `${origin}${RETURN_PATH}?id=${order.id}`,
        urlStatus: `${origin}${WEBHOOK_PATH}`,
      });
      await storage.markPaymentPending(order.id, payments.name, clock.now());
      await journal.info(order, OrderEvent.PAYMENT_REGISTERED, { [LogKey.PROVIDER]: payments.name, [LogKey.AMOUNT]: order.total });
      return redirectUrl;
    } catch (e) {
      await storage.markReleased(order.id, OrderStatus.FAILED);
      await journal.error(order, OrderEvent.PAYMENT_REGISTER_FAILED, { [LogKey.PROVIDER]: payments.name }, e);
      throw e;
    }
  }
}

const summarize = (items: OrderItem[]) => items.map((i) => ({ [LogKey.PRODUCT_ID]: i.productId, qty: i.quantity, price: i.unitPrice }));
