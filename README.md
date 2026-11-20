# by N. candles

Strona-wizytówka Natalii i sklep z ręcznie robionymi świecami.
Instagram: [@by_n.candles](https://www.instagram.com/by_n.candles/)

## Stack

- [Astro](https://astro.build) - statyczny HTML, minimum JS (priorytet: SEO i szybkość)
- Hosting: Cloudflare Workers - statyczne assets (darmowe, adres tymczasowy `byncandles.devbz.workers.dev`)
- Keystatic (CMS na plikach w repo)
- Planowane: Cloudflare D1 (zamówienia), InPost Geowidget + ShipX, Przelewy24

## Uruchomienie

Wymagany Node ≥ 22.23.4 (zalecany 24 LTS, patrz `.nvmrc`).

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # wynik w dist/
npm run preview
npm test         # testy logiki (ceny, koszyk, walidacja, teksty)
npm run check    # typy
```

## Architektura

```
src/
  i18n/pl.ts            # WSZYSTKIE teksty interfejsu, opisy zdjęć i meta - jedyne źródło
  styles/global.css     # tokeny (kolory, typografia, odstępy, ruch) + wspólne wzorce - jedyne źródło stylów globalnych
  lib/                  # czyste moduły TS (bez DOM), testowane w tests/
    money.ts            #   grosze ↔ zł, formatowanie kwot (jedyne miejsce konwersji)
    pricing.ts          #   reguły koszyka: sumy, 2+1, darmowa dostawa
    checkout.ts         #   walidacja zamówienia + podsumowanie (teksty wstrzykiwane)
    i18n.ts             #   fill() - zmienne w tekstach, plural() - polska odmiana
    shop.ts             #   zapytania do katalogu (Keystatic), konfiguracja sklepu
    schema.ts           #   JSON-LD dla Google
    media.ts, images.ts #   formaty/rozmiary obrazów, zdjęcia strony
    site.ts             #   URL, nawigacja, noindex (konfiguracja, nie teksty)
  scripts/              # kod przeglądarki
    cart-store.ts       #   stan koszyka (localStorage) + uzgadnianie z /katalog.json
    cart-ui.ts          #   wspólne renderowanie (sumy, licznik, aria-live)
  components/           # UI: Img, Price, CartTotals, CartDrawer, ProductCard, Accordion…
  pages/                # trasy; katalog.json.ts - statyczny katalog cen i stanów
tests/                  # npm test (node --test, bez zależności)
```

### Zasady
- **Teksty** tylko w `src/i18n/pl.ts`, pogrupowane w eksporty nazwane (`home`, `cart`, `checkout`…).
  Skrypty przeglądarki importują wyłącznie `cart`; teksty innych stron osadzamy jako JSON z serwera,
  żeby nie trafiały do wspólnej paczki JS. Wyjątek: komunikaty panelu Keystatic i błędy buildu (dla Natalii/dewelopera).
- **Style**: wartości (kolor, rozmiar, odstęp, czas) wyłącznie przez tokeny z `global.css`.
  Wzorce używane w 2+ miejscach (`.actions`, `.split`, `.section-head`, `.icon-btn`, `.link-btn`, `.frame`)
  są globalne; style jednego komponentu zostają w nim (scoped).
- **Kwoty** zawsze w groszach (`Grosze`); złote tylko na wejściu z panelu (`toGrosze`).
- **Importy TS→TS** z rozszerzeniem `.ts` (wymóg `node --test`).

### Wielu klientów jednocześnie
- Strona jest statyczna i serwowana z CDN Cloudflare - liczba klientów nie obciąża serwera (pliki statyczne są darmowe i bez limitu).
- Koszyk każdego klienta żyje w jego przeglądarce; synchronizuje się między kartami (`storage`).
- Ceny i stany w koszyku są uzgadniane z `/katalog.json` (najwyżej raz na minutę, walidacja ETag → zwykle 304)
  oraz zawsze przed złożeniem zamówienia: produkt wyprzedany znika, zmieniona cena się aktualizuje, ilość jest przycinana.
- **Wymóg dla API zamówień (kolejny etap):** serwer przelicza ceny sam (klient wysyła tylko `id` + `qty`)
  i rezerwuje stan atomowo, np. w D1: `UPDATE produkty SET stan = stan - ? WHERE id = ? AND stan >= ?` -
  inaczej dwie osoby mogą kupić ostatnią sztukę.

### Wydajność (decyzje)
- Jost jako font zmienny (2 pliki zamiast 6); fonty 6 zapytań, ~90 KB, preload tylko łacińskich.
- CSS w jednym pliku buforowanym (`inlineStylesheets: 'auto'`): wstawienie do HTML dawało −80 ms FCP na głównej,
  bez zmiany LCP, kosztem +3 KB na każdy HTML - nie warto.
- JS na stronę ~4,3 KB gzip (prefetch, koszyk); strona zamówienia +1,9 KB.

## Panel treści (Keystatic)

`npm run dev` → http://127.0.0.1:4321/keystatic

- **Produkty**: jeden plik `src/content/produkty/<adres-url>.yaml` = jeden produkt (dodanie pliku dodaje produkt,
  usunięcie lub status *Ukryty* go chowa). Pola: nazwa, cena (opcjonalna), promocja (+ najniższa cena z 30 dni - Omnibus), stan, zdjęcia z opisem `alt`,
  kompozycja zapachowa, szczegóły, ostrzeżenia CLP. Status *Ukryty* = produkt niewidoczny na stronie.
- **Kategorie**: strona kategorii powstaje dopiero, gdy ma co najmniej jeden widoczny produkt.
- **Ustawienia sklepu**: **cena domyślna** (`cenaDomyslna` w `src/content/ustawienia.yaml` - cena każdego produktu
  bez własnej ceny, czyli zmiana ceny całego sklepu w jednym miejscu), koszty wysyłki InPost, dane producenta (GPSR).
- **Zdjęcia**: WebP (strona serwuje wyłącznie WebP; JPEG tylko dla podglądów linków w Open Graph).

Zapis tworzy pliki w `src/content/` i `src/assets/produkty/` - commit + PR publikuje zmiany.
Logowanie przez GitHub dla Natalii (edycja bez lokalnego środowiska) - kolejny etap.

## Koszyk i zamówienia

- Koszyk: `src/scripts/cart-store.ts` + `src/lib/pricing.ts` + panel `src/components/CartDrawer.astro` (`<dialog>`) - szczegóły w sekcji Architektura.
- Promocja 2+1 i koszty dostawy: **Ustawienia sklepu** w panelu Keystatic.
- Zamówienie: `/zamowienie/`. Zmienne buildu (Cloudflare → Settings → Build → Variables):
  - `PUBLIC_INPOST_GEOWIDGET_TOKEN` - token Geowidgetu z Managera Paczek InPost (mapa paczkomatów).
    Bez niego klient wpisuje kod paczkomatu ręcznie.
  - `PUBLIC_CHECKOUT_ENDPOINT` - API zamówień i płatności Przelewy24 (kolejny etap).
    Bez niego formularz tworzy podsumowanie do wysłania w wiadomości na Instagramie.

## SEO - zasady

- Kanoniczne URL-e zakończone `/` (`trailingSlash: 'always'`).
- Strona bez docelowej treści → dopisz ją do `NOINDEX_PATHS` w `src/lib/site.ts`
  (dostaje `noindex` i znika z sitemapy). Po uzupełnieniu treści - usuń z listy.
- Zmiana domeny: ustaw `SITE_URL` w zmiennych buildu Cloudflare (patrz Deploy).

## Deploy (Cloudflare Workers)

Repo jest podpięte do Workers Builds - każdy push na `main` wdraża stronę, a każda gałąź/PR
dostaje własny link podglądu. Konfiguracja: `wrangler.jsonc` (sama statyczna strona, bez skryptu Workera).

- Build command: `npm run build` · Deploy command: `npx wrangler deploy`
- Wersja Node z `.nvmrc`
- Adres strony (canonical, sitemap, Open Graph): zmienna `SITE_URL` w ustawieniach buildu
  (Settings → Build → Variables) - do czasu zakupu własnej domeny adres `*.workers.dev`.
- Ręcznie: `npm run deploy` (wymaga `npx wrangler login`).
