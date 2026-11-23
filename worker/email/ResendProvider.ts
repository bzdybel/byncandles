/** Resend (https://resend.com/docs/api-reference/emails/send-email) - nadawca musi być w zweryfikowanej domenie. */
import { ProviderError } from '../errors/AppError.ts';
import type { EmailMessage, EmailProvider } from './EmailProvider.ts';

export class ResendProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly cfg: { apiKey: string; from: string };
  private readonly fetchFn: typeof fetch;

  constructor(cfg: { apiKey: string; from: string }, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.cfg = cfg;
    this.fetchFn = fetchFn;
  }

  async send(m: EmailMessage): Promise<{ messageId: string }> {
    let res: Response;
    try {
      res = await this.fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({ from: this.cfg.from, to: [m.to], subject: m.subject, text: m.text, ...(m.replyTo && { reply_to: m.replyTo }) }),
      });
    } catch (e) {
      throw new ProviderError(this.name, 'network error', { cause: String(e) });
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !json.id) throw new ProviderError(this.name, `HTTP ${res.status} ${json.name ?? ''} ${json.message ?? ''}`.trim(), { response: json });
    return { messageId: json.id };
  }
}
