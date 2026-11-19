/**
 * Globalne dane marki. Domena tymczasowa — po zakupie własnej zmień SITE_URL
 * (lub ustaw zmienną buildu SITE_URL w Cloudflare Workers).
 */
export const SITE_URL: string =
  (typeof process !== 'undefined' && process.env.SITE_URL) || 'https://byncandles.devbz.workers.dev';

export const SITE = {
  name: 'by N. candles',
  shortName: 'by N.',
  locale: 'pl_PL',
  lang: 'pl',
  description:
    'Ręcznie robione świece by N. — tworzone z pasją przez Natalię. Odkryj kolekcję i zamów z dostawą InPost.',
  author: 'Natalia',
  instagram: 'https://www.instagram.com/by_n.candles/',
  email: '', // uzupełnić
} as const;

export const NAV = [
  { href: '/sklep/', label: 'Sklep' },
  { href: '/o-mnie/', label: 'O mnie' },
  { href: '/kontakt/', label: 'Kontakt' },
] as const;

/**
 * Ścieżki wyłączone z indeksowania (noindex + brak w sitemapie).
 * Usuń stronę z listy, gdy dostanie docelową treść.
 */
export const NOINDEX_PATHS: readonly string[] = [
  '/kontakt/',
  '/dostawa-i-zwroty/',
  '/regulamin/',
  '/polityka-prywatnosci/',
  '/koszyk/',
  '/zamowienie/',
  '/dziekujemy/',
];
