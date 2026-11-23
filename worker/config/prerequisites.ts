/**
 * Sprawdzenie konfiguracji (wzorzec Prerequisites): błędy = sklep nie przyjmuje zamówień (503, zamiast
 * przyjmować je bez płatności), ostrzeżenia = działa, ale bez części automatyzacji. Wynik idzie do logów.
 */
import { MIN_ADMIN_PASSWORD, type AppConfig } from './appConfig.ts';

export interface PrerequisiteResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export function checkPrerequisites(c: AppConfig): PrerequisiteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const issue of c.issues) warnings.push(`Niepoprawna wartość - zignorowana: ${issue}`);
  if (c.payments.kind === 'missing') errors.push(`Przelewy24: brak ${c.payments.missing.join(', ')}`);
  if (c.payments.kind === 'noop') warnings.push('MOCK_PAYMENTS=1 - płatności symulowane, nikt nie zapłaci naprawdę');

  if (c.shipping.kind === 'noop') warnings.push('MOCK_INPOST=1 - przesyłki symulowane');
  if (c.shipping.kind === 'disabled') warnings.push('ShipX nieskonfigurowany - przesyłki trzeba zakładać ręcznie w Managerze Paczek');

  if (c.email.kind === 'noop') warnings.push('MOCK_EMAIL=1 - e-maile tylko w logach');
  if (c.email.kind === 'disabled') warnings.push('Resend nieskonfigurowany - brak e-maili z potwierdzeniem (wymagane prawem: potwierdzenie umowy na trwałym nośniku)');
  if (!c.shopEmail) warnings.push('SHOP_EMAIL pusty - sklep nie dostanie powiadomień o zamówieniach');
  if (!c.adminPassword) warnings.push('ADMIN_PASSWORD pusty - podgląd zamówień /api/admin/* wyłączony');
  else if (c.adminPassword.length < MIN_ADMIN_PASSWORD) warnings.push(`ADMIN_PASSWORD krótsze niż ${MIN_ADMIN_PASSWORD} znaków - łatwe do zgadnięcia`);

  if (!c.turnstileSecret) warnings.push('TURNSTILE_SECRET pusty - boty zmieniające IP mogą blokować sztuki nieopłaconymi zamówieniami');

  return { passed: errors.length === 0, errors, warnings };
}
