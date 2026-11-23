/**
 * GET /katalog.json - katalog z buildu po odjęciu sprzedanych i zarezerwowanych sztuk.
 * Koszyki uzgadniają się z nim co minutę i przed złożeniem zamówienia (src/scripts/cart-store.ts).
 * Awaria D1 nie psuje sklepu: oddajemy katalog z buildu (ostateczną kontrolę i tak robi rezerwacja).
 */
import { LogKey } from '../constants/logKeys.ts';
import { etag } from '../utils/http.ts';
import type { Handler } from './types.ts';

export const CatalogHandler: Handler = async ({ request, services }) => {
  const base = await services.catalog.catalog();
  let catalog = base;
  try {
    catalog = await services.stock.available(base);
  } catch (error) {
    services.logger.error({ message: 'Catalog: stock lookup failed, serving build catalog', metadata: { [LogKey.PATH]: '/katalog.json' }, error });
  }
  const body = JSON.stringify(catalog);
  const tag = await etag(body);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ETag: tag };
  if (request.headers.get('If-None-Match') === tag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
};
