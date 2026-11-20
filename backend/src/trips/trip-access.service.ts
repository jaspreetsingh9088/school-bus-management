import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { ADMIN_ROLES, AuthUser } from '../common/auth';
import { Db, InjectDb } from '../db/db.module';
import { parents, parentStudents, trips, tripStudents } from '../db/schema';

export type TripRow = typeof trips.$inferSelect;

/** Who may see or act on a trip. Parents see only trips carrying their child, and only while they run (spec 3, 10). */
@Injectable()
export class TripAccessService {
  constructor(@InjectDb() private readonly db: Db) {}

  async getForCompany(tripId: string, companyId: string | null): Promise<TripRow> {
    if (!companyId) throw new NotFoundException('Trip not found');
    const [trip] = await this.db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)));
    if (!trip) throw new NotFoundException('Trip not found');
    return trip;
  }

  /** Crew member assigned to this trip. */
  async getForCrew(tripId: string, user: AuthUser): Promise<TripRow> {
    const trip = await this.getForCompany(tripId, user.companyId);
    if (trip.driverId !== user.sub && trip.attendantId !== user.sub) throw new ForbiddenException('Not your trip');
    return trip;
  }

  /** Parent of a child on this trip, while the trip is running. Returns the parent's children on the trip. */
  async getForParent(tripId: string, user: AuthUser): Promise<{ trip: TripRow; studentIds: string[] }> {
    const trip = await this.getForCompany(tripId, user.companyId);
    const rows = await this.db
      .select({ studentId: tripStudents.studentId })
      .from(tripStudents)
      .innerJoin(parentStudents, eq(parentStudents.studentId, tripStudents.studentId))
      .innerJoin(parents, eq(parents.id, parentStudents.parentId))
      .where(and(eq(tripStudents.tripId, tripId), eq(parents.userId, user.sub)));
    if (!rows.length) throw new NotFoundException('Trip not found');
    if (trip.status !== 'IN_PROGRESS') throw new ForbiddenException('Tracking is available only while the trip is running');
    return { trip, studentIds: rows.map((r) => r.studentId) };
  }

  /** Used by the real-time channel before joining a trip room. */
  async canWatch(tripId: string, user: AuthUser): Promise<boolean> {
    try {
      if (ADMIN_ROLES.includes(user.role)) await this.getForCompany(tripId, user.companyId);
      else if (user.role === 'PARENT') await this.getForParent(tripId, user);
      else await this.getForCrew(tripId, user);
      return true;
    } catch {
      return false;
    }
  }
}
