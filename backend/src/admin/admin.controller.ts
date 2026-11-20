import {
  Body, Controller, Delete, Get, HttpCode, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Put, Query,
  BadRequestException,
} from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { eq } from 'drizzle-orm';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles, tenantOf } from '../common/auth';
import { ISO_DATE } from '../common/time';
import { Db, InjectDb } from '../db/db.module';
import { holidays } from '../db/schema';
import { TrackingService } from '../trips/tracking.service';
import { TripAccessService } from '../trips/trip-access.service';
import { TripsService } from '../trips/trips.service';
import { AdminService } from './admin.service';
import {
  AnnouncementDto, AssignmentsDto, AuthorizedAdultDto, BusDto, CompanyDto, GenerateTripsDto, HolidayDto,
  LinkStudentDto, OverrideDto, ParentDto, RouteDto, RouteStopsDto, SchoolDto, StaffDto, StopDto, StudentDto,
} from './dto';

class UpdateSchoolDto extends PartialType(SchoolDto) {}
class UpdateStopDto extends PartialType(StopDto) {}
class UpdateBusDto extends PartialType(BusDto) {}
class UpdateRouteDto extends PartialType(RouteDto) {}
class UpdateStudentDto extends PartialType(StudentDto) {}
class UpdateStaffDto extends PartialType(StaffDto) {}
class UpdateParentDto extends PartialType(ParentDto) {}

const uuid = new ParseUUIDPipe();

function dateParam(value: string | undefined, fallback?: string): string {
  const v = value ?? fallback;
  if (!v || !ISO_DATE.test(v)) throw new BadRequestException('Use date=YYYY-MM-DD');
  return v;
}

@Controller('platform')
@Roles('SUPER_ADMIN')
export class PlatformController {
  constructor(private readonly admin: AdminService) {}

  @Post('companies')
  createCompany(@Body() dto: CompanyDto) {
    return this.admin.createCompany(dto);
  }
}

