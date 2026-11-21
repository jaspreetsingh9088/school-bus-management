import { Controller, Get, Headers, UnauthorizedException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Public } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import { companies } from '../db/schema';
import { FeesService } from '../fees/fees.service';
import { TripsService } from './trips.service';

/**
 * Daily job: creates today's and tomorrow's trips for every company.
 * Vercel Cron calls it with "Authorization: Bearer <CRON_SECRET>".
 */
@Controller('cron')
export class CronController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly trips: TripsService,
    private readonly settings: CompanySettingsService,
    private readonly fees: FeesService,
  ) {}

  @Public() @Get('daily')
  async daily(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) throw new UnauthorizedException();
    const active = await this.db.select({ id: companies.id }).from(companies).where(eq(companies.active, true));
    const out: Record<string, unknown> = {};
    for (const c of active) {
      const tz = (await this.settings.get(c.id)).timezone;
      const today = zoned(new Date(), tz).date;
      const tomorrow = zoned(new Date(Date.now() + 86_400_000), tz).date;
      await this.fees.ensureInvoices(c.id, today.slice(0, 7), true);
      out[c.id] = {
        [today]: await this.trips.generateForDate(c.id, today),
        [tomorrow]: await this.trips.generateForDate(c.id, tomorrow),
      };
    }
    return out;
  }
}
