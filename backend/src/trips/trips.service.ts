import {
  BadRequestException, ConflictException, HttpException, HttpStatus, Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { AuthUser } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import {
  absences, authorizedAdults, holidays, incidents, parents, parentStudents, routes, routeStops, schools, stops,
  studentAssignments, students, studentStatusEvents, trips, tripStopEvents, tripStudents, TripStudentStatus,
} from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { blocksTripEnd, crewCanMove, parentMessage } from './status-machine';
import { TripAccessService, TripRow } from './trip-access.service';

export interface StudentEventInput {
  /** Unique id made by the app, so retried offline uploads are applied once */
  clientEventId: string;
  studentId: string;
  toStatus: TripStudentStatus;
  occurredAt: string;
  lat?: number;
  lng?: number;
  authorizedAdultId?: string;
  receivedByParentId?: string;
  note?: string;
}

export interface StudentEventResult {
  clientEventId: string;
  ok: boolean;
  status?: TripStudentStatus;
  duplicate?: boolean;
  error?: string;
}

class EventRejected extends Error {}

@Injectable()
export class TripsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: TripAccessService,
    private readonly settings: CompanySettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ───────────── Planning ─────────────

  private readonly ensured = new Map<string, number>();

  /**
   * Makes sure trips exist for a date without anyone pressing a button.
   * Runs at most every 3 minutes per company and date, and only for today and the next 7 days.
   */
  async ensureTrips(companyId: string, date: string) {
    const cfg = await this.settings.get(companyId);
    const today = zoned(new Date(), cfg.timezone).date;
    const limit = zoned(new Date(Date.now() + 7 * 86_400_000), cfg.timezone).date;
    if (date < today || date > limit) return;
    const key = `${companyId}:${date}`;
    if ((this.ensured.get(key) ?? 0) > Date.now()) return;
    this.ensured.set(key, Date.now() + 3 * 60_000);
    await this.generateForDate(companyId, date);
  }

  async ensureToday(companyId: string) {
    const cfg = await this.settings.get(companyId);
    await this.ensureTrips(companyId, zoned(new Date(), cfg.timezone).date);
  }

  /** Forget the cache so the next view regenerates at once (after route, stop or holiday changes). */
  invalidate(companyId: string) {
    for (const key of this.ensured.keys()) if (key.startsWith(`${companyId}:`)) this.ensured.delete(key);
  }

  /** Creates the day's trips and passenger lists from active routes. Safe to run more than once. */
  async generateForDate(companyId: string, date: string) {
    const activeRoutes = await this.db.select().from(routes)
      .where(and(eq(routes.companyId, companyId), eq(routes.active, true), isNull(routes.deletedAt)));
    const dayHolidays = await this.db.select().from(holidays).where(and(eq(holidays.companyId, companyId), eq(holidays.date, date)));
    const weekday = isoWeekday(date);
    const result = { created: 0, skippedHoliday: 0, skippedIncomplete: 0, skippedDay: 0, trips: [] as string[] };

    for (const route of activeRoutes) {
      if (!(route.days ?? [1, 2, 3, 4, 5, 6]).includes(weekday)) {
        result.skippedDay++;
        continue;
      }
      if (!route.busId || !route.driverId) {
        result.skippedIncomplete++;
        continue;
      }
      if (dayHolidays.some((h) => h.schoolId === null || h.schoolId === route.schoolId)) {
        result.skippedHoliday++;
        continue;
      }
      const inserted = await this.db
        .insert(trips)
        .values({
          companyId, routeId: route.id, busId: route.busId, driverId: route.driverId, attendantId: route.attendantId,
          date, direction: route.direction,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted.length) result.created++;
      const [trip] = inserted.length
        ? inserted
        : await this.db.select().from(trips).where(and(eq(trips.routeId, route.id), eq(trips.date, date)));
      result.trips.push(trip.id);
      if (trip.status === 'SCHEDULED') await this.syncPassengers(trip);
    }
    return result;
  }

  /** Adds newly assigned students to a trip that hasn't started. */
  private async syncPassengers(trip: TripRow) {
    const riders = await this.db
      .select({ studentId: studentAssignments.studentId, routeStopId: studentAssignments.routeStopId })
      .from(studentAssignments)
      .innerJoin(students, eq(students.id, studentAssignments.studentId))
      .where(and(
        eq(studentAssignments.routeId, trip.routeId),
        eq(students.status, 'ACTIVE'),
        or(isNull(students.serviceStart), lte(students.serviceStart, trip.date)),
        or(isNull(students.serviceEnd), gte(students.serviceEnd, trip.date)),
      ));
    if (!riders.length) return;
    const absent = await this.absentStudentIds(riders.map((r) => r.studentId), trip.date, trip.direction);
    await this.db
      .insert(tripStudents)
      .values(riders.map((r) => ({
        tripId: trip.id, studentId: r.studentId, routeStopId: r.routeStopId,
        status: (absent.has(r.studentId) ? 'ABSENT' : 'SCHEDULED') as TripStudentStatus,
      })))
      .onConflictDoNothing();
  }

  private async absentStudentIds(studentIds: string[], date: string, direction: TripRow['direction']) {
    const rows = await this.db
      .select({ studentId: absences.studentId })
      .from(absences)
      .where(and(
        inArray(absences.studentId, studentIds), eq(absences.date, date), isNull(absences.cancelledAt),
        or(isNull(absences.direction), eq(absences.direction, direction)),
      ));
    return new Set(rows.map((r) => r.studentId));
  }

  // ───────────── Crew actions ─────────────

  async start(tripId: string, user: AuthUser) {
    const trip = await this.access.getForCrew(tripId, user);
    if (trip.status !== 'SCHEDULED') throw new ConflictException(`Trip is already ${trip.status.toLowerCase()}`);
    const cfg = await this.settings.get(trip.companyId);
    if (trip.date !== zoned(new Date(), cfg.timezone).date) throw new BadRequestException('This trip is not for today');

    const [updated] = await this.db
      .update(trips)
      .set({ status: 'IN_PROGRESS', startedAt: new Date() })
      .where(and(eq(trips.id, trip.id), eq(trips.status, 'SCHEDULED')))
      .returning();
    if (!updated) throw new ConflictException('Trip was started by someone else');

    const stopRows = await this.db.select({ id: routeStops.id }).from(routeStops).where(eq(routeStops.routeId, trip.routeId));
    if (stopRows.length) {
      await this.db.insert(tripStopEvents).values(stopRows.map((s) => ({ tripId: trip.id, routeStopId: s.id }))).onConflictDoNothing();
    }

    const riders = await this.db.select().from(tripStudents).where(eq(tripStudents.tripId, trip.id));
    const onTrip = riders.filter((r) => r.status !== 'ABSENT').map((r) => r.studentId);
    await this.notifications.notify({
      companyId: trip.companyId,
      userIds: await this.notifications.parentUserIds(onTrip),
      type: 'TRIP_STARTED',
      title: trip.direction === 'MORNING' ? 'The bus has started its morning trip' : 'The bus has left school',
      body: 'You can now track the bus live in the app.',
      data: { tripId: trip.id },
    });
    this.emitTripStatus(updated);
    return updated;
  }

  /** Records arrival at a stop by hand, if GPS didn't. */
  async markStopArrival(tripId: string, routeStopId: string, user: AuthUser) {
    const trip = await this.access.getForCrew(tripId, user);
    this.assertRunning(trip);
    const [row] = await this.db
      .update(tripStopEvents)
      .set({ arrivedAt: new Date() })
      .where(and(eq(tripStopEvents.tripId, trip.id), eq(tripStopEvents.routeStopId, routeStopId), isNull(tripStopEvents.arrivedAt)))
      .returning();
    if (!row) {
      const [existing] = await this.db.select().from(tripStopEvents)
        .where(and(eq(tripStopEvents.tripId, trip.id), eq(tripStopEvents.routeStopId, routeStopId)));
      if (!existing) throw new NotFoundException('Stop is not on this trip');
      return existing;
    }
    return row;
  }

  /** Applies boarding, drop-off and other status changes from the crew app, oldest first. */
  async applyStudentEvents(tripId: string, user: AuthUser, events: StudentEventInput[]): Promise<StudentEventResult[]> {
    const trip = await this.access.getForCrew(tripId, user);
    this.assertRunning(trip);
    const cfg = await this.settings.get(trip.companyId);

    if (user.role === 'DRIVER' && trip.lastSpeedKmh !== null && trip.lastPositionAt) {
      const fresh = Date.now() - trip.lastPositionAt.getTime() < 30_000;
      if (fresh && trip.lastSpeedKmh > cfg.drivingLockKmh) {
        throw new HttpException('Stop the bus before marking students', HttpStatus.LOCKED);
      }
    }

    const sorted = [...events].sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
    const results: StudentEventResult[] = [];
    for (const ev of sorted) {
      try {
        results.push(await this.applyOne(trip, user, ev, cfg));
      } catch (err) {
        if (err instanceof EventRejected) results.push({ clientEventId: ev.clientEventId, ok: false, error: err.message });
        else throw err;
      }
    }
    return results;
  }

  private async applyOne(
    trip: TripRow, user: AuthUser, ev: StudentEventInput,
    cfg: Awaited<ReturnType<CompanySettingsService['get']>>,
  ): Promise<StudentEventResult> {
    const occurredAt = new Date(ev.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) throw new EventRejected('Bad occurredAt time');

    const outcome = await this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ to: studentStatusEvents.toStatus }).from(studentStatusEvents)
        .where(eq(studentStatusEvents.clientEventId, ev.clientEventId));
      if (dup) return { duplicate: true as const, status: dup.to };

      const [ts] = await tx.select().from(tripStudents)
        .where(and(eq(tripStudents.tripId, trip.id), eq(tripStudents.studentId, ev.studentId)))
        .for('update');
      if (!ts) throw new EventRejected('Student is not on this trip');
      if (ts.status === ev.toStatus) return { duplicate: true as const, status: ts.status };
      if (!crewCanMove(trip.direction, ts.status, ev.toStatus)) {
        throw new EventRejected(`Cannot change ${ts.status} to ${ev.toStatus}`);
      }

      const [student] = await tx.select().from(students).where(eq(students.id, ev.studentId));
      let adultName: string | undefined;

      if (ev.toStatus === 'DROPPED_ALONE' && !student.mayGoHomeAlone) {
        throw new EventRejected('Parent has not allowed this child to go home alone');
      }
      if (ev.toStatus === 'HANDED_OVER') {
        adultName = await this.verifyReceiver(tx, ev);
      }
      if (ev.toStatus === 'NO_SHOW' && trip.direction === 'MORNING') {
        const [stopEv] = await tx.select().from(tripStopEvents)
          .where(and(eq(tripStopEvents.tripId, trip.id), eq(tripStopEvents.routeStopId, ts.routeStopId)));
        const [rs] = await tx.select().from(routeStops).where(eq(routeStops.id, ts.routeStopId));
        const wait = (rs?.waitSeconds ?? cfg.waitSecondsMorning) * 1000;
        if (!stopEv?.arrivedAt) throw new EventRejected('Mark arrival at the stop first');
        if (occurredAt.getTime() - stopEv.arrivedAt.getTime() < wait) {
          throw new EventRejected(`Wait ${Math.round(wait / 1000)} seconds at the stop before marking a no-show`);
        }
      }

      await tx.update(tripStudents).set({ status: ev.toStatus, updatedAt: new Date() }).where(eq(tripStudents.id, ts.id));
      await tx.insert(studentStatusEvents).values({
        tripStudentId: ts.id, clientEventId: ev.clientEventId, fromStatus: ts.status, toStatus: ev.toStatus,
        occurredAt, lat: ev.lat, lng: ev.lng, byUserId: user.sub,
        authorizedAdultId: ev.authorizedAdultId, receivedByParentId: ev.receivedByParentId, note: ev.note,
      });
      return { duplicate: false as const, status: ev.toStatus, from: ts.status, student, routeStopId: ts.routeStopId, adultName };
    });

    if (outcome.duplicate) return { clientEventId: ev.clientEventId, ok: true, duplicate: true, status: outcome.status };
    await this.afterStatusChange(trip, outcome.student, outcome.status, outcome.routeStopId, outcome.adultName);
    return { clientEventId: ev.clientEventId, ok: true, status: outcome.status };
  }

  /** The person receiving a child must be an approved authorized adult or a linked parent. Returns their name. */
  private async verifyReceiver(tx: Parameters<Parameters<Db['transaction']>[0]>[0], ev: StudentEventInput): Promise<string> {
    if (ev.authorizedAdultId) {
      const [adult] = await tx.select().from(authorizedAdults).where(and(
        eq(authorizedAdults.id, ev.authorizedAdultId), eq(authorizedAdults.studentId, ev.studentId), eq(authorizedAdults.approved, true),
      ));
      if (!adult) throw new EventRejected('This person is not an approved pickup for the child');
      return adult.name;
    }
    if (ev.receivedByParentId) {
      const [row] = await tx.select({ parentId: parentStudents.parentId }).from(parentStudents)
        .where(and(eq(parentStudents.parentId, ev.receivedByParentId), eq(parentStudents.studentId, ev.studentId)));
      if (!row) throw new EventRejected('This parent is not linked to the child');
      return 'a parent';
    }
    throw new EventRejected('Choose who received the child');
  }

  private async afterStatusChange(
    trip: TripRow, student: typeof students.$inferSelect, status: TripStudentStatus, routeStopId: string, adult?: string,
  ) {
    const [place] = await this.db
      .select({ stop: stops.name, school: schools.name })
      .from(routeStops)
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .innerJoin(routes, eq(routes.id, routeStops.routeId))
      .innerJoin(schools, eq(schools.id, routes.schoolId))
      .where(eq(routeStops.id, routeStopId));
    const msg = parentMessage(status, { student: student.name, stop: place?.stop, school: place?.school, adult });
    if (msg) {
      await this.notifications.notify({
        companyId: trip.companyId,
        userIds: await this.notifications.parentUserIds([student.id]),
        type: `STUDENT_${status}`,
        ...msg,
        data: { tripId: trip.id, studentId: student.id },
      });
    }
    if (status === 'HELD' || status === 'RETURNED') {
      await this.alertAdmins(trip.companyId, {
        type: `ALERT_${status}`,
        title: status === 'HELD' ? `Child held on bus: ${student.name}` : `Child being returned: ${student.name}`,
        body: `No authorized adult at ${place?.stop ?? 'the stop'}. Trip ${trip.id.slice(0, 8)}.`,
        data: { tripId: trip.id, studentId: student.id },
        sms: status === 'RETURNED',
      });
    }
    // Per-child status goes only to staff; parents get their own child's update as a notification.
    const payload = { tripId: trip.id, studentId: student.id, status };
    this.realtime.toCompany(trip.companyId, 'student:status', payload);
    this.realtime.toUser(trip.driverId, 'student:status', payload);
    if (trip.attendantId) this.realtime.toUser(trip.attendantId, 'student:status', payload);
  }

  /** Morning trip: marks everyone on board as reached school. */
  async arriveAtSchool(tripId: string, user: AuthUser) {
    const trip = await this.access.getForCrew(tripId, user);
    this.assertRunning(trip);
    if (trip.direction !== 'MORNING') throw new BadRequestException('Only morning trips arrive at school');
    const onBoard = await this.db.select().from(tripStudents)
      .where(and(eq(tripStudents.tripId, trip.id), eq(tripStudents.status, 'BOARDED')));
    const now = new Date().toISOString();
    const results = await this.applyStudentEvents(trip.id, user, onBoard.map((s) => ({
      clientEventId: `school:${trip.id}:${s.studentId}`, studentId: s.studentId, toStatus: 'AT_SCHOOL', occurredAt: now,
    })));
    await this.db.update(trips).set({ arrivedSchoolAt: new Date() }).where(eq(trips.id, trip.id));
    return { arrived: results.filter((r) => r.ok).length };
  }

  /** Spec 4.5: attendant confirms no child is left on board. Blocks and alerts if records say otherwise. */
  async emptyBusCheck(tripId: string, user: AuthUser) {
    const trip = await this.access.getForCrew(tripId, user);
    this.assertRunning(trip);
    const stillOn = await this.unresolved(trip.id);
    const onBoard = stillOn.filter((s) => blocksTripEnd(s.status));
    if (onBoard.length) {
      await this.alertAdmins(trip.companyId, {
        type: 'ALERT_EMPTY_BUS_CHECK',
        title: 'Empty-bus check blocked',
        body: `${onBoard.length} child(ren) still marked on board: ${onBoard.map((s) => s.name).join(', ')}.`,
        data: { tripId: trip.id },
        sms: true,
      });
      throw new ConflictException({ message: 'Children are still marked on board', students: onBoard });
    }
    const [updated] = await this.db.update(trips)
      .set({ emptyBusCheckedAt: new Date(), emptyBusCheckedBy: user.sub })
      .where(eq(trips.id, trip.id)).returning();
    return updated;
  }

  async end(tripId: string, user: AuthUser) {
    const trip = await this.access.getForCrew(tripId, user);
    this.assertRunning(trip);
    const open = await this.unresolved(trip.id);
    if (open.length) {
      throw new ConflictException({
        message: 'Every child needs a final status before the trip can end',
        students: open,
      });
    }
    if (!trip.emptyBusCheckedAt) throw new ConflictException('Do the empty-bus check first');
    const [updated] = await this.db.update(trips)
      .set({ status: 'COMPLETED', endedAt: new Date() })
      .where(and(eq(trips.id, trip.id), eq(trips.status, 'IN_PROGRESS'))).returning();
    this.emitTripStatus(updated);
    await this.realtime.closeTrip(trip.id);
    return updated;
  }

  /** Children with no final status yet: still scheduled, on board or held. */
  private async unresolved(tripId: string) {
    return this.db
      .select({ studentId: tripStudents.studentId, name: students.name, status: tripStudents.status })
      .from(tripStudents)
      .innerJoin(students, eq(students.id, tripStudents.studentId))
      .where(and(eq(tripStudents.tripId, tripId), inArray(tripStudents.status, ['SCHEDULED', 'BOARDED', 'HELD'])));
  }

  // ───────────── Admin and parent actions ─────────────

  /** Admin correction to any status. Always needs a reason and is flagged in the record. */
  async overrideStatus(tripId: string, studentId: string, admin: AuthUser, toStatus: TripStudentStatus, note: string) {
    const trip = await this.access.getForCompany(tripId, admin.companyId);
    const [ts] = await this.db.select().from(tripStudents)
      .where(and(eq(tripStudents.tripId, trip.id), eq(tripStudents.studentId, studentId)));
    if (!ts) throw new NotFoundException('Student is not on this trip');
    if (ts.status === toStatus) return ts;
    await this.db.transaction(async (tx) => {
      await tx.update(tripStudents).set({ status: toStatus, updatedAt: new Date() }).where(eq(tripStudents.id, ts.id));
      await tx.insert(studentStatusEvents).values({
        tripStudentId: ts.id, clientEventId: `override:${ts.id}:${Date.now()}`, fromStatus: ts.status, toStatus,
        occurredAt: new Date(), byUserId: admin.sub, note, isOverride: true,
      });
    });
    const [student] = await this.db.select().from(students).where(eq(students.id, studentId));
    await this.afterStatusChange(trip, student, toStatus, ts.routeStopId);
    return { ...ts, status: toStatus };
  }

  /** Admin stops a trip (e.g. a test trip, or the bus was replaced). Parents lose live tracking at once. */
  async cancel(tripId: string, admin: AuthUser) {
    const trip = await this.access.getForCompany(tripId, admin.companyId);
    if (trip.status === 'COMPLETED' || trip.status === 'CANCELLED') throw new ConflictException('This trip has already finished');
    const [updated] = await this.db.update(trips).set({ status: 'CANCELLED', endedAt: new Date() }).where(eq(trips.id, trip.id)).returning();
    this.emitTripStatus(updated);
    await this.realtime.closeTrip(trip.id);
    return updated;
  }

  /**
   * Admin removes a trip that isn't running. Today's and future trips are kept as CANCELLED and hidden,
   * so the automatic schedule doesn't bring them back. Past trips are deleted with their records.
   */
  async remove(tripId: string, admin: AuthUser) {
    const trip = await this.access.getForCompany(tripId, admin.companyId);
    if (trip.status === 'IN_PROGRESS') throw new ConflictException('This trip is running. Stop it first, then delete it.');
    const cfg = await this.settings.get(trip.companyId);
    if (trip.date >= zoned(new Date(), cfg.timezone).date) {
      await this.db.update(trips).set({ status: 'CANCELLED', endedAt: trip.endedAt ?? new Date() }).where(eq(trips.id, trip.id));
      return { deleted: true };
    }
    await this.db.transaction(async (tx) => {
      await tx.update(incidents).set({ tripId: null }).where(eq(incidents.tripId, trip.id));
      await tx.delete(trips).where(eq(trips.id, trip.id));
    });
    return { deleted: true };
  }

  /** A holiday removes that day's trips that haven't started. */
  async applyHoliday(companyId: string, date: string, schoolId: string | null) {
    const dayTrips = await this.db.select({ trip: trips, schoolId: routes.schoolId }).from(trips)
      .innerJoin(routes, eq(routes.id, trips.routeId))
      .where(and(eq(trips.companyId, companyId), eq(trips.date, date), eq(trips.status, 'SCHEDULED')));
    const ids = dayTrips.filter((t) => !schoolId || t.schoolId === schoolId).map((t) => t.trip.id);
    if (ids.length) await this.db.delete(trips).where(inArray(trips.id, ids));
    this.invalidate(companyId);
    return ids.length;
  }

  /** A parent's new or cancelled absence updates a trip that already exists. */
  async applyAbsence(studentId: string, date: string, direction: TripRow['direction'] | null, absent: boolean, byUserId: string) {
    const rows = await this.db
      .select({ ts: tripStudents, trip: trips })
      .from(tripStudents)
      .innerJoin(trips, eq(trips.id, tripStudents.tripId))
      .where(and(eq(tripStudents.studentId, studentId), eq(trips.date, date)));
    for (const { ts, trip } of rows) {
      if (direction && trip.direction !== direction) continue;
      const [from, to]: TripStudentStatus[] = absent ? ['SCHEDULED', 'ABSENT'] : ['ABSENT', 'SCHEDULED'];
      if (ts.status !== from) continue;
      await this.db.update(tripStudents).set({ status: to, updatedAt: new Date() }).where(eq(tripStudents.id, ts.id));
      await this.db.insert(studentStatusEvents).values({
        tripStudentId: ts.id, clientEventId: `absence:${ts.id}:${Date.now()}`, fromStatus: from, toStatus: to,
        occurredAt: new Date(), byUserId, note: absent ? 'Parent marked absent' : 'Parent cancelled absence',
      });
      const payload = { tripId: trip.id, studentId, status: to };
      this.realtime.toUser(trip.driverId, 'student:status', payload);
      if (trip.attendantId) this.realtime.toUser(trip.attendantId, 'student:status', payload);
      this.realtime.toCompany(trip.companyId, 'student:status', payload);
    }
  }

  // ───────────── Reading ─────────────

  /** Full trip sheet for crew and admins: stops in order, children at each, their status and approved pickups. */
  async sheet(trip: TripRow) {
    const stopRows = await this.db
      .select({ routeStop: routeStops, stop: stops, event: tripStopEvents })
      .from(routeStops)
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .leftJoin(tripStopEvents, and(eq(tripStopEvents.routeStopId, routeStops.id), eq(tripStopEvents.tripId, trip.id)))
      .where(eq(routeStops.routeId, trip.routeId))
      .orderBy(asc(routeStops.sequence));
    const riders = await this.db
      .select({ ts: tripStudents, student: students })
      .from(tripStudents)
      .innerJoin(students, eq(students.id, tripStudents.studentId))
      .where(eq(tripStudents.tripId, trip.id));
    const ids = riders.map((r) => r.student.id);
    const adults = ids.length
      ? await this.db.select().from(authorizedAdults).where(and(inArray(authorizedAdults.studentId, ids), eq(authorizedAdults.approved, true)))
      : [];
    const parentRows = ids.length
      ? await this.db.select({ parentId: parents.id, studentId: parentStudents.studentId, relation: parentStudents.relation })
        .from(parentStudents).innerJoin(parents, eq(parents.id, parentStudents.parentId))
        .where(inArray(parentStudents.studentId, ids))
      : [];

    const [routeInfo] = await this.db.select({ path: routes.path, school: schools }).from(routes)
      .innerJoin(schools, eq(schools.id, routes.schoolId)).where(eq(routes.id, trip.routeId));
    return {
      trip,
      path: routeInfo?.path ?? null,
      school: routeInfo ? { name: routeInfo.school.name, lat: routeInfo.school.lat, lng: routeInfo.school.lng } : null,
      stops: stopRows.map(({ routeStop, stop, event }) => ({
        routeStopId: routeStop.id, sequence: routeStop.sequence, scheduledTime: routeStop.scheduledTime,
        name: stop.name, lat: stop.lat, lng: stop.lng,
        arrivedAt: event?.arrivedAt ?? null,
        students: riders.filter((r) => r.ts.routeStopId === routeStop.id).map(({ ts, student }) => ({
          studentId: student.id, name: student.name, photoUrl: student.photoUrl, className: student.className,
          status: ts.status, mayGoHomeAlone: student.mayGoHomeAlone, specialInstructions: student.specialInstructions,
          authorizedAdults: adults.filter((a) => a.studentId === student.id)
            .map((a) => ({ id: a.id, name: a.name, relation: a.relation, photoUrl: a.photoUrl })),
          parents: parentRows.filter((p) => p.studentId === student.id).map((p) => ({ parentId: p.parentId, relation: p.relation })),
        })),
      })),
    };
  }

  private assertRunning(trip: TripRow) {
    if (trip.status !== 'IN_PROGRESS') throw new ConflictException('Trip is not running');
  }

  private emitTripStatus(trip: TripRow) {
    const payload = { tripId: trip.id, status: trip.status, startedAt: trip.startedAt, endedAt: trip.endedAt };
    this.realtime.toCompany(trip.companyId, 'trip:status', payload);
    this.realtime.toTrip(trip.id, 'trip:status', payload);
  }

  private async alertAdmins(companyId: string, a: { type: string; title: string; body: string; data: Record<string, string>; sms?: boolean }) {
    await this.notifications.notify({ companyId, userIds: await this.notifications.adminUserIds(companyId), safety: true, ...a });
    this.realtime.toCompany(companyId, 'alert', a);
  }
}

/** 1 = Monday … 7 = Sunday, for a YYYY-MM-DD date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
