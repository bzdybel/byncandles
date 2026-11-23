/**
 * Katalog po stronie serwera: ceny, nazwy i stan z panelu pochodzą z plików wygenerowanych przy buildzie
 * (/katalog.json, /konfiguracja-sklepu.json) - Worker czyta je z ASSETS, nie z przeglądarki klienta.
 * Schematy Zod pilnują kontraktu między buildem a Workerem: zmiana formatu po jednej stronie = czytelny błąd
 * zamiast złych cen w zamówieniu.
 */
import * as z from 'zod/mini';
import type { ShopConfig } from '../../src/lib/pricing.ts';
import type { Catalog } from '../../src/scripts/cart-store.ts';
import type { Fetcher } from '../storage/d1.ts';

export const CATALOG_PATH = '/katalog.json';
export const CONFIG_PATH = '/konfiguracja-sklepu.json';

const grosze = z.int().check(z.gte(0));

/** [nazwa, cena w groszach, stan z panelu, url, miniatura] - patrz CatalogRow w src/scripts/cart-store.ts */
export const catalogSchema = z.record(z.string(), z.tuple([z.string(), grosze, z.int().check(z.gte(0)), z.string(), z.optional(z.string())]));
export const shopConfigSchema = z.object({ shipping: grosze, freeFrom: z.optional(grosze), promo2plus1: z.boolean() });

export class CatalogService {
  private readonly assets: Fetcher;
  private readonly origin: string;
  constructor(assets: Fetcher, origin: string) {
    this.assets = assets;
    this.origin = origin;
  }

  private async load<S extends z.ZodMiniType>(path: string, schema: S): Promise<z.infer<S>> {
    const res = await this.assets.fetch(new Request(new URL(path, this.origin)));
    if (!res.ok) throw new Error(`Static asset ${path}: HTTP ${res.status}`);
    const parsed = z.safeParse(schema, await res.json().catch(() => null));
    if (!parsed.success) throw new Error(`Static asset ${path}: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  }

  /** Stan „z panelu” - przed odjęciem sprzedanych i zarezerwowanych sztuk. */
  catalog(): Promise<Catalog> {
    return this.load(CATALOG_PATH, catalogSchema);
  }

  config(): Promise<ShopConfig> {
    return this.load(CONFIG_PATH, shopConfigSchema);
  }
}
