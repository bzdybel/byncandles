/**
 * Konfiguracja witryny (nie teksty - te są w src/i18n/pl.ts).
 * Domena tymczasowa - po zakupie własnej ustaw zmienną buildu SITE_URL w Cloudflare.
 */
import { nav } from '../i18n/pl.ts';

export const SITE_URL: string =
  (typeof process !== 'undefined' && process.env.SITE_URL) || 'https://byncandles.devbz.workers.dev';

export const SITE = {
  lang: 'pl',
  locale: 'pl_PL',
  instagram: 'https://www.instagram.com/by_n.candles/',
} as const;

export const NAV = [
  { href: '/sklep/', label: nav.shop },
  { href: '/kontakt/', label: nav.contact },
] as const;

/**
 * Ścieżki wyłączone z indeksowania (noindex + brak w sitemapie).
 * Usuń stronę z listy, gdy dostanie docelową treść.
 */
export const NOINDEX_PATHS: readonly string[] = [
  '/dostawa-i-zwroty/',
  '/regulamin/',
  '/polityka-prywatnosci/',
  '/zamowienie/',
];
