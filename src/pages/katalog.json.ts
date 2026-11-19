/**
 * Statyczny katalog do uzgadniania koszyków (ceny, stany, nazwy) — generowany przy buildzie, serwowany z CDN.
 * Zawiera wyłącznie produkty, które można teraz kupić.
 */
import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { toGrosze } from '../lib/money.ts';
import { cenaAktualna, naStanie, produktyPubliczne, urlProduktu } from '../lib/shop.ts';
import type { Catalog } from '../scripts/cart-store.ts';
import { THUMB } from '../lib/media.ts';

export const GET: APIRoute = async () => {
  const catalog: Catalog = {};
  for (const p of await produktyPubliczne()) {
    if (!naStanie(p.data)) continue;
    const thumb = await getImage({ src: p.data.zdjecia[0].zdjecie, ...THUMB });
    catalog[p.id] = [p.data.nazwa, toGrosze(cenaAktualna(p.data)), p.data.stan, urlProduktu(p), thumb.src];
  }
  return new Response(JSON.stringify(catalog), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
};
