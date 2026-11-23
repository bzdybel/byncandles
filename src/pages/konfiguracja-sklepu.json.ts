/**
 * Reguły koszyka (wysyłka, darmowa dostawa, 2+1) w groszach - generowane przy buildzie z ustawień sklepu.
 * Czyta je API zamówień (worker/services/CatalogService.ts), żeby liczyć sumy tymi samymi regułami co koszyk.
 * Dane są i tak publiczne (osadzone na każdej stronie w #shop-config).
 */
import type { APIRoute } from 'astro';
import { shopConfig } from '../lib/shop.ts';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await shopConfig()), { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
