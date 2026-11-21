import { Injectable, Logger } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { routes, routeStops, schools, stops } from '../db/schema';

/**
 * Works out the road a route follows, so maps show real streets instead of straight lines.
 * Uses the free OSRM server by default (fine for demos); set ROUTING_URL to your own OSRM
 * or swap in Google Directions later. If routing fails, maps fall back to straight lines.
 */
@Injectable()
export class RoutePathService {
  private readonly log = new Logger(RoutePathService.name);
  private readonly base = (process.env.ROUTING_URL ?? 'https://router.project-osrm.org').replace(/\/$/, '');

  /** Points in driving order: morning = stops then school; afternoon = school then stops. */
  async waypoints(routeId: string): Promise<[number, number][]> {
    const [route] = await this.db.select({ r: routes, school: schools }).from(routes)
      .innerJoin(schools, eq(schools.id, routes.schoolId)).where(eq(routes.id, routeId));
    if (!route) return [];
    const list = await this.db.select({ lat: stops.lat, lng: stops.lng }).from(routeStops)
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .where(eq(routeStops.routeId, routeId)).orderBy(asc(routeStops.sequence));
    const pts: [number, number][] = list.map((s) => [s.lat, s.lng]);
    const school = route.school.lat !== null && route.school.lng !== null ? ([route.school.lat, route.school.lng] as [number, number]) : null;
    if (school) route.r.direction === 'MORNING' ? pts.push(school) : pts.unshift(school);
    return pts;
  }

  /** Recalculates and stores the route's road path. Never throws. */
  async refresh(routeId: string): Promise<[number, number][]> {
    const pts = await this.waypoints(routeId);
    let path: [number, number][] | null = null;
    if (pts.length >= 2 && process.env.ROUTING !== 'off') {
      try {
        const coords = pts.map(([lat, lng]) => `${lng},${lat}`).join(';');
        const res = await fetch(`${this.base}/route/v1/driving/${coords}?overview=full&geometries=geojson`, {
          signal: AbortSignal.timeout(8000),
          headers: { 'user-agent': 'school-bus-management' },
        });
        const data = (await res.json()) as { code?: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
        if (data.code === 'Ok' && data.routes?.[0]) {
          path = data.routes[0].geometry.coordinates.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
        }
      } catch (e) {
        this.log.warn(`Road routing failed for route ${routeId}: ${(e as Error).message}`);
      }
    }
    // [] = tried and failed (or too few points): maps draw straight lines, and we don't retry on every view.
    await this.db.update(routes).set({ path: path ?? [] }).where(eq(routes.id, routeId));
    return path ?? [];
  }

  constructor(@InjectDb() private readonly db: Db) {}
}
