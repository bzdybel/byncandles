/**
 * Stan dostępny = `stan` z panelu − sztuki w zamówieniach, które je trzymają:
 * opłaconych oraz czekających na płatność krócej niż RESERVATION_MS. Nieopłacone zamówienie samo
 * „oddaje” sztuki po tym czasie - bez crona; cron tylko porządkuje statusy (EXPIRED).
 *
 * Dlatego `stan` w panelu oznacza „ile sztuk łącznie wystawiono do sprzedaży”:
 * przy dorobieniu nowych sztuk dodaje się je do tej liczby (sprzedaż online odejmuje się sama).
 */
import type { Catalog } from '../../src/scripts/cart-store.ts';
import type { OrderStorage } from '../storage/OrderStorage.ts';
import type { ClockPort } from '../utils/ports.ts';
import { PAYMENT_TIME_LIMIT_MIN } from '../payments/PaymentProvider.ts';

/** Rezerwacja trwa dłużej niż limit płatności - zapas na spóźnione powiadomienie z P24. */
export const RESERVATION_MS = (PAYMENT_TIME_LIMIT_MIN + 15) * 60_000;

/** Czysta funkcja: katalog po odjęciu zajętych sztuk; wyprzedane znikają (jak w katalogu z buildu). */
export function applyReserved(catalog: Catalog, reserved: Map<string, number>): Catalog {
  const out: Catalog = {};
  for (const [id, row] of Object.entries(catalog)) {
    const left = row[2] - (reserved.get(id) ?? 0);
    if (left > 0) out[id] = [row[0], row[1], left, row[3], row[4]];
  }
  return out;
}

export class StockService {
  private readonly deps: { storage: OrderStorage; clock: ClockPort };
  constructor(deps: { storage: OrderStorage; clock: ClockPort }) {
    this.deps = deps;
  }

  cutoff(): number {
    return this.deps.clock.now() - RESERVATION_MS;
  }

  /** @param excludeOrderId nieopłacone zamówienie, które ponowna próba zaraz zastąpi - jego sztuki są „wolne” dla klienta */
  async available(catalog: Catalog, excludeOrderId?: string): Promise<Catalog> {
    return applyReserved(catalog, await this.deps.storage.reservedCounts(this.cutoff(), excludeOrderId));
  }
}
