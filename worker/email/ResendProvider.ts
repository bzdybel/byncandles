/** Resend (https://resend.com/docs/api-reference/emails/send-email) - nadawca musi być w zweryfikowanej domenie. */
import * as z from 'zod/mini';
import { callProvider, defaultFetch, expectResponse } from '../utils/providerHttp.ts';
import type { EmailMessage, EmailProvider } from './EmailProvider.ts';

const sendResponse = z.object({ id: z.string().check(z.minLength(1)) });

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly cfg: { apiKey: string; from: string };
  private readonly fetchFn: typeof fetch;

  constructor(cfg: { apiKey: string; from: string }, fetchFn: typeof fetch = defaultFetch) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  async send(m: EmailMessage): Promise<{ messageId: string }> {
    const res = await callProvider(
      this.name,
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo && { reply_to: m.replyTo }) }),
      },
      this.fetchFn,
    );
    return { messageId: expectResponse(this.name, 'send', res, sendResponse).id };
  }
}
