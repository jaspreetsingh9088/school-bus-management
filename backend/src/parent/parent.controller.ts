import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { ISO_DATE } from '../common/time';
import { IncidentsService } from '../trips/incidents.service';
import { TrackingService } from '../trips/tracking.service';
import { ParentService } from './parent.service';
import { IncidentDto } from '../crew/crew.controller';

class ConsentDto {
  @IsString() version: string;
}

class ChildDto {
  @IsUUID() schoolId: string;
  @IsString() @IsNotEmpty() @MaxLength(120) name: string;
  @IsOptional() @IsString() className?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() homeAddress?: string;
  @IsOptional() @IsString() photoUrl?: string;
}

class LinkDto {
  @IsString() @IsNotEmpty() activationCode: string;
  @IsOptional() @IsString() relation?: string;
}

class AbsenceDto {
  @IsUUID() studentId: string;
  @Matches(ISO_DATE, { message: 'Use YYYY-MM-DD' }) date: string;
  /** Leave out for the whole day */
  @IsOptional() @IsIn(['MORNING', 'AFTERNOON']) direction?: 'MORNING' | 'AFTERNOON';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

class AdultDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() relation: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() photoUrl?: string;
}

class AloneDto {
  @IsBoolean() allowed: boolean;
}

const uuid = new ParseUUIDPipe();

/** Parent app. */
@Controller('parent')
@Roles('PARENT')
export class ParentController {
  constructor(
    private readonly parent: ParentService,
    private readonly tracking: TrackingService,
    private readonly incidents: IncidentsService,
  ) {}

  @Get('me') me(@CurrentUser() u: AuthUser) { return this.parent.me(u); }
  @Post('consent') @HttpCode(200) consent(@CurrentUser() u: AuthUser, @Body() dto: ConsentDto) { return this.parent.giveConsent(u, dto.version); }
  @Get('schools') schools(@CurrentUser() u: AuthUser) { return this.parent.schools(u); }

  @Get('children') children(@CurrentUser() u: AuthUser) { return this.parent.children(u); }
  @Post('children') addChild(@CurrentUser() u: AuthUser, @Body() dto: ChildDto) { return this.parent.addChild(u, dto); }
  @Post('children/link') @HttpCode(200) link(@CurrentUser() u: AuthUser, @Body() dto: LinkDto) { return this.parent.linkWithCode(u, dto.activationCode, dto.relation); }
  @Get('children/:id/today') today(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.parent.today(u, id); }
  @Get('children/:id/absences') absences(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.parent.listAbsences(u, id); }
  @Get('children/:id/authorized-adults') adults(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.parent.listAuthorizedAdults(u, id); }
  @Post('children/:id/authorized-adults') addAdult(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AdultDto) {
    return this.parent.proposeAuthorizedAdult(u, id, dto);
  }
  @Post('children/:id/go-home-alone') @HttpCode(200) alone(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string, @Body() dto: AloneDto) {
    return this.parent.setGoHomeAlone(u, id, dto.allowed);
  }

  @Post('absences') addAbsence(@CurrentUser() u: AuthUser, @Body() dto: AbsenceDto) { return this.parent.addAbsence(u, dto); }
  @Delete('absences/:id') cancelAbsence(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.parent.cancelAbsence(u, id); }

  /** Live bus position, route and ETA to the child's stop. Only while the trip runs. */
  @Get('trips/:id/live') live(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.tracking.liveForParent(id, u); }

  @Get('notifications') notifications(@CurrentUser() u: AuthUser) { return this.parent.notifications(u); }
  @Post('notifications/:id/read') @HttpCode(200) read(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) { return this.parent.markRead(u, id); }

  @Post('sos') sos(@CurrentUser() u: AuthUser, @Body() dto: IncidentDto) { return this.incidents.raise(u, { ...dto, type: 'SOS' }); }
}
