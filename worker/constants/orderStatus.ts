/** Statusy zamówienia (kolumna orders.status) i zdarzenia dziennika (order_events.type). */

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

/** Statusy, które trzymają sztuki (CREATED/PAYMENT_PENDING tylko do upływu rezerwacji). */
export const HOLDING_STATUSES: readonly OrderStatusType[] = [OrderStatus.CREATED, OrderStatus.PAYMENT_PENDING];

export const OrderEvent = {
  ORDER_CREATED: 'order_created',
  ORDER_REJECTED_STOCK: 'order_rejected_stock',
  ORDER_CANCELED_BY_RETRY: 'order_canceled_by_retry',
  PAYMENT_REGISTERED: 'payment_registered',
  PAYMENT_REGISTER_FAILED: 'payment_register_failed',
  WEBHOOK_RECEIVED: 'webhook_received',
  WEBHOOK_REJECTED: 'webhook_rejected',
  WEBHOOK_DUPLICATE: 'webhook_duplicate',
  /** Wpłata znaleziona przez cron - powiadomienie od P24 nie dotarło. */
  PAYMENT_RECOVERED: 'payment_recovered',
  PAYMENT_AMOUNT_MISMATCH: 'payment_amount_mismatch',
  PAYMENT_VERIFIED: 'payment_verified',
  PAYMENT_VERIFY_FAILED: 'payment_verify_failed',
  ORDER_PAID: 'order_paid',
  PAID_AFTER_EXPIRY: 'paid_after_expiry',
  ORDER_EXPIRED: 'order_expired',
  SHIPMENT_CREATED: 'shipment_created',
  SHIPMENT_FAILED: 'shipment_failed',
  EMAIL_SENT: 'email_sent',
  EMAIL_FAILED: 'email_failed',
  SHOP_NOTIFIED: 'shop_notified',
  SHOP_NOTIFY_FAILED: 'shop_notify_failed',
} as const;
export type OrderEventType = (typeof OrderEvent)[keyof typeof OrderEvent];

/** Wynik obsługi powiadomienia płatności (webhook_events.outcome). */
export const WebhookOutcome = {
  ACCEPTED: 'ACCEPTED',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
  ERROR: 'ERROR',
} as const;
export type WebhookOutcomeType = (typeof WebhookOutcome)[keyof typeof WebhookOutcome];

/** Ile razy zadanie cykliczne ponawia przesyłkę / e-mail, zanim zostawi to człowiekowi. */
export const MAX_ATTEMPTS = 3;
