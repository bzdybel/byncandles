/** Zdarzenia dziennika zamówienia (order_events.type) i wyniki powiadomień płatności (webhook_events.outcome). */

export const OrderEvent = {
  ORDER_CREATED: 'order_created',
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

export const WebhookOutcome = {
  ACCEPTED: 'ACCEPTED',
  DUPLICATE: 'DUPLICATE',
  REJECTED: 'REJECTED',
  ERROR: 'ERROR',
} as const;
export type WebhookOutcomeType = (typeof WebhookOutcome)[keyof typeof WebhookOutcome];
