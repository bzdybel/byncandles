/**
 * Katalog po stronie serwera: ceny, nazwy i stan z panelu pochodzą z plików wygenerowanych przy buildzie
 * (/katalog.json, /konfiguracja-sklepu.json) - Worker czyta je z ASSETS, nie z przeglądarki klienta.
 */
import type { ShopConfig } from '../../src/lib/pricing.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import type { Fetcher } from '../storage/d1.ts';

export const CATALOG_PATH = '/katalog.json';
export const CONFIG_PATH = '/konfiguracja-sklepu.json';

export class CatalogService {
  private readonly assets: Fetcher;
  private readonly origin: string;
  constructor(assets: Fetcher, origin: string) {
    this.assets = assets;
    this.origin = origin;
  }

  private async load<T>(path: string): Promise<T> {
    const res = await this.assets.fetch(new Request(new URL(path, this.origin)));
    if (!res.ok) throw new Error(`Static asset ${path}: ${res.status}`);
    return (await res.json()) as T;
  }

  /** Stan „z panelu” - przed odjęciem sprzedanych i zarezerwowanych sztuk. */
  catalog(): Promise<Catalog> {
    return this.load<Catalog>(CATALOG_PATH);
  }

  config(): Promise<ShopConfig> {
    return this.load<ShopConfig>(CONFIG_PATH);
  }
}
