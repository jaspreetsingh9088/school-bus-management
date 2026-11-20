import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AuthUser } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { distanceM, isValidLatLng, LatLng } from '../common/geo';
import { CompanySettings } from '../common/settings';
import { Db, InjectDb } from '../db/db.module';
import { gpsPoints, routes, routeStops, schools, stops, trips, tripStopEvents, tripStudents } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TripAccessService, TripRow } from './trip-access.service';

export interface PositionInput {
  lat: number;
  lng: number;
  speedKmh?: number;
  heading?: number;
  accuracyM?: number;
  recordedAt: string;
}

interface StopOnRoute {
  routeStopId: string;
  sequence: number;
  name: string;
  lat: number;
  lng: number;
  arrivedAt: Date | null;
  approachNotified: boolean;
}

export interface StopEta {
  routeStopId: string;
  name: string;
  distanceM: number;
  etaSeconds: number;
}

/** Estimated road distance and time to each stop not yet reached, in route order. */
export function estimateEtas(pos: LatLng, remaining: StopOnRoute[], cfg: Pick<CompanySettings, 'avgSpeedKmh' | 'roadFactor'>): StopEta[] {
  const metresPerSecond = (cfg.avgSpeedKmh * 1000) / 3600;
  let from = pos;
  let cumulative = 0;
  return remaining.map((s) => {
    cumulative += distanceM(from, s) * cfg.roadFactor;
    from = s;
    return { routeStopId: s.routeStopId, name: s.name, distanceM: Math.round(cumulative), etaSeconds: Math.round(cumulative / metresPerSecond) };
  });
}

/**
 * GPS intake, stop detection, "approaching" alerts and ETAs.
 * ETAs are computed here, once per bus, never by each parent's phone (Requirements v2, 11.1).
 * A routing API (Google Routes) can replace estimateEtas() without touching the apps.
 */
