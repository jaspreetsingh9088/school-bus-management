import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AuthUser, tenantOf } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { hhmmToMinutes, zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import {
  absences, authorizedAdults, buses, consents, Direction, notifications, parents, parentStudents, routes, routeStops,
  schools, stops, studentAssignments, students, trips, tripStudents, users,
} from '../db/schema';
import { FeesService } from '../fees/fees.service';
import { TripsService } from '../trips/trips.service';

export const CONSENT_VERSION = '2026-11';

@Injectable()
export class ParentService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: CompanySettingsService,
    private readonly tripsService: TripsService,
    private readonly fees: FeesService,
  ) {}

  async parentOf(user: AuthUser) {
    const [row] = await this.db.select().from(parents)
      .where(and(eq(parents.userId, user.sub), eq(parents.companyId, tenantOf(user))));
    if (!row) throw new ForbiddenException('Parent account not found');
    return row;
  }

  private async assertLinked(parentId: string, studentId: string) {
    const [link] = await this.db.select().from(parentStudents)
      .where(and(eq(parentStudents.parentId, parentId), eq(parentStudents.studentId, studentId)));
    if (!link) throw new NotFoundException('Child not found');
  }

  private async hasChildDataConsent(parentId: string) {
    const [c] = await this.db.select({ id: consents.id }).from(consents).where(and(
      eq(consents.parentId, parentId), eq(consents.type, 'CHILD_DATA'), eq(consents.version, CONSENT_VERSION), isNull(consents.revokedAt),
    ));
    return !!c;
  }

  async me(user: AuthUser) {
    const parent = await this.parentOf(user);
    const [u] = await this.db.select({ name: users.name, phone: users.phone, email: users.email }).from(users).where(eq(users.id, user.sub));
    return { ...u, parentId: parent.id, address: parent.address, consentGiven: await this.hasChildDataConsent(parent.id), consentVersion: CONSENT_VERSION };
  }

  /** DPDP: consent from an OTP-verified parent before any child data is added (Requirements v2, 12.1). */
  async giveConsent(user: AuthUser, version: string) {
    if (version !== CONSENT_VERSION) throw new BadRequestException('Please accept the latest privacy notice');
    const parent = await this.parentOf(user);
    if (!(await this.hasChildDataConsent(parent.id))) {
      await this.db.insert(consents).values({
        companyId: parent.companyId, parentId: parent.id, type: 'CHILD_DATA', version, method: 'OTP_VERIFIED_MOBILE',
      });
    }
    return { consentGiven: true };
  }

  private async requireConsent(parentId: string) {
    if (!(await this.hasChildDataConsent(parentId))) throw new ForbiddenException('Accept the privacy notice first');
  }

  async children(user: AuthUser) {
    const parent = await this.parentOf(user);
    const kids = await this.db
      .select({ student: students, schoolName: schools.name })
      .from(parentStudents)
      .innerJoin(students, eq(students.id, parentStudents.studentId))
      .innerJoin(schools, eq(schools.id, students.schoolId))
      .where(eq(parentStudents.parentId, parent.id));
    if (!kids.length) return [];
    const ids = kids.map((k) => k.student.id);
    const plan = await this.db
      .select({
        studentId: studentAssignments.studentId, direction: studentAssignments.direction, routeName: routes.name,
        stopName: stops.name, time: routeStops.scheduledTime, busNumber: buses.registrationNumber, driverName: users.name,
      })
      .from(studentAssignments)
      .innerJoin(routes, eq(routes.id, studentAssignments.routeId))
      .innerJoin(routeStops, eq(routeStops.id, studentAssignments.routeStopId))
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .leftJoin(buses, eq(buses.id, routes.busId))
      .leftJoin(users, eq(users.id, routes.driverId))
      .where(inArray(studentAssignments.studentId, ids));
    const bills = await this.fees.currentForStudents(parent.companyId, ids);
    return kids.map(({ student, schoolName }) => ({
      studentId: student.id, name: student.name, photoUrl: student.photoUrl, school: schoolName,
      className: student.className, section: student.section, status: student.status, mayGoHomeAlone: student.mayGoHomeAlone,
      morning: plan.find((p) => p.studentId === student.id && p.direction === 'MORNING') ?? null,
      afternoon: plan.find((p) => p.studentId === student.id && p.direction === 'AFTERNOON') ?? null,
      fee: bills.find((b) => b.studentId === student.id) ?? null,
    }));
  }

  /** Child added by a parent waits for company approval before any transport is assigned. */
  async addChild(user: AuthUser, dto: { schoolId: string; name: string; className?: string; section?: string; registrationNumber?: string; homeAddress?: string; photoUrl?: string }) {
    const parent = await this.parentOf(user);
    await this.requireConsent(parent.id);
    const [school] = await this.db.select().from(schools).where(and(eq(schools.id, dto.schoolId), eq(schools.companyId, parent.companyId)));
    if (!school) throw new BadRequestException('Unknown school');
    return this.db.transaction(async (tx) => {
      const [student] = await tx.insert(students).values({ ...dto, companyId: parent.companyId, status: 'PENDING_APPROVAL' }).returning();
      await tx.insert(parentStudents).values({ parentId: parent.id, studentId: student.id, isPrimary: true });
      return { studentId: student.id, status: student.status };
    });
  }

  async linkWithCode(user: AuthUser, code: string, relation = 'PARENT') {
    const parent = await this.parentOf(user);
    await this.requireConsent(parent.id);
    const [student] = await this.db.select().from(students)
      .where(and(eq(students.activationCode, code.trim().toUpperCase()), eq(students.companyId, parent.companyId)));
    if (!student) throw new NotFoundException('Code not recognised. Check it with the transport office.');
    await this.db.insert(parentStudents).values({ parentId: parent.id, studentId: student.id, relation }).onConflictDoNothing();
    return { studentId: student.id, name: student.name };
  }

  async schools(user: AuthUser) {
    return this.db.select({ id: schools.id, name: schools.name }).from(schools).where(eq(schools.companyId, tenantOf(user)));
  }

  /** Today's trips for one child. */
  async today(user: AuthUser, studentId: string) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, studentId);
    const cfg = await this.settings.get(parent.companyId);
    const date = zoned(new Date(), cfg.timezone).date;
    const rows = await this.db
      .select({ tripId: trips.id, direction: trips.direction, tripStatus: trips.status, studentStatus: tripStudents.status, stopName: stops.name, time: routeStops.scheduledTime })
      .from(tripStudents)
      .innerJoin(trips, eq(trips.id, tripStudents.tripId))
      .innerJoin(routeStops, eq(routeStops.id, tripStudents.routeStopId))
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .where(and(eq(tripStudents.studentId, studentId), eq(trips.date, date)));
    return { date, trips: rows.map((r) => ({ ...r, canTrack: r.tripStatus === 'IN_PROGRESS' })) };
  }

  /** Spec 4.3: absences up to the cut-off before the child's stop time. */
  async addAbsence(user: AuthUser, dto: { studentId: string; date: string; direction?: Direction; reason?: string }) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, dto.studentId);
    await this.checkCutoff(parent.companyId, dto.studentId, dto.date, dto.direction ?? null);
    const [row] = await this.db.insert(absences).values({
      studentId: dto.studentId, date: dto.date, direction: dto.direction ?? null, reason: dto.reason, createdById: user.sub,
    }).returning();
    await this.tripsService.applyAbsence(dto.studentId, dto.date, dto.direction ?? null, true, user.sub);
    return row;
  }

  async cancelAbsence(user: AuthUser, absenceId: string) {
    const parent = await this.parentOf(user);
    const [row] = await this.db.select().from(absences).where(and(eq(absences.id, absenceId), isNull(absences.cancelledAt)));
    if (!row) throw new NotFoundException('Absence not found');
    await this.assertLinked(parent.id, row.studentId);
    await this.checkCutoff(parent.companyId, row.studentId, row.date, row.direction);
    await this.db.update(absences).set({ cancelledAt: new Date() }).where(eq(absences.id, absenceId));
    await this.tripsService.applyAbsence(row.studentId, row.date, row.direction, false, user.sub);
    return { cancelled: true };
  }

  async listAbsences(user: AuthUser, studentId: string) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, studentId);
    return this.db.select().from(absences)
      .where(and(eq(absences.studentId, studentId), isNull(absences.cancelledAt))).orderBy(desc(absences.date));
  }

  private async checkCutoff(companyId: string, studentId: string, date: string, direction: Direction | null) {
    const cfg = await this.settings.get(companyId);
    const now = zoned(new Date(), cfg.timezone);
    if (date < now.date) throw new BadRequestException('That date has passed');
    if (date > now.date) return;
    const plan = await this.db
      .select({ direction: studentAssignments.direction, time: routeStops.scheduledTime })
      .from(studentAssignments).innerJoin(routeStops, eq(routeStops.id, studentAssignments.routeStopId))
      .where(eq(studentAssignments.studentId, studentId));
    for (const p of plan) {
      if (direction && p.direction !== direction) continue;
      if (now.minutes > hhmmToMinutes(p.time) - cfg.absenceCutoffMinutes) {
        const which = p.direction === 'MORNING' ? 'morning' : 'afternoon';
        throw new BadRequestException(`Too late to change today's ${which} trip in the app. Please call the transport office.`);
      }
    }
  }

  async proposeAuthorizedAdult(user: AuthUser, studentId: string, dto: { name: string; relation: string; phone?: string; photoUrl?: string }) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, studentId);
    const [row] = await this.db.insert(authorizedAdults).values({ studentId, ...dto, approved: false }).returning();
    return row;
  }

  async listAuthorizedAdults(user: AuthUser, studentId: string) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, studentId);
    return this.db.select().from(authorizedAdults).where(eq(authorizedAdults.studentId, studentId));
  }

  /** Parent permission for the child to be dropped without an adult, kept as a consent record. */
  async setGoHomeAlone(user: AuthUser, studentId: string, allowed: boolean) {
    const parent = await this.parentOf(user);
    await this.assertLinked(parent.id, studentId);
    await this.db.transaction(async (tx) => {
      if (allowed) {
        await tx.insert(consents).values({
          companyId: parent.companyId, parentId: parent.id, studentId, type: 'GO_HOME_ALONE', version: CONSENT_VERSION, method: 'OTP_VERIFIED_MOBILE',
        });
      } else {
        await tx.update(consents).set({ revokedAt: new Date() }).where(and(
          eq(consents.studentId, studentId), eq(consents.type, 'GO_HOME_ALONE'), isNull(consents.revokedAt),
        ));
      }
      await tx.update(students).set({ mayGoHomeAlone: allowed }).where(eq(students.id, studentId));
    });
    return { mayGoHomeAlone: allowed };
  }

  async notifications(user: AuthUser) {
    return this.db.select().from(notifications).where(eq(notifications.userId, user.sub)).orderBy(desc(notifications.createdAt)).limit(100);
  }

  async markRead(user: AuthUser, id: string) {
    await this.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, user.sub)));
    return { ok: true };
  }
}
