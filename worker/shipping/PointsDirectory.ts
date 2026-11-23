/**
 * Czy paczkomat istnieje - sprawdzane PRZED płatnością. Literówka w ręcznie wpisanym kodzie oznaczałaby
 * opłacone zamówienie, dla którego ShipX odmówi założenia przesyłki.
 * Publiczne API punktów InPost (bez tokenu). Awaria API nie blokuje zamówienia - zwracamy `null` („nie wiadomo”).
 */
import { callProvider, defaultFetch } from '../utils/providerHttp.ts';

export interface PointsDirectory {
  /** true = istnieje, false = nie ma takiego punktu, null = nie udało się sprawdzić. */
  exists(pointId: string): Promise<boolean | null>;
}

const POINTS_TIMEOUT_MS = 3_000;

export class InPostPoints implements PointsDirectory {
  private readonly fetchFn: typeof fetch;
  constructor(fetchFn: typeof fetch = defaultFetch) {
    this.fetchFn = fetchFn;
  }

  async exists(pointId: string): Promise<boolean | null> {
    try {
      const { status } = await callProvider(
        'inpost_points',
        `https://api-shipx-pl.easypack24.net/v1/points/${encodeURIComponent(pointId)}`,
        { method: 'GET' },
        this.fetchFn,
        POINTS_TIMEOUT_MS,
      );
      if (status === 200) return true;
      if (status === 404) return false;
      return null;
    } catch {
      return null;
    }
  }
}

/** MOCK_INPOST=1 - każdy kod jest poprawny. */
export const PointsNoop: PointsDirectory = { exists: async () => true };
