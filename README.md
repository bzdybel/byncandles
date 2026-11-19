# by N. candles

Strona-wizytówka Natalii i sklep z ręcznie robionymi świecami.
Instagram: [@by_n.candles](https://www.instagram.com/by_n.candles/)

## Stack

- [Astro](https://astro.build) — statyczny HTML, minimum JS (priorytet: SEO i szybkość)
- Hosting: Cloudflare Pages (darmowy, domena tymczasowa `byncandles.pages.dev`)
- Keystatic (CMS na plikach w repo)
- Planowane: Cloudflare D1 (zamówienia), InPost Geowidget + ShipX, Przelewy24

## Uruchomienie

Wymagany Node ≥ 22.23.4 (zalecany 24 LTS, patrz `.nvmrc`).

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # wynik w dist/
npm run preview
```

## Struktura

```
src/
  lib/site.ts          # dane marki, nawigacja, SITE_URL, lista noindex
  layouts/Base.astro   # szkielet HTML strony
  components/Seo.astro # meta, canonical, Open Graph, JSON-LD
  pages/               # trasy (URL = ścieżka pliku)
  lib/shop.ts          # pobieranie produktów, ceny (grosze), statusy
  content.config.ts    # schematy kolekcji (zgodne z keystatic.config.ts)
  content/             # dane produktów, kategorii, ustawień (YAML)
  styles/global.css    # tokeny designu (robocze — do dopasowania pod Instagram)
public/_headers        # nagłówki Cloudflare Pages (cache, bezpieczeństwo)
```

## Panel treści (Keystatic)

`npm run dev` → http://127.0.0.1:4321/keystatic

- **Produkty**: nazwa, cena, promocja (+ najniższa cena z 30 dni — Omnibus), stan, zdjęcia z opisem `alt`,
  kompozycja zapachowa, szczegóły, ostrzeżenia CLP. Status *Ukryty* = produkt niewidoczny na stronie.
- **Kategorie**: strona kategorii powstaje dopiero, gdy ma co najmniej jeden widoczny produkt.
- **Ustawienia sklepu**: koszty wysyłki InPost, dane producenta (GPSR).

Zapis tworzy pliki w `src/content/` i `src/assets/produkty/` — commit + PR publikuje zmiany.
Logowanie przez GitHub dla Natalii (edycja bez lokalnego środowiska) — kolejny etap.

## SEO — zasady

- Kanoniczne URL-e zakończone `/` (`trailingSlash: 'always'`).
- Strona bez docelowej treści → dopisz ją do `NOINDEX_PATHS` w `src/lib/site.ts`
  (dostaje `noindex` i znika z sitemapy). Po uzupełnieniu treści — usuń z listy.
- Zmiana domeny: ustaw `SITE_URL` w zmiennych środowiskowych Cloudflare Pages.

## Deploy (Cloudflare Pages)

Build command: `npm run build` · Output: `dist` · Zmienna `NODE_VERSION=24`.
