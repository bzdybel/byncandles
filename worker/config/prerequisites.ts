/**
 * Sprawdzenie konfiguracji (wzorzec Prerequisites): błędy = sklep nie przyjmuje zamówień (503, zamiast
 * przyjmować je bez płatności), ostrzeżenia = działa, ale bez części automatyzacji. Wynik idzie do logów.
 */
import type { AppConfig } from './appConfig.ts';

export interface PrerequisiteResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function checkPrerequisites(c: AppConfig): PrerequisiteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (c.payments.kind === 'missing') errors.push(`Przelewy24: brak ${c.payments.missing.join(', ')}`);
  if (c.payments.kind === 'noop') warnings.push('MOCK_PAYMENTS=1 - płatności symulowane, nikt nie zapłaci naprawdę');

  if (c.shipping.kind === 'noop') warnings.push('MOCK_INPOST=1 - przesyłki symulowane');
  if (c.shipping.kind === 'disabled') warnings.push('ShipX nieskonfigurowany - przesyłki trzeba zakładać ręcznie w Managerze Paczek');

  if (c.email.kind === 'noop') warnings.push('MOCK_EMAIL=1 - e-maile tylko w logach');
  if (c.email.kind === 'disabled') warnings.push('Resend nieskonfigurowany - brak e-maili z potwierdzeniem (wymagane prawem: potwierdzenie umowy na trwałym nośniku)');
  if (!c.shopEmail) warnings.push('SHOP_EMAIL pusty - sklep nie dostanie powiadomień o zamówieniach');
  if (!c.adminPassword) warnings.push('ADMIN_PASSWORD pusty - podgląd zamówień /api/admin/* wyłączony');

  const mocks = [c.payments, c.shipping, c.email].some((p) => p.kind === 'noop');
  if (!c.sandbox && mocks) warnings.push('Tryb produkcyjny (SANDBOX≠1) z adapterami MOCK - sprawdź zmienne środowiska');

  return { passed: errors.length === 0, errors, warnings };
}
