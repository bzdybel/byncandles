/**
 * Kanoniczne klucze metadanych w logach - jedna nazwa na jedną wartość (bez „orderID” obok „order_id”).
 * Po nich filtrujemy w Cloudflare → Workers → Logs, np. `metadata.orderNumber = "BN-7K3Q9X"`.
 */
export const LogKey = {
  // Identyfikatory
  ORDER_ID: 'orderId', // UUID zamówienia (D1)
  ORDER_NUMBER: 'orderNumber', // numer dla ludzi, np. BN-7K3Q9X
  PAYMENT_REFERENCE: 'paymentReference', // orderId transakcji w Przelewy24
  PROVIDER_SHIPMENT_ID: 'providerShipmentId', // ID przesyłki w ShipX
  PRODUCT_ID: 'productId',
  EVENT: 'event', // typ zdarzenia z OrderEvent

  // HTTP
  METHOD: 'method',
  PATH: 'path',
  STATUS_CODE: 'statusCode',
  DURATION_MS: 'durationMs',

  // Płatność i koszyk
  AMOUNT: 'amount', // grosze
  ITEMS: 'items',
  STATUS: 'status',
  PROVIDER: 'provider',
  PROVIDER_STATUS: 'providerStatus',

  // E-mail
  MESSAGE_ID: 'messageId',

  // Zadania
  JOB: 'job',
  ATTEMPT: 'attempt',

  // Konfiguracja
  WARNINGS: 'warnings',
  ERRORS: 'errors',
} as const;

export type LogKeyType = (typeof LogKey)[keyof typeof LogKey];
