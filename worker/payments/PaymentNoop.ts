/**
 * Płatności „na niby” do lokalnego rozwoju (MOCK_PAYMENTS=1): zamiast bramki P24 klient trafia na
 * /api/dev/payments/:id/complete, który wysyła powiadomienie tą samą ścieżką co prawdziwe P24
 * (webhook → zapis w webhook_events → opłacenie → przesyłka → e-maile).
 */
import type { ParsedNotification, PaymentNotification, PaymentProvider, ProviderPaymentState, RegisterPaymentInput } from './PaymentProvider.ts';

export const DEV_PAYMENT_PATH = '/api/dev/payments/';

export class PaymentNoop implements PaymentProvider {
  readonly name = 'noop';
  private readonly origin: string;
  constructor(origin: string) {
    this.origin = origin;
  }

  async register(input: RegisterPaymentInput) {
    return { redirectUrl: `${this.origin}${DEV_PAYMENT_PATH}${input.sessionId}/complete` };
  }

  async parseNotification(rawBody: string): Promise<ParsedNotification> {
    try {
      const n = JSON.parse(rawBody) as PaymentNotification;
      return { valid: true, notification: n };
    } catch {
      return { valid: false, reason: 'invalid_json' };
    }
  }

  async verify(_n: PaymentNotification) {}

  async status(_sessionId: string): Promise<ProviderPaymentState> {
    return { state: 'unpaid', providerStatus: 'noop' };
  }
}
