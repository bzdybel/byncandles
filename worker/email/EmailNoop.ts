/** E-maile „na niby” (MOCK_EMAIL=1): treść ląduje w logach zamiast w skrzynce. */
import { LogKey } from '../constants/logKeys.ts';
import type { LoggerPort } from '../utils/logger.ts';
import type { EmailMessage, EmailProvider } from './EmailProvider.ts';

export class EmailNoop implements EmailProvider {
  readonly name = 'noop';
  readonly sent: EmailMessage[] = [];
  private readonly logger?: LoggerPort;
  constructor(logger?: LoggerPort) {
    this.logger = logger;
  }

  async send(m: EmailMessage) {
    this.sent.push(m);
    this.logger?.info({ message: 'Email (noop)', metadata: { [LogKey.TO]: m.to, subject: m.subject, text: m.text } });
    return { messageId: `noop-${this.sent.length}` };
  }
}
