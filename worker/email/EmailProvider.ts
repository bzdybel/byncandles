/** Port e-maili: Resend lub noop (MOCK_EMAIL=1 - treść tylko w logach). */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ messageId: string }>;
}
