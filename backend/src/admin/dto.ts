import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { HHMM, ISO_DATE } from '../common/time';

const DATE_MSG = { message: 'Use YYYY-MM-DD' };

export class CompanyDto {
  @IsString() @IsNotEmpty() name: string;
  @Matches(/^[a-z0-9-]{3,40}$/) slug: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() gstin?: string;
  /** First company admin */
  @IsString() adminName: string;
  @IsEmail() adminEmail: string;
  @IsString() adminPhone: string;
  @IsString() @MaxLength(200) adminPassword: string;
}

export class SchoolDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsArray() timings?: { label: string; start: string; end: string }[];
}

export class StopDto {
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() address?: string;
  @IsLatitude() lat: number;
  @IsLongitude() lng: number;
}

export class BusDto {
  @IsString() @IsNotEmpty() registrationNumber: string;
  @IsOptional() @IsString() fleetNumber?: string;
  @IsInt() @Min(1) capacity: number;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() gpsDeviceId?: string;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) insuranceExpiry?: string;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) fitnessExpiry?: string;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) permitExpiry?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'MAINTENANCE']) status?: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
}

export class StaffDto {
  @IsIn(['DRIVER', 'ATTENDANT', 'OFFICE_STAFF', 'COMPANY_ADMIN']) role: 'DRIVER' | 'ATTENDANT' | 'OFFICE_STAFF' | 'COMPANY_ADMIN';
  @IsString() @IsNotEmpty() name: string;
  @IsString() phone: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
  @IsOptional() @IsString() licenseNumber?: string;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) licenseExpiry?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() emergencyContact?: string;
  @IsOptional() @IsBoolean() policeVerified?: boolean;
}

export class RouteDto {
  @IsUUID() schoolId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() code?: string;
  @IsIn(['MORNING', 'AFTERNOON']) direction: 'MORNING' | 'AFTERNOON';
  @IsOptional() @IsUUID() busId?: string;
  @IsOptional() @IsUUID() driverId?: string;
  @IsOptional() @IsUUID() attendantId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  /** Days the route runs: 1 = Monday … 7 = Sunday */
  @IsOptional() @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days?: number[];
}

export class RouteStopItem {
  @IsUUID() stopId: string;
  @Matches(HHMM, { message: 'Use HH:mm' }) scheduledTime: string;
  @IsOptional() @IsInt() @Min(0) waitSeconds?: number;
}

export class RouteStopsDto {
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => RouteStopItem) stops: RouteStopItem[];
}

export class AssignmentItem {
  @IsUUID() studentId: string;
  @IsUUID() routeStopId: string;
}

export class AssignmentsDto {
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => AssignmentItem) assignments: AssignmentItem[];
}

export class StudentDto {
  @IsUUID() schoolId: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsString() photoUrl?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() className?: string;
  @IsOptional() @IsString() section?: string;
  @IsOptional() @IsString() homeAddress?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsString() specialInstructions?: string;
  /** Monthly transport fee in paise (₹1 = 100) */
  @IsOptional() @IsInt() @Min(0) monthlyFeePaise?: number;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) serviceStart?: string;
  @IsOptional() @Matches(ISO_DATE, DATE_MSG) serviceEnd?: string;
  @IsOptional() @IsIn(['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'INACTIVE']) status?: 'PENDING_APPROVAL' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
}

export class AuthorizedAdultDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() relation: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() photoUrl?: string;
}

export class ParentDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() phone: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
}

export class LinkStudentDto {
  @IsUUID() studentId: string;
  @IsOptional() @IsString() relation?: string;
}

export class GenerateTripsDto {
  @Matches(ISO_DATE, DATE_MSG) date: string;
}

export class OverrideDto {
  @IsIn(['SCHEDULED', 'ABSENT', 'BOARDED', 'NO_SHOW', 'AT_SCHOOL', 'HANDED_OVER', 'DROPPED_ALONE', 'HELD', 'RETURNED'])
  toStatus: 'SCHEDULED' | 'ABSENT' | 'BOARDED' | 'NO_SHOW' | 'AT_SCHOOL' | 'HANDED_OVER' | 'DROPPED_ALONE' | 'HELD' | 'RETURNED';
  @IsString() @IsNotEmpty() @MaxLength(500) note: string;
}

export class HolidayDto {
  @Matches(ISO_DATE, DATE_MSG) date: string;
  @IsString() @IsNotEmpty() name: string;
  @IsOptional() @IsUUID() schoolId?: string;
}

export class AnnouncementDto {
  @IsString() @IsNotEmpty() @MaxLength(120) title: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) body: string;
  @IsOptional() @IsUUID() schoolId?: string;
  @IsOptional() @IsUUID() routeId?: string;
  /** Delays, route changes and emergencies can't be muted by parents */
  @IsOptional() @IsBoolean() important?: boolean;
}
