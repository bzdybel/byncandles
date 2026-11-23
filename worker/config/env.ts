/**
 * Środowisko Workera: wiązania z wrangler.jsonc, zmienne (`vars`) i sekrety (`npx wrangler secret put NAZWA`).
 * Lokalnie: plik `.dev.vars` (wzór: `.dev.vars.example`).
 */
import type { D1Database, Fetcher } from '../storage/d1.ts';

export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;

  /** Adres strony do linków w e-mailach wysyłanych przez cron (w żądaniach bierzemy go z adresu żądania). */
  SITE_URL?: string;

  /** "1" = sandbox Przelewy24 i ShipX (testy bez prawdziwych pieniędzy i przesyłek). */
  SANDBOX?: string;
  /** "1" = adaptery noop (lokalny rozwój bez kont u dostawców). Na produkcji niedozwolone - patrz prerequisites. */
  MOCK_PAYMENTS?: string;
  MOCK_INPOST?: string;
  MOCK_EMAIL?: string;

  // Przelewy24 - panel P24 → Moje dane / Dane API
  P24_MERCHANT_ID?: string;
  P24_POS_ID?: string; // zwykle = merchant ID
  P24_API_KEY?: string; // „Klucz do raportów” (REST API)
  P24_CRC?: string;

  // InPost ShipX - Manager Paczek → Moje konto → API
  SHIPX_TOKEN?: string;
  SHIPX_ORG_ID?: string;
  /** Gabaryt: small (A), medium (B), large (C). Domyślnie small. */
  SHIPX_PARCEL?: string;
  /** Jak sklep nadaje: parcel_locker (w paczkomacie), dispatch_order (kurier odbiera), pop (punkt). */
  SHIPX_SENDING_METHOD?: string;

  // Resend - e-maile
  RESEND_API_KEY?: string;
  /** Nadawca w zweryfikowanej domenie, np. "by N. candles <zamowienia@byncandles.pl>". */
  MAIL_FROM?: string;
  /** Skrzynka sklepu - powiadomienia o zamówieniach i adres Reply-To dla klientów. */
  SHOP_EMAIL?: string;

  /** Hasło do /api/admin/* (Basic auth, użytkownik dowolny). Bez niego panel jest wyłączony. */
  ADMIN_PASSWORD?: string;
}

export const flag = (v: string | undefined) => v === '1' || v === 'true';
