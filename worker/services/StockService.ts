/**
 * Stan dostępny = `stan` z panelu − sprzedane − zarezerwowane (zamówienia czekające na płatność krócej niż
 * RESERVATION_MS). Nieopłacone zamówienie samo „oddaje” sztuki po tym czasie - cron tylko porządkuje statusy.
 *
 * Dlatego `stan` w panelu oznacza „ile sztuk łącznie wystawiono do sprzedaży”:
 * przy dorobieniu nowych sztuk dodaje się je do tej liczby (sprzedaż online odejmuje się sama).
 */
import type { Catalog } from '../../src/scripts/cart-store.ts';
import { reservationCutoff } from '../domain/order.ts';
import type { OrderStorage } from '../storage/OrderStorage.ts';
import type { ClockPort } from '../utils/ports.ts';

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
    return reservationCutoff(this.deps.clock.now());
  }

  /** @param excludeOrderId nieopłacone zamówienie, które ponowna próba zaraz zastąpi - jego sztuki są „wolne” dla klienta */
  async available(catalog: Catalog, excludeOrderId?: string): Promise<Catalog> {
    return applyReserved(catalog, await this.deps.storage.reservedCounts(this.cutoff(), excludeOrderId));
  }
}
