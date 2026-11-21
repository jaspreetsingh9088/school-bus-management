import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query, BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { ADMIN_ROLES, AuthUser, CurrentUser, Roles, tenantOf } from '../common/auth';
import { ISO_DATE } from '../common/time';
import { FeesService } from './fees.service';

class PayDto {
  /** Rupees; leave out to pay the full remaining amount */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) amount?: number;
  @IsOptional() @IsIn(['CASH', 'UPI', 'BANK', 'CHEQUE', 'ONLINE']) method?: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @Matches(ISO_DATE) paidOn?: string;
}

class SetFeesDto {
  /** Monthly fee in rupees; 0 removes the fee */
  @Type(() => Number) @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) studentIds?: string[];
  @IsOptional() @IsUUID() schoolId?: string;
  @IsOptional() @IsString() className?: string;
  @IsOptional() @IsUUID() routeId?: string;
}

const uuid = new ParseUUIDPipe();
const by = (v?: string) => {
  if (v && !['student', 'class', 'bus'].includes(v)) throw new BadRequestException('by must be student, class or bus');
  return (v ?? 'student') as 'student' | 'class' | 'bus';
};

@Controller('admin')
@Roles(...ADMIN_ROLES)
export class FeesController {
  constructor(private readonly fees: FeesService) {}

  @Get('fees')
  async month(@CurrentUser() u: AuthUser, @Query('month') month?: string) {
    return this.fees.monthView(tenantOf(u), month ?? (await this.fees.currentMonth(tenantOf(u))).month);
  }

  @Post('fees/:invoiceId/paid') @HttpCode(200)
  paid(@CurrentUser() u: AuthUser, @Param('invoiceId', uuid) id: string, @Body() dto: PayDto) {
    return this.fees.markPaid(tenantOf(u), id, u, dto);
  }

  @Post('fees/:invoiceId/pending') @HttpCode(200)
  pending(@CurrentUser() u: AuthUser, @Param('invoiceId', uuid) id: string) {
    return this.fees.markPending(tenantOf(u), id);
  }

  @Post('fees/set') @HttpCode(200)
  set(@CurrentUser() u: AuthUser, @Body() dto: SetFeesDto) {
    return this.fees.setFees(tenantOf(u), dto);
  }

  @Get('students/:id/fees')
  studentFees(@CurrentUser() u: AuthUser, @Param('id', uuid) id: string) {
    return this.fees.studentFees(tenantOf(u), id);
  }

  @Get('exports/fees.csv') @Header('Content-Type', 'text/csv; charset=utf-8')
  async feesCsv(@CurrentUser() u: AuthUser, @Query('month') month?: string, @Query('by') groupBy?: string) {
    return this.fees.feesCsv(tenantOf(u), month ?? (await this.fees.currentMonth(tenantOf(u))).month, by(groupBy));
  }

  @Get('exports/students.csv') @Header('Content-Type', 'text/csv; charset=utf-8')
  studentsCsv(@CurrentUser() u: AuthUser) {
    return this.fees.studentsCsv(tenantOf(u));
  }
}
