/** E-maile „na niby” (MOCK_EMAIL=1): temat w logach zamiast w skrzynce (bez treści - dane osobowe). */
import type { LoggerPort } from '../utils/logger.ts';
import type { EmailMessage, EmailProvider } from './EmailProvider.ts';

export class EmailNoop implements EmailProvider {
  readonly name = 'noop';
  private readonly logger: LoggerPort;
  private count = 0;
  constructor(logger: LoggerPort) {
    this.logger = logger;
  }

  async send(m: EmailMessage) {
    this.logger.info({ message: 'Email (noop)', metadata: { subject: m.subject } });
    return { messageId: `noop-${++this.count}` };
  }
}
