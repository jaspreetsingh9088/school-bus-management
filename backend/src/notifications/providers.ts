import { Injectable, Logger } from '@nestjs/common';

/**
 * Outside-service adapters. v1 ships console versions so the system runs end to end
 * without accounts; swap in MSG91/Twilio (DLT-registered templates) and Firebase
 * Cloud Messaging by providing another class for the same token.
 */
export abstract class SmsProvider {
  abstract send(phone: string, text: string): Promise<void>;
}

export abstract class PushProvider {
  abstract send(tokens: string[], title: string, body: string, data: Record<string, string>): Promise<void>;
}

export interface SentMessage {
  to: string | string[];
  text: string;
  at: Date;
}

@Injectable()
export class ConsoleSmsProvider extends SmsProvider {
  private readonly log = new Logger('SMS');
  /** Kept in memory so tests and local demos can read the OTP. */
  readonly sent: SentMessage[] = [];

  async send(phone: string, text: string) {
    this.sent.push({ to: phone, text, at: new Date() });
    if (process.env.NODE_ENV !== 'test') this.log.log(`→ ${phone}: ${text}`);
  }
}

@Injectable()
export class ConsolePushProvider extends PushProvider {
  private readonly log = new Logger('Push');
  readonly sent: SentMessage[] = [];

  async send(tokens: string[], title: string, body: string) {
    if (!tokens.length) return;
    this.sent.push({ to: tokens, text: `${title}: ${body}`, at: new Date() });
    if (process.env.NODE_ENV !== 'test') this.log.log(`→ ${tokens.length} device(s): ${title} — ${body}`);
  }
}
