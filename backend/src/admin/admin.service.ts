import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { AuthGuard } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { activationCode, hashPassword, normalizePhone } from '../common/passwords';
import { zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import {
  authorizedAdults, buses, companies, holidays, incidents, invoices, parents, parentStudents, routes, routeStops, schools,
  staffProfiles, stops, studentAssignments, students, trips, tripStudents, users,
} from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutePathService } from '../trips/route-path.service';
import { AnnouncementDto, AssignmentsDto, CompanyDto, ParentDto, RouteDto, RouteStopsDto, StaffDto, StudentDto } from './dto';
import { TenantCrud, uniqueToConflict } from './tenant-crud';

@Injectable()
export class AdminService {
  readonly schools: TenantCrud<typeof schools>;
  readonly stops: TenantCrud<typeof stops>;
  readonly buses: TenantCrud<typeof buses>;
  readonly routes: TenantCrud<typeof routes>;
  readonly students: TenantCrud<typeof students>;
  readonly incidents: TenantCrud<typeof incidents>;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: CompanySettingsService,
    private readonly notifications: NotificationsService,
    private readonly guard: AuthGuard,
    private readonly paths: RoutePathService,
  ) {
    this.schools = new TenantCrud(db, schools, 'School');
    this.stops = new TenantCrud(db, stops, 'Stop');
    this.buses = new TenantCrud(db, buses, 'Bus');
    this.routes = new TenantCrud(db, routes, 'Route');
    this.students = new TenantCrud(db, students, 'Student');
    this.incidents = new TenantCrud(db, incidents, 'Incident');
  }

  private phone(raw: string) {
    const p = normalizePhone(raw);
    if (!p) throw new BadRequestException('Enter a valid mobile number');
    return p;
  }

  // ───────────── Companies (platform owner) ─────────────

  async createCompany(dto: CompanyDto) {
    return this.db.transaction(async (tx) => {
      try {
        const [company] = await tx.insert(companies).values({
          name: dto.name, slug: dto.slug, phone: dto.phone, email: dto.email, address: dto.address, gstin: dto.gstin,
        }).returning();
        const [admin] = await tx.insert(users).values({
          companyId: company.id, role: 'COMPANY_ADMIN', name: dto.adminName, phone: this.phone(dto.adminPhone),
          email: dto.adminEmail.toLowerCase(), passwordHash: await hashPassword(dto.adminPassword),
        }).returning({ id: users.id });
        return { company, adminUserId: admin.id };
      } catch (e) {
        throw uniqueToConflict(e, 'Company');
      }
    });
  }

  // ───────────── Staff ─────────────

  async listStaff(companyId: string) {
    return this.db
      .select({
        id: users.id, role: users.role, name: users.name, phone: users.phone, email: users.email, active: users.active,
        licenseNumber: staffProfiles.licenseNumber, licenseExpiry: staffProfiles.licenseExpiry,
        policeVerified: staffProfiles.policeVerified, lastLoginAt: users.lastLoginAt,
        address: staffProfiles.address, emergencyContact: staffProfiles.emergencyContact,
      })
      .from(users)
      .leftJoin(staffProfiles, eq(staffProfiles.userId, users.id))
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt), inArray(users.role, ['DRIVER', 'ATTENDANT', 'OFFICE_STAFF', 'COMPANY_ADMIN'])))
      .orderBy(asc(users.name));
  }

  async createStaff(companyId: string, dto: StaffDto) {
    if ((dto.role === 'OFFICE_STAFF' || dto.role === 'COMPANY_ADMIN') && (!dto.email || !dto.password)) {
      throw new BadRequestException('Admin panel users need an email and password');
    }
    return this.db.transaction(async (tx) => {
      try {
        const [user] = await tx.insert(users).values({
          companyId, role: dto.role, name: dto.name, phone: this.phone(dto.phone), email: dto.email?.toLowerCase(),
          passwordHash: dto.password ? await hashPassword(dto.password) : null,
        }).returning();
        if (dto.role === 'DRIVER' || dto.role === 'ATTENDANT') {
          await tx.insert(staffProfiles).values({
            companyId, userId: user.id, type: dto.role, licenseNumber: dto.licenseNumber, licenseExpiry: dto.licenseExpiry,
            address: dto.address, emergencyContact: dto.emergencyContact, policeVerified: dto.policeVerified ?? false,
          });
        }
        const { passwordHash: _, ...safe } = user;
        return safe;
      } catch (e) {
        throw uniqueToConflict(e, 'A user with this phone number');
      }
    });
  }

  async setUserActive(companyId: string, userId: string, active: boolean) {
    const [row] = await this.db.update(users).set({ active })
      .where(and(eq(users.id, userId), eq(users.companyId, companyId))).returning({ id: users.id, active: users.active });
    if (!row) throw new NotFoundException('User not found');
    this.guard.forget(userId);
    return row;
  }

  private async assertUserRole(companyId: string, userId: string | undefined, role: 'DRIVER' | 'ATTENDANT') {
    if (!userId) return;
    const [u] = await this.db.select({ role: users.role }).from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId)));
    if (!u || u.role !== role) throw new BadRequestException(`${role === 'DRIVER' ? 'Driver' : 'Attendant'} not found`);
  }

  // ───────────── Routes ─────────────

  async createRoute(companyId: string, dto: RouteDto) {
    await this.checkRouteRefs(companyId, dto);
    return this.routes.create(companyId, { ...dto });
  }

  async updateRoute(companyId: string, id: string, dto: Partial<RouteDto>) {
    await this.checkRouteRefs(companyId, dto);
    const row = await this.routes.update(companyId, id, { ...dto });
    if (dto.schoolId) await this.paths.refresh(id);
    return row;
  }

  private async checkRouteRefs(companyId: string, dto: Partial<RouteDto>) {
    if (dto.schoolId) await this.schools.get(companyId, dto.schoolId);
    if (dto.busId) await this.buses.get(companyId, dto.busId);
    await this.assertUserRole(companyId, dto.driverId, 'DRIVER');
    await this.assertUserRole(companyId, dto.attendantId, 'ATTENDANT');
  }

  async routeDetail(companyId: string, id: string) {
    const route = await this.routes.get(companyId, id);
    const stopList = await this.db
      .select({ routeStopId: routeStops.id, sequence: routeStops.sequence, scheduledTime: routeStops.scheduledTime,
        waitSeconds: routeStops.waitSeconds, stopId: stops.id, name: stops.name, lat: stops.lat, lng: stops.lng })
      .from(routeStops).innerJoin(stops, eq(stops.id, routeStops.stopId))
      .where(eq(routeStops.routeId, id)).orderBy(asc(routeStops.sequence));
    const riders = await this.db
      .select({ studentId: students.id, name: students.name, routeStopId: studentAssignments.routeStopId })
      .from(studentAssignments).innerJoin(students, eq(students.id, studentAssignments.studentId))
      .where(eq(studentAssignments.routeId, id));
    const bus = route.busId ? await this.buses.get(companyId, route.busId) : null;
    const path = route.path ?? (stopList.length >= 2 ? await this.paths.refresh(id) : null);
    const [school] = await this.db.select({ name: schools.name, lat: schools.lat, lng: schools.lng }).from(schools).where(eq(schools.id, route.schoolId));
    return {
      ...route, path, school, stops: stopList, students: riders,
      capacityWarning: bus && riders.length > bus.capacity ? `${riders.length} students but ${bus.capacity} seats` : null,
    };
  }

  /** Replaces the route's stops, in order. Fails if a stop being removed still has students assigned. */
  async setRouteStops(companyId: string, routeId: string, dto: RouteStopsDto) {
    await this.routes.get(companyId, routeId);
    const ids = [...new Set(dto.stops.map((s) => s.stopId))];
    if (ids.length !== dto.stops.length) throw new BadRequestException('A stop appears twice');
    if (ids.length) {
      const owned = await this.db.select({ id: stops.id }).from(stops).where(and(eq(stops.companyId, companyId), inArray(stops.id, ids)));
      if (owned.length !== ids.length) throw new BadRequestException('Unknown stop');
    }
    return this.db.transaction(async (tx) => {
      const existing = await tx.select().from(routeStops).where(eq(routeStops.routeId, routeId));
      const keep = new Map(existing.map((rs) => [rs.stopId, rs]));
      const removed = existing.filter((rs) => !ids.includes(rs.stopId));
      if (removed.length) {
        const [{ n }] = await tx.select({ n: count() }).from(studentAssignments)
          .where(inArray(studentAssignments.routeStopId, removed.map((r) => r.id)));
        if (n > 0) throw new ConflictException('Move the students off a stop before removing it');
        try {
          await tx.delete(routeStops).where(inArray(routeStops.id, removed.map((r) => r.id)));
        } catch {
          throw new ConflictException('A removed stop has trip history. Make a copy of the route instead.');
        }
      }
      // Shift sequences out of the way, then write the new order.
      await tx.update(routeStops).set({ sequence: sql`${routeStops.sequence} + 10000` }).where(eq(routeStops.routeId, routeId));
      for (const [i, s] of dto.stops.entries()) {
        const current = keep.get(s.stopId);
        if (current) {
          await tx.update(routeStops).set({ sequence: i + 1, scheduledTime: s.scheduledTime, waitSeconds: s.waitSeconds ?? null })
            .where(eq(routeStops.id, current.id));
        } else {
          await tx.insert(routeStops).values({ routeId, stopId: s.stopId, sequence: i + 1, scheduledTime: s.scheduledTime, waitSeconds: s.waitSeconds });
        }
      }
      return tx.select().from(routeStops).where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.sequence));
    }).then(async (rows) => {
      await this.paths.refresh(routeId);
      return rows;
    });
  }

  /** Puts students on stops of this route. A student has one morning and one afternoon assignment. */
  async assignStudents(companyId: string, routeId: string, dto: AssignmentsDto) {
    const route = await this.routes.get(companyId, routeId);
    const routeStopIds = new Set((await this.db.select({ id: routeStops.id }).from(routeStops).where(eq(routeStops.routeId, routeId))).map((r) => r.id));
    const studentIds = [...new Set(dto.assignments.map((a) => a.studentId))];
    const owned = studentIds.length
      ? await this.db.select({ id: students.id, schoolId: students.schoolId }).from(students)
        .where(and(eq(students.companyId, companyId), inArray(students.id, studentIds)))
      : [];
    if (owned.length !== studentIds.length) throw new BadRequestException('Unknown student');
    if (owned.some((s) => s.schoolId !== route.schoolId)) throw new BadRequestException('Student goes to a different school than this route');
    for (const a of dto.assignments) {
      if (!routeStopIds.has(a.routeStopId)) throw new BadRequestException('Stop is not on this route');
    }
    for (const a of dto.assignments) {
      await this.db.insert(studentAssignments)
        .values({ studentId: a.studentId, routeId, routeStopId: a.routeStopId, direction: route.direction })
        .onConflictDoUpdate({ target: [studentAssignments.studentId, studentAssignments.direction], set: { routeId, routeStopId: a.routeStopId } });
    }
    return this.routeDetail(companyId, routeId);
  }

  async refreshPathsForStop(stopId: string) {
    const using = await this.db.selectDistinct({ routeId: routeStops.routeId }).from(routeStops).where(eq(routeStops.stopId, stopId));
    for (const r of using) await this.paths.refresh(r.routeId);
  }

  // ───────────── Students ─────────────

  async createStudent(companyId: string, dto: StudentDto) {
    await this.schools.get(companyId, dto.schoolId);
    return this.students.create(companyId, { ...dto, status: dto.status ?? 'ACTIVE', activationCode: activationCode() });
  }

  async updateStudent(companyId: string, id: string, dto: Partial<StudentDto>) {
    if (dto.schoolId) await this.schools.get(companyId, dto.schoolId);
    return this.students.update(companyId, id, { ...dto });
  }

  async studentDetail(companyId: string, id: string) {
    const student = await this.students.get(companyId, id);
    const adults = await this.db.select().from(authorizedAdults).where(eq(authorizedAdults.studentId, id));
    const parentRows = await this.db
      .select({ parentId: parents.id, name: users.name, phone: users.phone, relation: parentStudents.relation })
      .from(parentStudents).innerJoin(parents, eq(parents.id, parentStudents.parentId)).innerJoin(users, eq(users.id, parents.userId))
      .where(eq(parentStudents.studentId, id));
    const assignmentRows = await this.db
      .select({ direction: studentAssignments.direction, routeId: routes.id, routeName: routes.name, stopName: stops.name, time: routeStops.scheduledTime })
      .from(studentAssignments).innerJoin(routes, eq(routes.id, studentAssignments.routeId))
      .innerJoin(routeStops, eq(routeStops.id, studentAssignments.routeStopId)).innerJoin(stops, eq(stops.id, routeStops.stopId))
      .where(eq(studentAssignments.studentId, id));
    return { ...student, authorizedAdults: adults, parents: parentRows, assignments: assignmentRows };
  }

  async addAuthorizedAdult(companyId: string, studentId: string, dto: { name: string; relation: string; phone?: string; photoUrl?: string }) {
    await this.students.get(companyId, studentId);
    const [row] = await this.db.insert(authorizedAdults).values({ studentId, ...dto, approved: true }).returning();
    return row;
  }

  async setAuthorizedAdultApproval(companyId: string, studentId: string, adultId: string, approved: boolean) {
    await this.students.get(companyId, studentId);
    const [row] = await this.db.update(authorizedAdults).set({ approved })
      .where(and(eq(authorizedAdults.id, adultId), eq(authorizedAdults.studentId, studentId))).returning();
    if (!row) throw new NotFoundException('Person not found');
    return row;
  }

  /** Approval queue: children added by parents and pickup people they proposed. */
  async pendingApprovals(companyId: string) {
    const pendingStudents = await this.students.list(companyId, eq(students.status, 'PENDING_APPROVAL'));
    const pendingAdults = await this.db
      .select({ adult: authorizedAdults, studentName: students.name })
      .from(authorizedAdults).innerJoin(students, eq(students.id, authorizedAdults.studentId))
      .where(and(eq(students.companyId, companyId), eq(authorizedAdults.approved, false)));
    return { students: pendingStudents, authorizedAdults: pendingAdults };
  }

  // ───────────── Parents ─────────────

  async listParents(companyId: string) {
    const rows = await this.db
      .select({ parentId: parents.id, userId: users.id, name: users.name, phone: users.phone, email: users.email, active: users.active,
        address: parents.address, emergencyContactName: parents.emergencyContactName, emergencyContactPhone: parents.emergencyContactPhone })
      .from(parents).innerJoin(users, eq(users.id, parents.userId))
      .where(and(eq(parents.companyId, companyId), isNull(users.deletedAt))).orderBy(asc(users.name));
    const links = rows.length
      ? await this.db.select({ parentId: parentStudents.parentId, studentId: students.id, name: students.name })
        .from(parentStudents).innerJoin(students, eq(students.id, parentStudents.studentId))
        .where(inArray(parentStudents.parentId, rows.map((r) => r.parentId)))
      : [];
    return rows.map((r) => ({ ...r, children: links.filter((l) => l.parentId === r.parentId).map(({ studentId, name }) => ({ studentId, name })) }));
  }

  async createParent(companyId: string, dto: ParentDto) {
    return this.db.transaction(async (tx) => {
      try {
        const [user] = await tx.insert(users).values({
          companyId, role: 'PARENT', name: dto.name, phone: this.phone(dto.phone), email: dto.email?.toLowerCase(),
        }).returning();
        const [parent] = await tx.insert(parents).values({
          companyId, userId: user.id, address: dto.address,
          emergencyContactName: dto.emergencyContactName, emergencyContactPhone: dto.emergencyContactPhone,
        }).returning();
        return { parentId: parent.id, userId: user.id, name: user.name, phone: user.phone };
      } catch (e) {
        throw uniqueToConflict(e, 'A user with this phone number');
      }
    });
  }

  async linkParentStudent(companyId: string, parentId: string, studentId: string, relation = 'PARENT') {
    const [parent] = await this.db.select().from(parents).where(and(eq(parents.id, parentId), eq(parents.companyId, companyId)));
    if (!parent) throw new NotFoundException('Parent not found');
    await this.students.get(companyId, studentId);
    await this.db.insert(parentStudents).values({ parentId, studentId, relation }).onConflictDoNothing();
    return { linked: true };
  }

  // ───────────── Edit and delete ─────────────
  // Records with trip history are archived (hidden, kept for safety records); others are deleted.

  private archivedPhone(phone: string, id: string) {
    return `${phone}#archived-${id.slice(0, 8)}`;
  }

  async updateStaff(companyId: string, userId: string, dto: Partial<StaffDto>) {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)));
    if (!u || u.role === 'PARENT' || u.role === 'SUPER_ADMIN') throw new NotFoundException('Person not found');
    try {
      await this.db.update(users).set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.phone ? { phone: this.phone(dto.phone) } : {}),
        ...(dto.email !== undefined ? { email: dto.email ? dto.email.toLowerCase() : null } : {}),
        ...(dto.password ? { passwordHash: await hashPassword(dto.password) } : {}),
      }).where(eq(users.id, userId));
    } catch (e) {
      throw uniqueToConflict(e, 'A user with this phone number');
    }
    if (u.role === 'DRIVER' || u.role === 'ATTENDANT') {
      const profile = {
        ...(dto.licenseNumber !== undefined ? { licenseNumber: dto.licenseNumber || null } : {}),
        ...(dto.licenseExpiry !== undefined ? { licenseExpiry: dto.licenseExpiry || null } : {}),
        ...(dto.address !== undefined ? { address: dto.address || null } : {}),
        ...(dto.emergencyContact !== undefined ? { emergencyContact: dto.emergencyContact || null } : {}),
        ...(dto.policeVerified !== undefined ? { policeVerified: dto.policeVerified } : {}),
      };
      if (Object.keys(profile).length) await this.db.update(staffProfiles).set(profile).where(eq(staffProfiles.userId, userId));
    }
    return { updated: true };
  }

  async removeStaff(companyId: string, userId: string, me: string) {
    if (userId === me) throw new BadRequestException('You cannot delete your own account');
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, companyId), isNull(users.deletedAt)));
    if (!u || u.role === 'PARENT' || u.role === 'SUPER_ADMIN') throw new NotFoundException('Person not found');
    if (u.role === 'COMPANY_ADMIN') {
      const [{ n }] = await this.db.select({ n: count() }).from(users)
        .where(and(eq(users.companyId, companyId), eq(users.role, 'COMPANY_ADMIN'), eq(users.active, true), isNull(users.deletedAt)));
      if (n <= 1) throw new BadRequestException('The company needs at least one admin');
    }
    await this.db.update(routes).set({ driverId: null }).where(eq(routes.driverId, userId));
    await this.db.update(routes).set({ attendantId: null }).where(eq(routes.attendantId, userId));
    const [{ n }] = await this.db.select({ n: count() }).from(trips)
      .where(or(eq(trips.driverId, userId), eq(trips.attendantId, userId)));
    this.guard.forget(userId);
    if (n > 0) {
      await this.db.update(users).set({ active: false, deletedAt: new Date(), phone: this.archivedPhone(u.phone, u.id), email: null })
        .where(eq(users.id, userId));
      return { archived: true };
    }
    await this.db.delete(users).where(eq(users.id, userId));
    return { deleted: true };
  }

  async updateParent(companyId: string, parentId: string, dto: Partial<ParentDto>) {
    const [p] = await this.db.select().from(parents).where(and(eq(parents.id, parentId), eq(parents.companyId, companyId)));
    if (!p) throw new NotFoundException('Parent not found');
    try {
      await this.db.update(users).set({
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.phone ? { phone: this.phone(dto.phone) } : {}),
        ...(dto.email !== undefined ? { email: dto.email ? dto.email.toLowerCase() : null } : {}),
      }).where(eq(users.id, p.userId));
    } catch (e) {
      throw uniqueToConflict(e, 'A user with this phone number');
    }
    await this.db.update(parents).set({
      ...(dto.address !== undefined ? { address: dto.address || null } : {}),
      ...(dto.emergencyContactName !== undefined ? { emergencyContactName: dto.emergencyContactName || null } : {}),
      ...(dto.emergencyContactPhone !== undefined ? { emergencyContactPhone: dto.emergencyContactPhone || null } : {}),
    }).where(eq(parents.id, parentId));
    return { updated: true };
  }

  /** Parents are archived, never hard-deleted, so their consent records stay (DPDP). */
  async removeParent(companyId: string, parentId: string) {
    const [p] = await this.db.select({ parent: parents, user: users }).from(parents).innerJoin(users, eq(users.id, parents.userId))
      .where(and(eq(parents.id, parentId), eq(parents.companyId, companyId), isNull(users.deletedAt)));
    if (!p) throw new NotFoundException('Parent not found');
    await this.db.delete(parentStudents).where(eq(parentStudents.parentId, parentId));
    await this.db.update(users).set({ active: false, deletedAt: new Date(), phone: this.archivedPhone(p.user.phone, p.user.id), email: null })
      .where(eq(users.id, p.user.id));
    this.guard.forget(p.user.id);
    return { archived: true };
  }

  async unlinkParentStudent(companyId: string, parentId: string, studentId: string) {
    const [p] = await this.db.select().from(parents).where(and(eq(parents.id, parentId), eq(parents.companyId, companyId)));
    if (!p) throw new NotFoundException('Parent not found');
    await this.db.delete(parentStudents).where(and(eq(parentStudents.parentId, parentId), eq(parentStudents.studentId, studentId)));
    return { unlinked: true };
  }

  async removeStudent(companyId: string, studentId: string) {
    await this.students.get(companyId, studentId);
    await this.db.delete(studentAssignments).where(eq(studentAssignments.studentId, studentId));
    const [{ n }] = await this.db.select({ n: count() }).from(tripStudents).where(eq(tripStudents.studentId, studentId));
    const [{ bills }] = await this.db.select({ bills: count() }).from(invoices).where(eq(invoices.studentId, studentId));
    if (n > 0 || bills > 0) {
      await this.db.delete(parentStudents).where(eq(parentStudents.studentId, studentId));
      await this.db.update(students).set({ status: 'INACTIVE', deletedAt: new Date(), activationCode: null }).where(eq(students.id, studentId));
      return { archived: true };
    }
    await this.db.delete(students).where(eq(students.id, studentId));
    return { deleted: true };
  }

  async removeRoute(companyId: string, routeId: string) {
    await this.routes.get(companyId, routeId);
    const [{ n }] = await this.db.select({ n: count() }).from(trips).where(eq(trips.routeId, routeId));
    if (n > 0) {
      await this.db.delete(studentAssignments).where(eq(studentAssignments.routeId, routeId));
      await this.db.update(routes).set({ active: false, deletedAt: new Date() }).where(eq(routes.id, routeId));
      return { archived: true };
    }
    await this.db.delete(routes).where(eq(routes.id, routeId));
    return { deleted: true };
  }

  async removeAssignment(companyId: string, routeId: string, studentId: string) {
    await this.routes.get(companyId, routeId);
    await this.db.delete(studentAssignments).where(and(eq(studentAssignments.routeId, routeId), eq(studentAssignments.studentId, studentId)));
    return { removed: true };
  }

  async removeBus(companyId: string, busId: string) {
    await this.buses.get(companyId, busId);
    await this.db.update(routes).set({ busId: null }).where(eq(routes.busId, busId));
    const [{ n }] = await this.db.select({ n: count() }).from(trips).where(eq(trips.busId, busId));
    if (n > 0) {
      await this.db.update(buses).set({ status: 'INACTIVE', deletedAt: new Date() }).where(eq(buses.id, busId));
      return { archived: true };
    }
    await this.db.delete(buses).where(eq(buses.id, busId));
    return { deleted: true };
  }

  async removeStop(companyId: string, stopId: string) {
    await this.stops.get(companyId, stopId);
    const used = await this.db.selectDistinct({ name: routes.name }).from(routeStops)
      .innerJoin(routes, eq(routes.id, routeStops.routeId))
      .where(and(eq(routeStops.stopId, stopId), isNull(routes.deletedAt)));
    if (used.length) throw new ConflictException(`Remove this stop from these routes first: ${used.map((r) => r.name).join(', ')}`);
    const [{ n }] = await this.db.select({ n: count() }).from(routeStops).where(eq(routeStops.stopId, stopId));
    if (n > 0) {
      await this.db.update(stops).set({ deletedAt: new Date() }).where(eq(stops.id, stopId));
      return { archived: true };
    }
    await this.db.delete(stops).where(eq(stops.id, stopId));
    return { deleted: true };
  }

  async removeSchool(companyId: string, schoolId: string) {
    await this.schools.get(companyId, schoolId);
    const [{ kids }] = await this.db.select({ kids: count() }).from(students)
      .where(and(eq(students.schoolId, schoolId), isNull(students.deletedAt)));
    const [{ live }] = await this.db.select({ live: count() }).from(routes)
      .where(and(eq(routes.schoolId, schoolId), isNull(routes.deletedAt)));
    if (kids || live) throw new ConflictException(`This school still has ${kids} student(s) and ${live} route(s). Delete or move them first.`);
    const [{ n }] = await this.db.select({ n: count() }).from(routes).where(eq(routes.schoolId, schoolId));
    const [{ m }] = await this.db.select({ m: count() }).from(students).where(eq(students.schoolId, schoolId));
    if (n || m) {
      await this.db.update(schools).set({ deletedAt: new Date() }).where(eq(schools.id, schoolId));
      return { archived: true };
    }
    await this.db.delete(holidays).where(eq(holidays.schoolId, schoolId));
    await this.db.delete(schools).where(eq(schools.id, schoolId));
    return { deleted: true };
  }

  async removeHoliday(companyId: string, id: string) {
    const rows = await this.db.delete(holidays).where(and(eq(holidays.id, id), eq(holidays.companyId, companyId))).returning();
    if (!rows.length) throw new NotFoundException('Holiday not found');
    return { deleted: true };
  }

  // ───────────── Dashboard and announcements ─────────────

  async dashboard(companyId: string) {
    const cfg = await this.settings.get(companyId);
    const today = zoned(new Date(), cfg.timezone).date;
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

    const countOf = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
    const [parentsN, studentsN, busesActive, driversN, routesN] = await Promise.all([
      countOf(this.db.select({ n: count() }).from(parents).innerJoin(users, eq(users.id, parents.userId)).where(and(eq(parents.companyId, companyId), isNull(users.deletedAt)))),
      countOf(this.db.select({ n: count() }).from(students).where(and(eq(students.companyId, companyId), eq(students.status, 'ACTIVE')))),
      countOf(this.db.select({ n: count() }).from(buses).where(and(eq(buses.companyId, companyId), eq(buses.status, 'ACTIVE'), isNull(buses.deletedAt)))),
      countOf(this.db.select({ n: count() }).from(users).where(and(eq(users.companyId, companyId), eq(users.role, 'DRIVER'), eq(users.active, true)))),
      countOf(this.db.select({ n: count() }).from(routes).where(and(eq(routes.companyId, companyId), eq(routes.active, true), isNull(routes.deletedAt)))),
    ]);

    const todayTrips = await this.db.select().from(trips).where(and(eq(trips.companyId, companyId), eq(trips.date, today), ne(trips.status, 'CANCELLED')));
    const statusCounts = todayTrips.length
      ? await this.db.select({ status: tripStudents.status, n: count() }).from(tripStudents)
        .where(inArray(tripStudents.tripId, todayTrips.map((t) => t.id))).groupBy(tripStudents.status)
      : [];
    const by = Object.fromEntries(statusCounts.map((s) => [s.status, s.n]));
    const held = todayTrips.length
      ? await this.db.select({ tripId: tripStudents.tripId, studentId: students.id, name: students.name, status: tripStudents.status })
        .from(tripStudents).innerJoin(students, eq(students.id, tripStudents.studentId))
        .where(and(inArray(tripStudents.tripId, todayTrips.map((t) => t.id)), inArray(tripStudents.status, ['HELD', 'NO_SHOW', 'RETURNED'])))
      : [];
    const running = todayTrips.filter((t) => t.status === 'IN_PROGRESS');
    const signalLost = running.filter((t) => !t.lastPositionAt || Date.now() - t.lastPositionAt.getTime() > cfg.signalLostSeconds * 1000);
    const openIncidents = await this.incidents.list(companyId, eq(incidents.status, 'OPEN'));
    const expiringBuses = await this.db.select().from(buses).where(and(eq(buses.companyId, companyId), or(
      and(isNotNull(buses.insuranceExpiry), lte(buses.insuranceExpiry, soon)),
      and(isNotNull(buses.fitnessExpiry), lte(buses.fitnessExpiry, soon)),
      and(isNotNull(buses.permitExpiry), lte(buses.permitExpiry, soon)),
    )));
    const expiringLicences = await this.db
      .select({ userId: users.id, name: users.name, licenseExpiry: staffProfiles.licenseExpiry })
      .from(staffProfiles).innerJoin(users, eq(users.id, staffProfiles.userId))
      .where(and(eq(staffProfiles.companyId, companyId), isNotNull(staffProfiles.licenseExpiry), lte(staffProfiles.licenseExpiry, soon)));

    return {
      date: today,
      totals: { parents: parentsN, students: studentsN, activeBuses: busesActive, drivers: driversN, activeRoutes: routesN },
      trips: {
        scheduled: todayTrips.length,
        running: running.length,
        completed: todayTrips.filter((t) => t.status === 'COMPLETED').length,
      },
      students: {
        travellingNow: by.BOARDED ?? 0,
        pickedUp: (by.BOARDED ?? 0) + (by.AT_SCHOOL ?? 0),
        droppedOff: (by.AT_SCHOOL ?? 0) + (by.HANDED_OVER ?? 0) + (by.DROPPED_ALONE ?? 0),
        absent: by.ABSENT ?? 0,
      },
      alerts: {
        needsAttention: held,
        signalLost: signalLost.map((t) => ({ tripId: t.id, busId: t.busId, lastPositionAt: t.lastPositionAt })),
        emptyBusCheckMissing: todayTrips.filter((t) => t.status === 'COMPLETED' && !t.emptyBusCheckedAt).map((t) => t.id),
        openIncidents,
      },
      expiring: { buses: expiringBuses, licences: expiringLicences },
      liveBuses: running.map((t) => ({ tripId: t.id, busId: t.busId, lat: t.lastLat, lng: t.lastLng, speedKmh: t.lastSpeedKmh, at: t.lastPositionAt })),
    };
  }

  async announce(companyId: string, dto: AnnouncementDto) {
    let studentIds: string[];
    if (dto.routeId) {
      await this.routes.get(companyId, dto.routeId);
      studentIds = (await this.db.select({ id: studentAssignments.studentId }).from(studentAssignments)
        .where(eq(studentAssignments.routeId, dto.routeId))).map((r) => r.id);
    } else {
      const where = dto.schoolId
        ? and(eq(students.companyId, companyId), eq(students.schoolId, dto.schoolId))
        : eq(students.companyId, companyId);
      studentIds = (await this.db.select({ id: students.id }).from(students).where(where)).map((r) => r.id);
    }
    const userIds = await this.notifications.parentUserIds(studentIds);
    await this.notifications.notify({
      companyId, userIds, type: 'ANNOUNCEMENT', title: dto.title, body: dto.body, safety: dto.important ?? false,
    });
    return { recipients: new Set(userIds).size };
  }

  async tripsForDate(companyId: string, date: string) {
    return this.db.select({ trip: trips, routeName: routes.name, busNumber: buses.registrationNumber })
      .from(trips).innerJoin(routes, eq(routes.id, trips.routeId)).innerJoin(buses, eq(buses.id, trips.busId))
      .where(and(eq(trips.companyId, companyId), eq(trips.date, date), ne(trips.status, 'CANCELLED'))).orderBy(asc(routes.name), asc(trips.direction));
  }

  async studentHistory(companyId: string, studentId: string, from: string, to: string) {
    await this.students.get(companyId, studentId);
    return this.db.select({ date: trips.date, direction: trips.direction, status: tripStudents.status, tripId: trips.id })
      .from(tripStudents).innerJoin(trips, eq(trips.id, tripStudents.tripId))
      .where(and(eq(tripStudents.studentId, studentId), gte(trips.date, from), lte(trips.date, to)))
      .orderBy(asc(trips.date));
  }
}
