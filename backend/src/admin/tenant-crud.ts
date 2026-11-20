import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Db } from '../db/db.module';

type TenantTable = PgTable & { id: PgColumn; companyId: PgColumn };

/** Basic list / get / create / update / delete for a table, always filtered by company. */
export class TenantCrud<T extends TenantTable> {
  constructor(private readonly db: Db, private readonly table: T, private readonly label: string) {}

  /** Live records only: archived ones (deletedAt set) are hidden. */
  list(companyId: string, extra?: SQL) {
    const deletedAt = (this.table as unknown as { deletedAt?: PgColumn }).deletedAt;
    const where = and(eq(this.table.companyId, companyId), extra, deletedAt ? isNull(deletedAt) : undefined);
    return this.db.select().from(this.table as PgTable).where(where).orderBy(desc(this.table.id)) as Promise<T['$inferSelect'][]>;
  }

  async get(companyId: string, id: string): Promise<T['$inferSelect']> {
    const [row] = await this.db.select().from(this.table as PgTable)
      .where(and(eq(this.table.id, id), eq(this.table.companyId, companyId)));
    if (!row) throw new NotFoundException(`${this.label} not found`);
    return row as T['$inferSelect'];
  }

  async create(companyId: string, values: Record<string, unknown>): Promise<T['$inferSelect']> {
    try {
      const [row] = await this.db.insert(this.table).values({ ...values, companyId } as T['$inferInsert']).returning();
      return row as T['$inferSelect'];
    } catch (e) {
      throw uniqueToConflict(e, this.label);
    }
  }

  async update(companyId: string, id: string, values: Record<string, unknown>): Promise<T['$inferSelect']> {
    const { companyId: _ignored, id: _id, ...safe } = values;
    if (!Object.keys(safe).length) return this.get(companyId, id);
    try {
      const rows = (await this.db.update(this.table as PgTable).set(safe)
        .where(and(eq(this.table.id, id), eq(this.table.companyId, companyId))).returning()) as T['$inferSelect'][];
      const row = rows[0];
      if (!row) throw new NotFoundException(`${this.label} not found`);
      return row as T['$inferSelect'];
    } catch (e) {
      throw uniqueToConflict(e, this.label);
    }
  }

  async remove(companyId: string, id: string) {
    try {
      const rows = await this.db.delete(this.table).where(and(eq(this.table.id, id), eq(this.table.companyId, companyId))).returning();
      if (!rows.length) throw new NotFoundException(`${this.label} not found`);
      return { deleted: true };
    } catch (e) {
      const err = e as { code?: string; cause?: { code?: string } };
      if (err.code === '23503' || err.cause?.code === '23503') {
        throw new ConflictException(`${this.label} is in use. Deactivate it instead.`);
      }
      throw e;
    }
  }
}

export function uniqueToConflict(e: unknown, label: string): unknown {
  const err = e as { code?: string; cause?: { code?: string } };
  if (err.code === '23505' || err.cause?.code === '23505') return new ConflictException(`${label} already exists`);
  return e;
}
