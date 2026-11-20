import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { AuthService } from './auth.service';

class RequestOtpDto {
  @IsString() @IsNotEmpty() phone: string;
}

class VerifyOtpDto {
  @IsString() @IsNotEmpty() phone: string;
  @IsString() @Length(6, 6) code: string;
  /** Self-registration as a parent of this bus company */
  @IsOptional() @IsString() companySlug?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
}

class SelectAccountDto {
  @IsString() ticket: string;
  @IsUUID() userId: string;
}

class PasswordLoginDto {
  @IsEmail() email: string;
  @IsString() @IsNotEmpty() password: string;
}

class DeviceDto {
  @IsString() @IsNotEmpty() @MaxLength(4096) pushToken: string;
  @IsIn(['android', 'ios', 'web']) platform: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public() @Post('otp/request') @HttpCode(200)
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Public() @Post('otp/verify') @HttpCode(200)
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto);
  }

  @Public() @Post('select-account') @HttpCode(200)
  select(@Body() dto: SelectAccountDto) {
    return this.auth.selectAccount(dto.ticket, dto.userId);
  }

  @Public() @Post('login') @HttpCode(200)
  login(@Body() dto: PasswordLoginDto) {
    return this.auth.loginWithPassword(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  /** Firebase token for push notifications. */
  @Post('devices') @HttpCode(200)
  device(@CurrentUser() user: AuthUser, @Body() dto: DeviceDto) {
    return this.auth.registerDevice(user, dto.pushToken, dto.platform);
  }
}
