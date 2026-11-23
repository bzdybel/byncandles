/** Port płatności: Przelewy24 na produkcji/sandboxie, noop lokalnie (MOCK_PAYMENTS=1). */

export interface RegisterPaymentInput {
  sessionId: string;
  amount: number; // grosze
  description: string;
  email: string;
  client: string;
  phone: string;
  urlReturn: string;
  urlStatus: string;
}

/** Powiadomienie o wpłacie po sprawdzeniu podpisu, w formie niezależnej od dostawcy. */
export interface PaymentNotification {
  sessionId: string;
  reference: string; // orderId transakcji u dostawcy
  amount: number;
  currency: string;
}

export type ParsedNotification =
  | { valid: true; notification: PaymentNotification }
  | { valid: false; reason: string; sessionId?: string; reference?: string };

export type ProviderPaymentState =
  | { state: 'unpaid'; providerStatus: unknown }
  | { state: 'paid_unverified' | 'paid'; reference: string; amount: number; providerStatus: unknown };

export interface PaymentProvider {
  readonly name: string;
  /** Zwraca adres, na który przekierowujemy klienta. */
  register(input: RegisterPaymentInput): Promise<{ redirectUrl: string }>;
  /** Sprawdza podpis surowego powiadomienia - bez tego każdy mógłby „opłacić” zamówienie. */
  parseNotification(rawBody: string): Promise<ParsedNotification>;
  /** Potwierdza transakcję u dostawcy - dopiero wtedy pieniądze są zaksięgowane. */
  verify(n: PaymentNotification): Promise<void>;
  /** Stan transakcji u dostawcy - zadanie cykliczne łapie zgubione powiadomienia. */
  status(sessionId: string): Promise<ProviderPaymentState>;
}
