import { Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { companies } from '../db/schema';
import { CompanySettings, resolveSettings } from './settings';

@Injectable()
export class CompanySettingsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async get(companyId: string): Promise<CompanySettings> {
    const [row] = await this.db.select({ settings: companies.settings }).from(companies).where(eq(companies.id, companyId));
    if (!row) throw new NotFoundException('Company not found');
    return resolveSettings(row.settings);
  }
}
