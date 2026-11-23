-- Limit nieopłaconych rezerwacji na klienta: zablokowanie sklepu seryjnymi zamówieniami bez płatności.
-- client_hash = SHA-256(sól + IP), skrócony - nie przechowujemy adresu IP (RODO), tylko porównujemy.
ALTER TABLE orders ADD COLUMN client_hash TEXT;
CREATE INDEX orders_client ON orders (client_hash, status, created_at);
