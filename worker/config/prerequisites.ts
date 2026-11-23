/**
 * Sprawdzenie konfiguracji (wzorzec Prerequisites): błędy = sklep nie przyjmuje zamówień (503, zamiast
 * przyjmować je bez płatności), ostrzeżenia = działa, ale bez części automatyzacji. Wynik idzie do logów.
 */
import { flag, type Env } from './env.ts';

export interface PrerequisiteResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

const missing = (env: Env, keys: (keyof Env)[]) => keys.filter((k) => !String(env[k] ?? '').trim());

export function checkPrerequisites(env: Env): PrerequisiteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (flag(env.MOCK_PAYMENTS)) {
    warnings.push('MOCK_PAYMENTS=1 - płatności symulowane, nikt nie zapłaci naprawdę');
  } else {
    const m = missing(env, ['P24_MERCHANT_ID', 'P24_API_KEY', 'P24_CRC']);
    if (m.length) errors.push(`Przelewy24: brak ${m.join(', ')}`);
  }

  if (flag(env.MOCK_INPOST)) warnings.push('MOCK_INPOST=1 - przesyłki symulowane');
  else if (missing(env, ['SHIPX_TOKEN', 'SHIPX_ORG_ID']).length) warnings.push('ShipX nieskonfigurowany - przesyłki trzeba zakładać ręcznie w Managerze Paczek');

  if (flag(env.MOCK_EMAIL)) warnings.push('MOCK_EMAIL=1 - e-maile tylko w logach');
  else if (missing(env, ['RESEND_API_KEY', 'MAIL_FROM']).length) warnings.push('Resend nieskonfigurowany - brak e-maili z potwierdzeniem (wymagane prawem: potwierdzenie umowy na trwałym nośniku)');
  if (!env.SHOP_EMAIL) warnings.push('SHOP_EMAIL pusty - sklep nie dostanie powiadomień o zamówieniach');
  if (!env.ADMIN_PASSWORD) warnings.push('ADMIN_PASSWORD pusty - podgląd zamówień /api/admin/* wyłączony');
  if (env.SANDBOX !== '1' && [env.MOCK_PAYMENTS, env.MOCK_INPOST].some(flag)) warnings.push('Tryb produkcyjny z adapterami MOCK - sprawdź zmienne środowiska');

  return { passed: errors.length === 0, errors, warnings };
}
