# by N. candles

Strona-wizytówka Natalii i sklep z ręcznie robionymi świecami.
Instagram: [@by_n.candles](https://www.instagram.com/by_n.candles/)

## Stack

- [Astro](https://astro.build) - statyczny HTML, minimum JS (priorytet: SEO i szybkość)
- Hosting: Cloudflare Workers - statyczne assets (darmowe, adres tymczasowy `byncandles.devbz.workers.dev`)
- Keystatic (CMS na plikach w repo)
- Worker (`worker/`) - API zamówień: Cloudflare D1, Przelewy24, InPost ShipX, Resend

## Uruchomienie

Wymagany Node ≥ 22.23.4 (zalecany 24 LTS, patrz `.nvmrc`).

```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # wynik w dist/
npm run preview
npm test         # testy logiki (ceny, koszyk, walidacja, teksty)
npm run check    # typy

# API zamówień lokalnie (Worker + lokalna D1, płatności/przesyłki/e-maile „na niby”):
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run worker:dev   # http://localhost:8787 - cała strona + /api/*
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
- API zamówień przelicza ceny samo (klient wysyła tylko `id` + `qty`) i rezerwuje stan atomowo w D1 -
  dwie osoby nie kupią ostatniej sztuki (szczegóły: sekcja „API zamówień”).

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
- Zamówienie: `/zamowienie/` → `POST /api/orders` → Przelewy24 → `/zamowienie/dziekuje/`.
  Zmienne buildu (Cloudflare → Settings → Build → Variables):
  - `PUBLIC_CHECKOUT_ENDPOINT=/api/orders` - włącza płatności online. Bez niego formularz tworzy
    podsumowanie do wysłania na Instagramie (wyłącznik awaryjny: usuń zmienną i przebuduj).
  - `PUBLIC_INPOST_GEOWIDGET_TOKEN` - token Geowidgetu z Managera Paczek InPost (mapa paczkomatów).
    Bez niego klient wpisuje kod paczkomatu ręcznie.

## API zamówień (worker/)

Strona zostaje statyczna; Worker obsługuje tylko `/api/*` i `/katalog.json` (`run_worker_first` w `wrangler.jsonc`).
Wzorce jak w lavirant-vc: porty i adaptery (prawdziwy dostawca / noop), cienkie handlery → serwisy aplikacyjne →
repozytorium (`OrderStorage`, cały SQL), reguły biznesowe w domenie (czyste funkcje), `AppError` + centralna obsługa
błędów, jedna interpretacja konfiguracji (`config/appConfig.ts` → `prerequisites.ts` i `services/init.ts`), logi z `correlationId`.

```
worker/
  index.ts                    # router: correlationId, limit żądań, Basic auth, błędy, log; cron
  domain/                     # order.ts - statusy, rezerwacja, status publiczny, numer; events.ts - typy zdarzeń
  handlers/                   # HTTP: OrderHandlers, CatalogHandler, AdminOrdersHandler, DevPaymentHandler
  services/
    PlaceOrderService.ts      #   złożenie zamówienia: walidacja, paczkomat, zapis + rezerwacja, rejestracja płatności
    PaymentService.ts         #   powiadomienie P24, potwierdzenie wpłaty, odzyskanie zgubionej (cron)
    FulfillmentService.ts     #   przesyłka → e-mail klienta → powiadomienie sklepu (lease + wspólny cykl kroku)
    OrderJournal.ts, StockService.ts, CatalogService.ts, OrderFactory.ts, init.ts (composition root)
  payments/ shipping/ email/  # port + adapter (Przelewy24 / ShipX + punkty InPost / Resend) + noop
  jobs/ReconcileOrdersJob.ts  # cron co 10 min - siatka bezpieczeństwa
  storage/OrderStorage.ts     # D1
migrations/                   # schemat D1 (kolejne pliki = kolejne zmiany)
```

**Walidacja (Zod, `zod/mini`):** jeden schemat formularza w `src/lib/checkout.ts` - ten sam w przeglądarce i w API
(normalizuje telefon i kod paczkomatu). Po stronie serwera schematami są też: żądanie zamówienia (`OrderFactory`),
powiadomienie P24, odpowiedzi P24/ShipX/Resend (`expectResponse` - zmiana API dostawcy = czytelny błąd w dzienniku),
katalog i konfiguracja z buildu, zmienne środowiska (`appConfig` - zła wartość jest ignorowana z ostrzeżeniem)
i parametry panelu admina. `zod/mini` zamiast `zod`: to samo API w wersji funkcyjnej, które się „wytrząsa” -
strona zamówienia +5 KB gzip zamiast ~90 KB.

**Przepływ:** walidacja + ceny z katalogu z buildu (klient wysyła tylko `id` + `qty`) → sprawdzenie, czy paczkomat
istnieje (publiczne API InPost; awaria API nie blokuje) → zapis i **atomowa rezerwacja** sztuk w jednym batchu D1 →
rejestracja transakcji P24 → klient płaci → powiadomienie P24 (podpis SHA-384) → weryfikacja → `PAID` + licznik sprzedaży →
przesyłka ShipX → e-mail do klienta → powiadomienie sklepu.
Kroki po opłaceniu są niezależne i idempotentne; lease na zamówieniu nie pozwala webhookowi i cronowi wykonać ich
równolegle (podwójna przesyłka). Nieudany krok ponawia cron (do 3 prób), potem `POST …/retry` z panelu.

**Stan magazynowy:** dostępne = `stan` z panelu − sprzedane (licznik `product_sales`) − zarezerwowane (zamówienia czekające
na płatność, 45 min; P24 daje klientowi 30). Licznik zamiast sumowania historii: D1 nalicza odczytane wiersze,
a `/katalog.json` odpytuje każdy koszyk i każda strona produktu. `stan` w panelu = ile sztuk łącznie wystawiono -
dorobione sztuki się **dodaje**, sprzedaż online odejmuje się sama.

**Zabezpieczenia:** limit żądań per IP (`ratelimits` w `wrangler.jsonc`: zamówienia i panel admina), `POST /api/orders`
tylko z `Content-Type: application/json` (obca strona nie złoży zamówienia w imieniu odwiedzającego), limity czasu
na wywołaniach dostawców (15 s), podpis i kwota powiadomienia P24 sprawdzane przed weryfikacją.

**Cron (co 10 min):** pyta P24 o zamówienia bez powiadomienia (zgubiony webhook → opłaca), wygasza nieopłacone (`EXPIRED`),
ponawia brakującą przesyłkę / e-maile.

### Co się stało z zamówieniem? (logi i dziennik)

1. **Dziennik zamówienia** (trwały, w D1) - każdy krok z wynikiem, błędem i `correlationId`:
   ```sh
   curl -u admin:$ADMIN_PASSWORD https://<strona>/api/admin/orders/BN-7K3Q9X     # zamówienie, pozycje, dziennik, surowe webhooki P24
   curl -u admin:$ADMIN_PASSWORD 'https://<strona>/api/admin/orders?status=PAID'  # lista z kolumną „problems”
   curl -u admin:$ADMIN_PASSWORD -X POST https://<strona>/api/admin/orders/BN-7K3Q9X/retry  # ponów przesyłkę/e-maile po naprawie
   ```
   Albo SQL: `npx wrangler d1 execute byncandles --remote --command "SELECT * FROM order_events WHERE order_id = (SELECT id FROM orders WHERE number = 'BN-7K3Q9X')"`.
2. **Logi Workera** (Cloudflare → Workers → byncandles → Logs, ze stosem błędów i odpowiedziami dostawców):
   filtr `correlationId` z dziennika albo `metadata.orderNumber`. Klient przy błędzie widzi „Kod błędu” =
   pierwsze 8 znaków `correlationId` (filtr „contains”). Każda odpowiedź API ma nagłówek `correlation-id`.
3. **Powiadomienia P24** - tabela `webhook_events`: każde, także odrzucone (zły podpis) i powtórzone, z surową treścią.

Typy zdarzeń: `worker/constants/orderStatus.ts` (`OrderEvent`), klucze metadanych w logach: `worker/constants/logKeys.ts`.

### Uruchomienie produkcyjne (jednorazowo)

1. `npx wrangler d1 create byncandles` → `database_id` do `wrangler.jsonc`; `npm run db:migrate`.
   Każda nowa migracja (np. `0002_sales_and_lease.sql`): `npm run db:migrate` **przed** wdrożeniem kodu, który jej potrzebuje -
   migracje tylko dodają tabele/kolumny, więc poprzednia wersja Workera działa na nowym schemacie.
2. Sekrety (`npx wrangler secret put NAZWA`): `P24_MERCHANT_ID`, `P24_API_KEY`, `P24_CRC` (opcjonalnie `P24_POS_ID`),
   `SHIPX_TOKEN`, `SHIPX_ORG_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `SHOP_EMAIL`, `ADMIN_PASSWORD`.
   Brak P24 = API odpowiada 503 (zamówienia nie przechodzą bez płatności); brak ShipX/Resend = ostrzeżenie w logach.
3. Testy na sandboxach (`SANDBOX=1` w `wrangler.jsonc` → `vars`): zamówienie, płatność testowa, przesyłka w sandbox-Managerze Paczek.
4. Produkcja: `SANDBOX` na `"0"`, prawdziwe klucze, `PUBLIC_CHECKOUT_ENDPOINT=/api/orders` w zmiennych buildu.
   W panelu P24 nie trzeba ustawiać adresu powiadomień - Worker podaje go przy każdej transakcji.
5. Przed startem: treść regulaminu i polityki prywatności (zamówienie z obowiązkiem zapłaty, dane osobowe w D1, Resend, InPost).

## SEO - zasady

- Kanoniczne URL-e zakończone `/` (`trailingSlash: 'always'`).
- Strona bez docelowej treści → dopisz ją do `NOINDEX_PATHS` w `src/lib/site.ts`
  (dostaje `noindex` i znika z sitemapy). Po uzupełnieniu treści - usuń z listy.
- Zmiana domeny: ustaw `SITE_URL` w zmiennych buildu Cloudflare (patrz Deploy).

## Deploy (Cloudflare Workers)

Repo jest podpięte do Workers Builds - każdy push na `main` wdraża stronę, a każda gałąź/PR
dostaje własny link podglądu. Konfiguracja: `wrangler.jsonc` (statyczna strona + Worker API zamówień).

- Build command: `npm run build` · Deploy command: `npx wrangler deploy`
- Wersja Node z `.nvmrc`
- Adres strony (canonical, sitemap, Open Graph): zmienna `SITE_URL` w ustawieniach buildu
  (Settings → Build → Variables) - do czasu zakupu własnej domeny adres `*.workers.dev`.
- Ręcznie: `npm run deploy` (wymaga `npx wrangler login`).