@Injectable()
export class TrackingService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: TripAccessService,
    private readonly settings: CompanySettingsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async ingest(tripId: string, user: AuthUser, points: PositionInput[]) {
    const trip = await this.access.getForCrew(tripId, user);
    if (trip.status !== 'IN_PROGRESS') throw new ConflictException('Trip is not running');
    const valid = points
      .filter((p) => isValidLatLng(p) && !Number.isNaN(Date.parse(p.recordedAt)))
      .map((p) => ({ ...p, at: new Date(p.recordedAt) }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    if (!valid.length) throw new BadRequestException('No valid positions');

    await this.db.insert(gpsPoints).values(valid.map((p) => ({
      tripId: trip.id, lat: p.lat, lng: p.lng, speedKmh: p.speedKmh, heading: p.heading, accuracyM: p.accuracyM, recordedAt: p.at,
    })));

    const latest = valid[valid.length - 1];
    if (trip.lastPositionAt && trip.lastPositionAt >= latest.at) {
      return { stored: valid.length, live: false }; // late upload of older points: history only
    }
    const [updated] = await this.db.update(trips).set({
      lastLat: latest.lat, lastLng: latest.lng, lastSpeedKmh: latest.speedKmh ?? null, lastPositionAt: latest.at,
    }).where(eq(trips.id, trip.id)).returning();

    const cfg = await this.settings.get(trip.companyId);
    const etas = await this.checkStops(updated, latest, cfg);
    const payload = {
      tripId: trip.id, lat: latest.lat, lng: latest.lng, speedKmh: latest.speedKmh ?? null, heading: latest.heading ?? null,
      at: latest.at, etas,
    };
    this.realtime.toTrip(trip.id, 'bus:position', payload);
    this.realtime.toCompany(trip.companyId, 'bus:position', payload);
    return { stored: valid.length, live: true };
  }

  private async routeStopsFor(trip: TripRow): Promise<StopOnRoute[]> {
    const rows = await this.db
      .select({ rs: routeStops, stop: stops, ev: tripStopEvents })
      .from(routeStops)
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .leftJoin(tripStopEvents, and(eq(tripStopEvents.routeStopId, routeStops.id), eq(tripStopEvents.tripId, trip.id)))
      .where(eq(routeStops.routeId, trip.routeId))
      .orderBy(asc(routeStops.sequence));
    return rows.map(({ rs, stop, ev }) => ({
      routeStopId: rs.id, sequence: rs.sequence, name: stop.name, lat: stop.lat, lng: stop.lng,
      arrivedAt: ev?.arrivedAt ?? null, approachNotified: ev?.approachNotified ?? false,
    }));
  }

  /** Stops after the last one reached. */
  private remaining(all: StopOnRoute[]): StopOnRoute[] {
    const lastReached = all.reduce((max, s) => (s.arrivedAt ? Math.max(max, s.sequence) : max), -Infinity);
    return all.filter((s) => s.sequence > lastReached && !s.arrivedAt);
  }

  private async checkStops(trip: TripRow, pos: LatLng & { at: Date }, cfg: CompanySettings): Promise<StopEta[]> {
    const all = await this.routeStopsFor(trip);
    const ahead = this.remaining(all);
    const etas = estimateEtas(pos, ahead, cfg);
    // Children waiting at a stop: morning = not yet boarded; afternoon = on the bus.
    const waitingStatus = trip.direction === 'MORNING' ? 'SCHEDULED' : 'BOARDED';

    for (const eta of etas) {
      const stop = ahead.find((s) => s.routeStopId === eta.routeStopId)!;
      const straight = distanceM(pos, stop);
      // Any stop ahead counts, so a stop skipped (no children due) doesn't stall detection.
      const arrived = straight <= cfg.arrivalRadiusM;
      const approaching = !stop.approachNotified && eta.distanceM <= cfg.approachDistanceM;
      if (!arrived && !approaching) continue;

      const set = arrived ? { arrivedAt: pos.at, approachNotified: true } : { approachNotified: true };
      await this.db.update(tripStopEvents).set(set)
        .where(and(eq(tripStopEvents.tripId, trip.id), eq(tripStopEvents.routeStopId, stop.routeStopId)));
      if (arrived) stop.arrivedAt = pos.at;

      const kids = await this.db.select({ studentId: tripStudents.studentId }).from(tripStudents)
        .where(and(eq(tripStudents.tripId, trip.id), eq(tripStudents.routeStopId, stop.routeStopId), eq(tripStudents.status, waitingStatus)));
      if (!kids.length) continue;
      const minutes = Math.max(1, Math.round(eta.etaSeconds / 60));
      await this.notifications.notify({
        companyId: trip.companyId,
        userIds: await this.notifications.parentUserIds(kids.map((k) => k.studentId)),
        type: arrived ? 'BUS_ARRIVED' : 'BUS_APPROACHING',
        title: arrived ? `The bus has arrived at ${stop.name}` : `The bus is about ${minutes} min away`,
        body: arrived ? 'Please be at the stop.' : `Approaching ${stop.name}, about ${(eta.distanceM / 1000).toFixed(1)} km away.`,
        data: { tripId: trip.id, routeStopId: stop.routeStopId },
      });
    }
    return arrivedFiltered(etas, ahead);
  }

  /** What a parent's tracking screen shows (spec 6, live tracking). */
  async liveForParent(tripId: string, user: AuthUser) {
    const { trip, studentIds } = await this.access.getForParent(tripId, user);
    const cfg = await this.settings.get(trip.companyId);
    const all = await this.routeStopsFor(trip);
    const ahead = this.remaining(all);
    const [route] = await this.db.select({ school: schools }).from(routes)
      .innerJoin(schools, eq(schools.id, routes.schoolId)).where(eq(routes.id, trip.routeId));
    const mine = await this.db.select().from(tripStudents)
      .where(and(eq(tripStudents.tripId, trip.id), inArray(tripStudents.studentId, studentIds)));

    const pos = trip.lastLat !== null && trip.lastLng !== null ? { lat: trip.lastLat, lng: trip.lastLng } : null;
    const etas = pos ? estimateEtas(pos, ahead, cfg) : [];
    const ageSeconds = trip.lastPositionAt ? Math.round((Date.now() - trip.lastPositionAt.getTime()) / 1000) : null;
    const school = route.school.lat !== null && route.school.lng !== null ? { lat: route.school.lat, lng: route.school.lng } : null;

    let toSchool: { distanceM: number; etaSeconds: number } | null = null;
    if (pos && school && trip.direction === 'MORNING') {
      const path = estimateEtas(pos, [...ahead, { routeStopId: 'school', sequence: Infinity, name: route.school.name, ...school, arrivedAt: null, approachNotified: false }], cfg);
      const last = path[path.length - 1];
      toSchool = { distanceM: last.distanceM, etaSeconds: last.etaSeconds };
    }

    return {
      tripId: trip.id,
      direction: trip.direction,
      bus: pos && { ...pos, speedKmh: trip.lastSpeedKmh, updatedAt: trip.lastPositionAt, ageSeconds },
      /** Show "signal lost" instead of a frozen bus (spec 6) */
      signalLost: ageSeconds === null || ageSeconds > cfg.signalLostSeconds,
      route: all.map((s) => ({ routeStopId: s.routeStopId, name: s.name, lat: s.lat, lng: s.lng, reached: !!s.arrivedAt })),
      school: { name: route.school.name, ...school },
      toSchool,
      children: mine.map((m) => {
        const stop = all.find((s) => s.routeStopId === m.routeStopId);
        const eta = etas.find((e) => e.routeStopId === m.routeStopId);
        return {
          studentId: m.studentId, status: m.status, stop: stop && { routeStopId: stop.routeStopId, name: stop.name, lat: stop.lat, lng: stop.lng },
          busReachedStop: !!stop?.arrivedAt, etaSeconds: eta?.etaSeconds ?? null, distanceM: eta?.distanceM ?? null,
        };
      }),
    };
  }

  /** GPS history for replay on the admin map. */
  async history(trip: TripRow) {
    return this.db.select({ lat: gpsPoints.lat, lng: gpsPoints.lng, speedKmh: gpsPoints.speedKmh, at: gpsPoints.recordedAt })
      .from(gpsPoints).where(eq(gpsPoints.tripId, trip.id)).orderBy(asc(gpsPoints.recordedAt));
  }
}

/** Drop a stop from the ETA list once the bus has reached it. */
function arrivedFiltered(etas: StopEta[], ahead: StopOnRoute[]): StopEta[] {
  return etas.filter((e) => !ahead.find((s) => s.routeStopId === e.routeStopId)?.arrivedAt);
}
