-- Zamówienia, pozycje, dziennik zdarzeń i surowe powiadomienia płatności.
-- Kwoty w groszach, czasy w ms od epoki (Date.now()).
-- Stan dostępny = `stan` z panelu Keystatic − sztuki w zamówieniach aktywnych (worker/services/StockService.ts).

CREATE TABLE orders (
  id TEXT PRIMARY KEY,                       -- UUID: sessionId w Przelewy24, klucz linku powrotu
  number TEXT NOT NULL UNIQUE,               -- numer dla ludzi, np. BN-7K3Q9X
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'PAYMENT_PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELED')),
  correlation_id TEXT NOT NULL,              -- żądanie, które utworzyło zamówienie (logi Workers)
  created_at INTEGER NOT NULL,
  payment_provider TEXT,
  payment_pending_at INTEGER,
  payment_reference TEXT,                    -- orderId transakcji w Przelewy24
  payment_confirmed_at INTEGER,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  delivery_point_id TEXT NOT NULL,           -- kod paczkomatu
  gift INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  items_total INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  delivery_cost INTEGER NOT NULL,
  total INTEGER NOT NULL,
  shipment_id TEXT,                          -- ID przesyłki w ShipX (Manager Paczek)
  shipment_status TEXT,
  shipment_attempts INTEGER NOT NULL DEFAULT 0,
  shipment_error TEXT,
  email_sent_at INTEGER,                     -- potwierdzenie dla klienta
  email_attempts INTEGER NOT NULL DEFAULT 0,
  shop_notified_at INTEGER                   -- powiadomienie dla sklepu
);
CREATE INDEX orders_status ON orders (status, created_at);

CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  -- NOT NULL celowo: rezerwacja wstawia NULL, gdy brakuje sztuk → błąd → cały batch wycofany.
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);
CREATE INDEX order_items_product ON order_items (product_id);

-- Dziennik: każdy krok zamówienia (utworzenie, płatność, przesyłka, e-maile, błędy) - trwała historia „co się wydarzyło”.
CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  type TEXT NOT NULL,
  correlation_id TEXT,
  data TEXT                                  -- JSON
);
CREATE INDEX order_events_order ON order_events (order_id, id);

-- Każde powiadomienie od operatora płatności - także odrzucone (zły podpis) i powtórzone.
CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  order_id TEXT,
  payment_reference TEXT,
  signature_valid INTEGER NOT NULL,
  outcome TEXT NOT NULL,                     -- ACCEPTED | DUPLICATE | REJECTED | ERROR
  correlation_id TEXT,
  raw_payload TEXT NOT NULL
);
CREATE INDEX webhook_events_order ON webhook_events (order_id);