@Controller('admin')
@Roles(...ADMIN_ROLES)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly tripsService: TripsService,
    private readonly tracking: TrackingService,
    private readonly access: TripAccessService,
    @InjectDb() private readonly db: Db,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentUser() u: AuthUser) {
    return this.admin.dashboard(tenantOf(u));
  }

  @Get('approvals')
  approvals(@CurrentUser() u: AuthUser) {
    return this.admin.pendingApprovals(tenantOf(u));
  }

  // Schools
  @Get('schools') listSchools(@CurrentUser() u: AuthUser) { return this.admin.schools.list(tenantOf(u)); }
  @Post('schools') createSchool(@CurrentUser() u: AuthUser, @Body() dto: SchoolDto) { return this.admin.schools.create(tenantOf(u), { ...dto }); }
  @Get('schools/:id') getSchool(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.schools.get(tenantOf(u), id); }
  @Patch('schools/:id') updateSchool(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateSchoolDto) { return this.admin.schools.update(tenantOf(u), id, { ...dto }); }
  @Delete('schools/:id') deleteSchool(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeSchool(tenantOf(u), id); }

  // Holidays (no trips are generated on these days)
  @Get('holidays') listHolidays(@CurrentUser() u: AuthUser) {
    return this.db.select().from(holidays).where(eq(holidays.companyId, tenantOf(u)));
  }
  @Post('holidays') async createHoliday(@CurrentUser() u: AuthUser, @Body() dto: HolidayDto) {
    const companyId = tenantOf(u);
    if (dto.schoolId) await this.admin.schools.get(companyId, dto.schoolId);
    const [row] = await this.db.insert(holidays).values({ ...dto, companyId }).returning();
    return row;
  }

  @Delete('holidays/:id') deleteHoliday(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeHoliday(tenantOf(u), id); }

  // Stops
  @Get('stops') listStops(@CurrentUser() u: AuthUser) { return this.admin.stops.list(tenantOf(u)); }
  @Post('stops') createStop(@CurrentUser() u: AuthUser, @Body() dto: StopDto) { return this.admin.stops.create(tenantOf(u), { ...dto }); }
  @Patch('stops/:id') updateStop(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateStopDto) { return this.admin.stops.update(tenantOf(u), id, { ...dto }); }
  @Delete('stops/:id') deleteStop(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeStop(tenantOf(u), id); }

  // Buses
  @Get('buses') listBuses(@CurrentUser() u: AuthUser) { return this.admin.buses.list(tenantOf(u)); }
  @Post('buses') createBus(@CurrentUser() u: AuthUser, @Body() dto: BusDto) { return this.admin.buses.create(tenantOf(u), { ...dto }); }
  @Get('buses/:id') getBus(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.buses.get(tenantOf(u), id); }
  @Patch('buses/:id') updateBus(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateBusDto) { return this.admin.buses.update(tenantOf(u), id, { ...dto }); }
  @Delete('buses/:id') deleteBus(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeBus(tenantOf(u), id); }

  // Staff: drivers, attendants, office users
  @Get('staff') listStaff(@CurrentUser() u: AuthUser) { return this.admin.listStaff(tenantOf(u)); }
  @Post('staff') createStaff(@CurrentUser() u: AuthUser, @Body() dto: StaffDto) { return this.admin.createStaff(tenantOf(u), dto); }
  @Patch('staff/:id') updateStaff(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateStaffDto) { return this.admin.updateStaff(tenantOf(u), id, dto); }
  @Delete('staff/:id') deleteStaff(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeStaff(tenantOf(u), id, u.sub); }
  @Post('users/:id/active/:active') @HttpCode(200)
  setActive(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('active', ParseBoolPipe) active: boolean) {
    return this.admin.setUserActive(tenantOf(u), id, active);
  }

  // Routes
  @Get('routes') listRoutes(@CurrentUser() u: AuthUser) { return this.admin.routes.list(tenantOf(u)); }
  @Post('routes') createRoute(@CurrentUser() u: AuthUser, @Body() dto: RouteDto) { return this.admin.createRoute(tenantOf(u), dto); }
  @Get('routes/:id') getRoute(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.routeDetail(tenantOf(u), id); }
  @Patch('routes/:id') updateRoute(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateRouteDto) { return this.admin.updateRoute(tenantOf(u), id, dto); }
  @Put('routes/:id/stops') setStops(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: RouteStopsDto) { return this.admin.setRouteStops(tenantOf(u), id, dto); }
  @Delete('routes/:id') deleteRoute(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeRoute(tenantOf(u), id); }
  @Delete('routes/:id/assignments/:studentId') unassign(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('studentId', uuid) sid: string) {
    return this.admin.removeAssignment(tenantOf(u), id, sid);
  }
  @Put('routes/:id/assignments') assign(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AssignmentsDto) { return this.admin.assignStudents(tenantOf(u), id, dto); }

  // Students
  @Get('students') listStudents(@CurrentUser() u: AuthUser) { return this.admin.students.list(tenantOf(u)); }
  @Post('students') createStudent(@CurrentUser() u: AuthUser, @Body() dto: StudentDto) { return this.admin.createStudent(tenantOf(u), dto); }
  @Get('students/:id') getStudent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.studentDetail(tenantOf(u), id); }
  @Delete('students/:id') deleteStudent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeStudent(tenantOf(u), id); }
  @Patch('students/:id') updateStudent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateStudentDto) { return this.admin.updateStudent(tenantOf(u), id, dto); }
  @Post('students/:id/approve') @HttpCode(200)
  approveStudent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.updateStudent(tenantOf(u), id, { status: 'ACTIVE' }); }
  @Get('students/:id/history')
  history(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.studentHistory(tenantOf(u), id, dateParam(from, '2000-01-01'), dateParam(to, '2999-12-31'));
  }
  @Post('students/:id/authorized-adults')
  addAdult(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AuthorizedAdultDto) { return this.admin.addAuthorizedAdult(tenantOf(u), id, dto); }
  @Post('students/:id/authorized-adults/:adultId/approve') @HttpCode(200)
  approveAdult(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('adultId', uuid) adultId: string) {
    return this.admin.setAuthorizedAdultApproval(tenantOf(u), id, adultId, true);
  }
  @Post('students/:id/authorized-adults/:adultId/revoke') @HttpCode(200)
  revokeAdult(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('adultId', uuid) adultId: string) {
    return this.admin.setAuthorizedAdultApproval(tenantOf(u), id, adultId, false);
  }

  // Parents
  @Get('parents') listParents(@CurrentUser() u: AuthUser) { return this.admin.listParents(tenantOf(u)); }
  @Post('parents') createParent(@CurrentUser() u: AuthUser, @Body() dto: ParentDto) { return this.admin.createParent(tenantOf(u), dto); }
  @Patch('parents/:id') updateParent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdateParentDto) { return this.admin.updateParent(tenantOf(u), id, dto); }
  @Delete('parents/:id') deleteParent(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.admin.removeParent(tenantOf(u), id); }
  @Delete('parents/:id/children/:studentId') unlink(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('studentId', uuid) sid: string) {
    return this.admin.unlinkParentStudent(tenantOf(u), id, sid);
  }
  @Post('parents/:id/children') @HttpCode(200)
  link(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: LinkStudentDto) {
    return this.admin.linkParentStudent(tenantOf(u), id, dto.studentId, dto.relation);
  }

  // Trips
  @Post('trips/generate') @HttpCode(200)
  generate(@CurrentUser() u: AuthUser, @Body() dto: GenerateTripsDto) { return this.tripsService.generateForDate(tenantOf(u), dto.date); }
  @Get('trips') listTrips(@CurrentUser() u: AuthUser, @Query('date') date?: string) { return this.admin.tripsForDate(tenantOf(u), dateParam(date)); }
  @Get('trips/:id') async trip(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tripsService.sheet(await this.access.getForCompany(id, tenantOf(u)));
  }
  @Get('trips/:id/track') async track(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.tracking.history(await this.access.getForCompany(id, tenantOf(u)));
  }
  @Post('trips/:id/cancel') @HttpCode(200)
  cancelTrip(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.tripsService.cancel(id, u); }
  @Delete('trips/:id') deleteTrip(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.tripsService.remove(id, u); }
  @Post('trips/:id/students/:studentId/override') @HttpCode(200)
  override(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Param('studentId', uuid) studentId: string, @Body() dto: OverrideDto) {
    return this.tripsService.overrideStatus(id, studentId, u, dto.toStatus, dto.note);
  }

  // Incidents and announcements
  @Get('incidents') listIncidents(@CurrentUser() u: AuthUser) { return this.admin.incidents.list(tenantOf(u)); }
  @Post('incidents/:id/resolve') @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.admin.incidents.update(tenantOf(u), id, { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: u.sub });
  }
  @Post('announcements') @HttpCode(200)
  announce(@CurrentUser() u: AuthUser, @Body() dto: AnnouncementDto) { return this.admin.announce(tenantOf(u), dto); }
}

