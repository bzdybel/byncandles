/**
 * Domena zamówienia: typy, statusy i reguły biznesowe jako czyste funkcje - jedno źródło prawdy
 * dla handlerów, serwisów, SQL (OrderStorage) i zadania cyklicznego. Bez I/O, bez zależności od Workers.
 */

export const OrderStatus = {
  /** Zapisane, sztuki zarezerwowane, transakcja w P24 jeszcze niezarejestrowana. */
  CREATED: 'CREATED',
  /** Klient przekierowany do płatności. */
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAID: 'PAID',
  /** Nie udało się zarejestrować płatności - sztuki zwolnione. */
  FAILED: 'FAILED',
  /** Nieopłacone w czasie rezerwacji (potwierdzone w P24 przez zadanie cykliczne). */
  EXPIRED: 'EXPIRED',
  /** Zastąpione nową próbą z tej samej przeglądarki albo anulowane ręcznie. */
  CANCELED: 'CANCELED',
} as const;
export type OrderStatusType = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Statusy czekające na płatność - trzymają sztuki, ale tylko do końca rezerwacji. */
export const AWAITING_PAYMENT: readonly OrderStatusType[] = [OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING];
/** Statusy, z których wolno zwolnić sztuki (nigdy z opłaconego). */
export type ReleasedStatus = typeof OrderStatus.FAILED | typeof OrderStatus.EXPIRED | typeof OrderStatus.CANCELED;

// ── Polityki czasowe ───────────────────────────────────────────

/** Ile minut klient ma na zapłatę (P24 `timeLimit`). */
export const PAYMENT_TIME_LIMIT_MIN = 30;
/** Rezerwacja trwa dłużej niż limit płatności - zapas na spóźnione powiadomienie z P24. */
export const RESERVATION_MS = (PAYMENT_TIME_LIMIT_MIN + 15) * 60_000;
/** Po tylu próbach krok realizacji (przesyłka, e-mail) czeka na człowieka. */
export const MAX_ATTEMPTS = 3;
/** Kwota minimalna transakcji w P24 (grosze). */
export const MIN_ORDER_TOTAL = 100;

// ── Typy ───────────────────────────────────────────────────────

export interface Order {
  id: string;
  number: string;
  status: OrderStatusType;
  correlationId: string;
  createdAt: number;
  paymentProvider: string | null;
  paymentPendingAt: number | null;
  paymentReference: string | null;
  paymentConfirmedAt: number | null;
  customerName: string;
  email: string;
  phone: string;
  deliveryPointId: string;
  gift: boolean;
  notes: string | null;
  itemsTotal: number;
  discount: number;
  deliveryCost: number;
  total: number;
  shipmentId: string | null;
  shipmentStatus: string | null;
  shipmentAttempts: number;
  shipmentError: string | null;
  emailSentAt: number | null;
  emailAttempts: number;
  shopNotifiedAt: number | null;
  shopNotifyAttempts: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export type NewOrder = Pick<
  Order,
  'id' | 'number' | 'correlationId' | 'createdAt' | 'customerName' | 'email' | 'phone' | 'deliveryPointId' | 'gift' | 'notes' | 'itemsTotal' | 'discount' | 'deliveryCost' | 'total'
>;

/** Minimum do dziennika i logów. */
export type OrderRef = Pick<Order, 'id' | 'number'>;

// ── Reguły ─────────────────────────────────────────────────────

/** Granica rezerwacji: zamówienia czekające na płatność utworzone wcześniej już nie trzymają sztuk. */
export const reservationCutoff = (now: number) => now - RESERVATION_MS;

export const isAwaitingPayment = (o: Pick<Order, 'status'>) => AWAITING_PAYMENT.includes(o.status);

/** Czy zamówienie trzyma teraz sztuki. */
export function holdsStock(o: Pick<Order, 'status' | 'createdAt'>, now: number): boolean {
  if (o.status === OrderStatus.PAID) return true;
  return isAwaitingPayment(o) && o.createdAt > reservationCutoff(now);
}

export type PublicOrderStatus = 'paid' | 'pending' | 'expired';

/** Status dla klienta (strona podziękowania) - bez szczegółów wewnętrznych. */
export function publicStatus(o: Pick<Order, 'status' | 'createdAt'>, now: number): PublicOrderStatus {
  if (o.status === OrderStatus.PAID) return 'paid';
  if (holdsStock(o, now)) return 'pending';
  return 'expired';
}

/** Opłacone po zwolnieniu rezerwacji - sztuki mogły w międzyczasie trafić do kogoś innego. */
export const isPaidLate = (before: Pick<Order, 'status' | 'createdAt'>, now: number) => !holdsStock(before, now);

/** Co w opłaconym zamówieniu wymaga uwagi człowieka (panel admina). */
export function orderProblems(o: Order): string[] {
  if (o.status !== OrderStatus.PAID) return [];
  return [
    !o.shipmentId && 'brak przesyłki',
    !o.emailSentAt && 'brak e-maila do klienta',
    !o.shopNotifiedAt && 'sklep niepowiadomiony',
  ].filter((p): p is string => Boolean(p));
}

/** Numer dla ludzi: BN- + 6 znaków bez mylących (0/O, 1/I/L). */
export function orderNumber(random: Uint8Array): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return `BN-${[...random].map((b) => alphabet[b % alphabet.length]).join('')}`;
}
