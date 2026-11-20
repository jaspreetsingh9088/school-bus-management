import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { devices, notifications, parents, parentStudents, users } from '../db/schema';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PushProvider, SmsProvider } from './providers';

export interface NotifyInput {
  companyId: string;
  userIds: string[];
  type: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  /** Safety alerts can't be muted and are always pushed (spec 8) */
  safety?: boolean;
  /** Also send an SMS (held child, no-show, SOS) */
  sms?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly push: PushProvider,
    private readonly sms: SmsProvider,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Stores, pushes, texts and emits a message to each user. Never throws: a failed alert must not undo a boarding record. */
  async notify(input: NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (!userIds.length) return;
    try {
      const rows = await this.db
        .insert(notifications)
        .values(userIds.map((userId) => ({
          companyId: input.companyId, userId, type: input.type, title: input.title, body: input.body,
          data: input.data ?? {}, safety: input.safety ?? false,
        })))
        .returning();

      const tokens = await this.db.select().from(devices).where(inArray(devices.userId, userIds));
      await this.push.send(tokens.map((d) => d.pushToken), input.title, input.body, { type: input.type, ...input.data });

      if (input.sms) {
        const recipients = await this.db.select({ phone: users.phone }).from(users).where(inArray(users.id, userIds));
        await Promise.all(recipients.map((r) => this.sms.send(r.phone, `${input.title}. ${input.body}`)));
      }

      for (const row of rows) this.realtime.toUser(row.userId, 'notification', row);
      await this.db.update(notifications).set({ status: 'SENT', sentAt: new Date() })
        .where(inArray(notifications.id, rows.map((r) => r.id)));
    } catch (err) {
      this.log.error(`Notification "${input.type}" failed: ${(err as Error).message}`);
    }
  }

  /** User ids of every parent linked to these students. */
  async parentUserIds(studentIds: string[]): Promise<string[]> {
    if (!studentIds.length) return [];
    const rows = await this.db
      .select({ userId: parents.userId })
      .from(parentStudents)
      .innerJoin(parents, eq(parents.id, parentStudents.parentId))
      .where(inArray(parentStudents.studentId, studentIds));
    return rows.map((r) => r.userId);
  }

  /** User ids of the company's admins and office staff. */
  async adminUserIds(companyId: string): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.companyId, companyId), eq(users.active, true), inArray(users.role, ['COMPANY_ADMIN', 'OFFICE_STAFF'])));
    return rows.map((r) => r.id);
  }
}
