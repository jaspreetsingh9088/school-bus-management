import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsISO8601, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString,
  IsUUID, MaxLength, ValidateNested,
} from 'class-validator';
import { and, asc, eq, ne, or } from 'drizzle-orm';
import { AuthUser, CREW_ROLES, CurrentUser, Roles, tenantOf } from '../common/auth';
import { CompanySettingsService } from '../common/company-settings.service';
import { zoned } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import { buses, routes, trips } from '../db/schema';
import { IncidentsService } from '../trips/incidents.service';
import { TrackingService } from '../trips/tracking.service';
import { TripAccessService } from '../trips/trip-access.service';
import { TripsService } from '../trips/trips.service';

class PositionDto {
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
  @IsOptional() @IsNumber() speedKmh?: number;
  @IsOptional() @IsNumber() heading?: number;
  @IsOptional() @IsNumber() accuracyM?: number;
  @IsISO8601() recordedAt: string;
}

class PositionsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PositionDto)
  points: PositionDto[];
}

class StudentEventDto {
  @IsString() @MaxLength(100) clientEventId: string;
  @IsUUID() studentId: string;
  @IsIn(['BOARDED', 'NO_SHOW', 'AT_SCHOOL', 'HANDED_OVER', 'DROPPED_ALONE', 'HELD', 'RETURNED'])
  toStatus: 'BOARDED' | 'NO_SHOW' | 'AT_SCHOOL' | 'HANDED_OVER' | 'DROPPED_ALONE' | 'HELD' | 'RETURNED';
  @IsISO8601() occurredAt: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsUUID() authorizedAdultId?: string;
  @IsOptional() @IsUUID() receivedByParentId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class StudentEventsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => StudentEventDto)
  events: StudentEventDto[];
}

export class IncidentDto {
  @IsIn(['SOS', 'BREAKDOWN', 'DELAY', 'ACCIDENT', 'OTHER']) type: 'SOS' | 'BREAKDOWN' | 'DELAY' | 'ACCIDENT' | 'OTHER';
  @IsOptional() @IsUUID() tripId?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsString() photoUrl?: string;
}

const uuid = new ParseUUIDPipe();

/** Driver and attendant app. */
@Controller('crew')
@Roles(...CREW_ROLES)
export class CrewController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tripsService: TripsService,
    private readonly tracking: TrackingService,
    private readonly access: TripAccessService,
    private readonly incidents: IncidentsService,
    private readonly settings: CompanySettingsService,
  ) {}

  @Get('trips/today')
  async today(@CurrentUser() u: AuthUser) {
    const cfg = await this.settings.get(tenantOf(u));
    const date = zoned(new Date(), cfg.timezone).date;
    await this.tripsService.ensureTrips(tenantOf(u), date);
    return this.db
      .select({ trip: trips, routeName: routes.name, busNumber: buses.registrationNumber })
      .from(trips).innerJoin(routes, eq(routes.id, trips.routeId)).innerJoin(buses, eq(buses.id, trips.busId))
      .where(and(eq(trips.companyId, tenantOf(u)), eq(trips.date, date), ne(trips.status, 'CANCELLED'), or(eq(trips.driverId, u.sub), eq(trips.attendantId, u.sub))))
      .orderBy(asc(trips.direction));
  }

  @Get('trips/:id')
  async sheet(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.sheet(await this.access.getForCrew(id, u));
  }

  @Post('trips/:id/start') @HttpCode(200)
  start(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.start(id, u);
  }

  /** Send GPS points in batches; points saved offline can be sent late and are kept in history. */
  @Post('trips/:id/positions') @HttpCode(200)
  positions(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: PositionsDto) {
    return this.tracking.ingest(id, u, dto.points);
  }

  @Post('trips/:id/stops/:routeStopId/arrive') @HttpCode(200)
  arrive(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('routeStopId', uuid) routeStopId: string) {
    return this.tripsService.markStopArrival(id, routeStopId, u);
  }

  /** Boarding, drop-off, no-show and hold events. Each has a clientEventId so retries are safe. */
  @Post('trips/:id/student-events') @HttpCode(200)
  events(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: StudentEventsDto) {
    return this.tripsService.applyStudentEvents(id, u, dto.events);
  }

  @Post('trips/:id/arrive-school') @HttpCode(200)
  arriveSchool(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.arriveAtSchool(id, u);
  }

  @Post('trips/:id/empty-bus-check') @HttpCode(200)
  emptyBus(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.emptyBusCheck(id, u);
  }

  @Post('trips/:id/end') @HttpCode(200)
  end(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.end(id, u);
  }

  @Post('incidents')
  incident(@CurrentUser() u: AuthUser, @Body() dto: IncidentDto) {
    return this.incidents.raise(u, dto);
  }
}
