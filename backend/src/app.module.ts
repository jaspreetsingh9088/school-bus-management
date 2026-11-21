import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminController, PlatformController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { AuditInterceptor } from './common/audit.interceptor';
import { AuthGuard, Public } from './common/auth';
import { CompanySettingsService } from './common/company-settings.service';
import { CrewController } from './crew/crew.controller';
import { FeesController } from './fees/fees.controller';
import { FeesService } from './fees/fees.service';
import { DbModule } from './db/db.module';
import { NotificationsService } from './notifications/notifications.service';
import { ConsolePushProvider, ConsoleSmsProvider, PushProvider, SmsProvider } from './notifications/providers';
import { ParentController } from './parent/parent.controller';
import { ParentService } from './parent/parent.service';
import { NoopRealtime } from './realtime/noop-realtime';
import { RealtimeGateway } from './realtime/realtime.gateway';
import { CronController } from './trips/cron.controller';
import { IncidentsService } from './trips/incidents.service';
import { RoutePathService } from './trips/route-path.service';
import { TrackingService } from './trips/tracking.service';
import { TripAccessService } from './trips/trip-access.service';
import { TripsService } from './trips/trips.service';

@Controller('health')
class HealthController {
  @Public() @Get()
  health() {
    return { ok: true };
  }
}

const jwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
  return secret;
};

@Module({
  imports: [
    DbModule,
    JwtModule.registerAsync({ global: true, useFactory: () => ({ secret: jwtSecret() }) }),
  ],
  controllers: [HealthController, CronController, FeesController, AuthController, PlatformController, AdminController, ParentController, CrewController],
  providers: [
    AuthGuard,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: SmsProvider, useClass: ConsoleSmsProvider },
    { provide: PushProvider, useClass: ConsolePushProvider },
    CompanySettingsService,
    // REALTIME=off on serverless hosts: no socket server, apps poll instead.
    { provide: RealtimeGateway, useClass: process.env.REALTIME === 'off' ? NoopRealtime : RealtimeGateway },
    NotificationsService,
    TripAccessService,
    TripsService,
    TrackingService,
    RoutePathService,
    IncidentsService,
    AuthService,
    AdminService,
    FeesService,
    ParentService,
  ],
})
export class AppModule {}
