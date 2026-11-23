-- 1. Licznik sprzedanych sztuk per produkt: stan dostępny liczymy z niego zamiast sumować całą historię
--    opłaconych pozycji przy każdym /katalog.json (D1 nalicza odczytane wiersze - koszt rósłby z każdym zamówieniem).
-- 2. Lease na realizację zamówienia: webhook i cron nie wykonają równolegle kroków po opłaceniu (podwójna przesyłka).
-- 3. Limit prób powiadomienia sklepu (wcześniej ponawiane bez końca).

CREATE TABLE product_sales (
  product_id TEXT PRIMARY KEY,
  sold INTEGER NOT NULL DEFAULT 0 CHECK (sold >= 0)
);

ALTER TABLE orders ADD COLUMN sales_counted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN fulfillment_lease_until INTEGER;
ALTER TABLE orders ADD COLUMN shop_notify_attempts INTEGER NOT NULL DEFAULT 0;

-- Przeniesienie dotychczasowej sprzedaży do licznika.
INSERT INTO product_sales (product_id, sold)
  SELECT i.product_id, SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
  WHERE o.status = 'PAID' GROUP BY i.product_id;
UPDATE orders SET sales_counted = 1 WHERE status = 'PAID';
