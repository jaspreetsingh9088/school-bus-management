import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AuthUser } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import {
  buses, invoices, parents, parentStudents, payments, routes, schools, studentAssignments, students, users,
} from '../db/schema';

export type FeeStatus = 'PAID' | 'PARTLY_PAID' | 'PENDING' | 'OVERDUE';

export interface FeeRow {
  invoiceId: string;
  studentId: string;
  name: string;
  className: string | null;
  section: string | null;
  school: string;
  bus: string | null;
  route: string | null;
  parent: string | null;
  parentPhone: string | null;
  feeRupees: number;
  paidRupees: number;
  dueRupees: number;
  dueDate: string;
  status: FeeStatus;
  paidOn: string | null;
  method: string | null;
}

const rupees = (paise: number) => Math.round(paise) / 100;

/** "2026-11" → first day, last day and due date (10th) of that month. */
export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('Use month=YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}`, due: `${month}-10` };
}

function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function statusOf(inv: { total: number; paid: number; dueDate: string }, today: string): FeeStatus {
  if (inv.paid >= inv.total) return 'PAID';
  if (inv.paid > 0) return 'PARTLY_PAID';
  return inv.dueDate < today ? 'OVERDUE' : 'PENDING';
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

/**
 * Monthly transport fees. Each student with a monthly fee gets one bill per month, created
 * automatically. Staff mark bills paid (cash, UPI, bank) or back to pending.
 */
@Injectable()
export class FeesService {
  private readonly ensured = new Map<string, number>();

  constructor(@InjectDb() private readonly db: Db, private readonly settings: CompanySettingsService) {}

  async currentMonth(companyId: string) {
    const cfg = await this.settings.get(companyId);
    const today = zoned(new Date(), cfg.timezone).date;
    return { month: today.slice(0, 7), today };
  }

  /** Creates this month's bills for every student with a fee. Unpaid bills follow fee changes. */
  async ensureInvoices(companyId: string, month: string, force = false) {
    const { start, end, due } = monthRange(month);
    const { month: now } = await this.currentMonth(companyId);
    if (month > addMonths(now, 1)) return;
    const key = `${companyId}:${month}`;
    if (!force && (this.ensured.get(key) ?? 0) > Date.now()) return;
    this.ensured.set(key, Date.now() + 2 * 60_000);

    const payers = await this.db.select().from(students).where(and(
      eq(students.companyId, companyId), isNull(students.deletedAt), eq(students.status, 'ACTIVE'), gt(students.monthlyFeePaise, 0),
      or(isNull(students.serviceStart), lte(students.serviceStart, end)),
      or(isNull(students.serviceEnd), gte(students.serviceEnd, start)),
    ));
    if (!payers.length) return;
    await this.db.insert(invoices).values(payers.map((s) => ({
      companyId, studentId: s.id, number: `TF-${month.replace('-', '')}-${s.id.slice(0, 8).toUpperCase()}`,
      periodStart: start, periodEnd: end, dueDate: due, subtotal: s.monthlyFeePaise!, total: s.monthlyFeePaise!,
    }))).onConflictDoNothing();
    // A changed fee updates this month's bills that nobody has paid yet.
    for (const s of payers) {
      await this.db.update(invoices).set({ subtotal: s.monthlyFeePaise!, total: s.monthlyFeePaise! }).where(and(
        eq(invoices.studentId, s.id), eq(invoices.periodStart, start), eq(invoices.paid, 0),
      ));
    }
  }

  forget(companyId: string) {
    for (const key of this.ensured.keys()) if (key.startsWith(`${companyId}:`)) this.ensured.delete(key);
  }

  /** Everything the Fees page shows for one month. */
  async monthView(companyId: string, month: string) {
    await this.ensureInvoices(companyId, month);
    const { start } = monthRange(month);
    const { today } = await this.currentMonth(companyId);

    const bills = await this.db
      .select({ inv: invoices, s: students, school: schools.name })
      .from(invoices)
      .innerJoin(students, eq(students.id, invoices.studentId))
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(and(eq(invoices.companyId, companyId), eq(invoices.periodStart, start), isNull(students.deletedAt)))
      .orderBy(asc(students.className), asc(students.name));
    const ids = bills.map((b) => b.s.id);

    const transport = ids.length
      ? await this.db.select({ studentId: studentAssignments.studentId, route: routes.name, bus: buses.registrationNumber, direction: studentAssignments.direction })
        .from(studentAssignments).innerJoin(routes, eq(routes.id, studentAssignments.routeId)).leftJoin(buses, eq(buses.id, routes.busId))
        .where(inArray(studentAssignments.studentId, ids))
      : [];
    const family = ids.length
      ? await this.db.select({ studentId: parentStudents.studentId, name: users.name, phone: users.phone })
        .from(parentStudents).innerJoin(parents, eq(parents.id, parentStudents.parentId)).innerJoin(users, eq(users.id, parents.userId))
        .where(and(inArray(parentStudents.studentId, ids), isNull(users.deletedAt)))
      : [];
    const pays = bills.length
      ? await this.db.select().from(payments).where(inArray(payments.invoiceId, bills.map((b) => b.inv.id))).orderBy(desc(payments.paidAt))
      : [];

    const rows: FeeRow[] = bills.map(({ inv, s, school }) => {
      const t = transport.find((x) => x.studentId === s.id && x.direction === 'MORNING') ?? transport.find((x) => x.studentId === s.id);
      const p = family.find((x) => x.studentId === s.id);
      const last = pays.find((x) => x.invoiceId === inv.id);
      return {
        invoiceId: inv.id, studentId: s.id, name: s.name, className: s.className, section: s.section, school,
        bus: t?.bus ?? null, route: t?.route ?? null, parent: p?.name ?? null, parentPhone: p?.phone ?? null,
        feeRupees: rupees(inv.total), paidRupees: rupees(inv.paid), dueRupees: rupees(Math.max(0, inv.total - inv.paid)),
        dueDate: inv.dueDate, status: statusOf(inv, today),
        paidOn: last?.paidAt ? zoned(last.paidAt, 'Asia/Kolkata').date : null, method: last?.method ?? null,
      };
    });

    const sum = (list: FeeRow[]) => ({
      students: list.length,
      fee: list.reduce((a, r) => a + r.feeRupees, 0),
      collected: list.reduce((a, r) => a + r.paidRupees, 0),
      pending: list.reduce((a, r) => a + r.dueRupees, 0),
      paidCount: list.filter((r) => r.status === 'PAID').length,
      overdueCount: list.filter((r) => r.status === 'OVERDUE').length,
    });
    const groupBy = (key: (r: FeeRow) => string) => {
      const groups: Record<string, FeeRow[]> = {};
      for (const r of rows) (groups[key(r)] ??= []).push(r);
      return Object.entries(groups).map(([name, list]) => ({ name, ...sum(list) })).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    };

    // Six-month chart: what was billed and what came in, per month.
    const from = monthRange(addMonths(month, -5)).start;
    const history = await this.db
      .select({ period: invoices.periodStart, total: sql<number>`sum(${invoices.total})::int`, paid: sql<number>`sum(${invoices.paid})::int` })
      .from(invoices)
      .where(and(eq(invoices.companyId, companyId), gte(invoices.periodStart, from), lte(invoices.periodStart, start)))
      .groupBy(invoices.periodStart);
    const chart = [...Array(6).keys()].map((i) => {
      const m = addMonths(month, i - 5);
      const h = history.find((x) => x.period.startsWith(m));
      return { month: m, billed: rupees(h?.total ?? 0), collected: rupees(h?.paid ?? 0) };
    });

    return {
      month,
      totals: sum(rows),
      rows,
      byClass: groupBy((r) => (r.className ? `Class ${r.className}${r.section ? ` ${r.section}` : ''}` : 'No class')),
      byBus: groupBy((r) => r.bus ?? 'No bus'),
      chart,
    };
  }

  private async invoiceOf(companyId: string, id: string) {
    const [inv] = await this.db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.companyId, companyId)));
    if (!inv) throw new NotFoundException('Bill not found');
    return inv;
  }

  /** Records a payment. Without an amount, the full remaining amount is paid. */
  async markPaid(companyId: string, invoiceId: string, user: AuthUser, dto: { amount?: number; method?: string; reference?: string; paidOn?: string }) {
    const inv = await this.invoiceOf(companyId, invoiceId);
    const remaining = inv.total - inv.paid;
    if (remaining <= 0) throw new BadRequestException('This bill is already paid');
    const amount = dto.amount !== undefined ? Math.round(dto.amount * 100) : remaining;
    if (amount <= 0 || amount > remaining) throw new BadRequestException(`Amount must be between ₹1 and ₹${rupees(remaining)}`);
    await this.db.transaction(async (tx) => {
      await tx.insert(payments).values({
        companyId, invoiceId, studentId: inv.studentId, amountPaise: amount, method: dto.method ?? 'CASH', reference: dto.reference,
        status: 'PAID', paidAt: dto.paidOn ? new Date(`${dto.paidOn}T12:00:00+05:30`) : new Date(), recordedById: user.sub,
      });
      const paid = inv.paid + amount;
      await tx.update(invoices).set({ paid, status: paid >= inv.total ? 'PAID' : 'PARTIALLY_PAID' }).where(eq(invoices.id, invoiceId));
    });
    return { paidRupees: rupees(inv.paid + amount), totalRupees: rupees(inv.total) };
  }

  /** Undo: removes the bill's payments so it is pending again. */
  async markPending(companyId: string, invoiceId: string) {
    await this.invoiceOf(companyId, invoiceId);
    await this.db.transaction(async (tx) => {
      await tx.delete(payments).where(eq(payments.invoiceId, invoiceId));
      await tx.update(invoices).set({ paid: 0, status: 'ISSUED' }).where(eq(invoices.id, invoiceId));
    });
    return { pending: true };
  }

  /** Sets the monthly fee for many students at once (by class, school, route or a list). */
  async setFees(companyId: string, dto: { amount: number; studentIds?: string[]; schoolId?: string; className?: string; routeId?: string }) {
    const paise = Math.round(dto.amount * 100);
    let ids: string[] | undefined = dto.studentIds;
    if (dto.routeId) {
      ids = (await this.db.select({ id: studentAssignments.studentId }).from(studentAssignments)
        .innerJoin(routes, eq(routes.id, studentAssignments.routeId))
        .where(and(eq(routes.id, dto.routeId), eq(routes.companyId, companyId)))).map((r) => r.id);
    }
    const where = and(
      eq(students.companyId, companyId), isNull(students.deletedAt),
      ids ? inArray(students.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']) : undefined,
      dto.schoolId ? eq(students.schoolId, dto.schoolId) : undefined,
      dto.className ? eq(students.className, dto.className) : undefined,
    );
    const updated = await this.db.update(students).set({ monthlyFeePaise: paise > 0 ? paise : null }).where(where).returning({ id: students.id });
    this.forget(companyId);
    return { updated: updated.length };
  }

  async studentFees(companyId: string, studentId: string) {
    const { today, month } = await this.currentMonth(companyId);
    await this.ensureInvoices(companyId, month);
    const bills = await this.db.select().from(invoices)
      .where(and(eq(invoices.companyId, companyId), eq(invoices.studentId, studentId))).orderBy(desc(invoices.periodStart)).limit(24);
    const pays = bills.length ? await this.db.select().from(payments).where(inArray(payments.invoiceId, bills.map((b) => b.id))) : [];
    return bills.map((b) => ({
      invoiceId: b.id, number: b.number, month: b.periodStart.slice(0, 7), feeRupees: rupees(b.total), paidRupees: rupees(b.paid),
      dueRupees: rupees(Math.max(0, b.total - b.paid)), dueDate: b.dueDate, status: statusOf(b, today),
      payments: pays.filter((p) => p.invoiceId === b.id).map((p) => ({ amountRupees: rupees(p.amountPaise), method: p.method, reference: p.reference, paidAt: p.paidAt })),
    }));
  }

  /** This month's bill for each of a parent's children (shown in the app). */
  async currentForStudents(companyId: string, studentIds: string[]) {
    if (!studentIds.length) return [];
    const { month, today } = await this.currentMonth(companyId);
    await this.ensureInvoices(companyId, month);
    const rows = await this.db.select().from(invoices)
      .where(and(inArray(invoices.studentId, studentIds), eq(invoices.periodStart, monthRange(month).start)));
    return rows.map((b) => ({ studentId: b.studentId, month, feeRupees: rupees(b.total), dueRupees: rupees(Math.max(0, b.total - b.paid)), dueDate: b.dueDate, status: statusOf(b, today) }));
  }

  // ───────────── CSV downloads ─────────────

  async feesCsv(companyId: string, month: string, by: 'student' | 'class' | 'bus') {
    const v = await this.monthView(companyId, month);
    if (by === 'student') {
      return toCsv(
        ['Student', 'Class', 'Section', 'School', 'Bus', 'Route', 'Parent', 'Parent phone', 'Month', 'Fee (₹)', 'Paid (₹)', 'Pending (₹)', 'Status', 'Paid on', 'Method'],
        v.rows.map((r) => [r.name, r.className, r.section, r.school, r.bus, r.route, r.parent, r.parentPhone, month, r.feeRupees, r.paidRupees, r.dueRupees, r.status, r.paidOn, r.method]),
      );
    }
    const groups = by === 'class' ? v.byClass : v.byBus;
    return toCsv(
      [by === 'class' ? 'Class' : 'Bus', 'Month', 'Students', 'Fee (₹)', 'Collected (₹)', 'Pending (₹)', 'Fully paid', 'Overdue'],
      [...groups.map((g) => [g.name, month, g.students, g.fee, g.collected, g.pending, g.paidCount, g.overdueCount]),
        ['TOTAL', month, v.totals.students, v.totals.fee, v.totals.collected, v.totals.pending, v.totals.paidCount, v.totals.overdueCount]],
    );
  }

  async studentsCsv(companyId: string) {
    const list = await this.db.select({ s: students, school: schools.name }).from(students)
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(and(eq(students.companyId, companyId), isNull(students.deletedAt))).orderBy(asc(students.className), asc(students.name));
    const ids = list.map((l) => l.s.id);
    const transport = ids.length
      ? await this.db.select({ studentId: studentAssignments.studentId, direction: studentAssignments.direction, route: routes.name, bus: buses.registrationNumber })
        .from(studentAssignments).innerJoin(routes, eq(routes.id, studentAssignments.routeId)).leftJoin(buses, eq(buses.id, routes.busId))
        .where(inArray(studentAssignments.studentId, ids))
      : [];
    const family = ids.length
      ? await this.db.select({ studentId: parentStudents.studentId, name: users.name, phone: users.phone })
        .from(parentStudents).innerJoin(parents, eq(parents.id, parentStudents.parentId)).innerJoin(users, eq(users.id, parents.userId))
        .where(and(inArray(parentStudents.studentId, ids), isNull(users.deletedAt)))
      : [];
    return toCsv(
      ['Student', 'Class', 'Section', 'Student ID', 'School', 'Status', 'Morning route', 'Afternoon route', 'Bus', 'Parent', 'Parent phone', 'Emergency phone', 'Monthly fee (₹)', 'Parent code'],
      list.map(({ s, school }) => {
        const am = transport.find((t) => t.studentId === s.id && t.direction === 'MORNING');
        const pm = transport.find((t) => t.studentId === s.id && t.direction === 'AFTERNOON');
        const p = family.filter((f) => f.studentId === s.id);
        return [s.name, s.className, s.section, s.registrationNumber, school, s.status, am?.route, pm?.route, am?.bus ?? pm?.bus,
          p.map((x) => x.name).join(' / '), p.map((x) => x.phone).join(' / '), s.emergencyContactPhone,
          s.monthlyFeePaise ? rupees(s.monthlyFeePaise) : '', s.activationCode];
      }),
    );
  }
}
