import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Db, InjectDb } from '../db/db.module';
import { auditLogs } from '../db/schema';
import { ADMIN_ROLES, AuthUser } from './auth';

const SECRET_KEYS = new Set(['password', 'code', 'otp', 'token']);

/** Records every successful create, edit, delete and override made by admin users (spec 5, audit log). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@InjectDb() private readonly db: Db) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    const audited = user && req.method !== 'GET' && (ADMIN_ROLES.includes(user.role) || user.role === 'SUPER_ADMIN');
    if (!audited) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const payload = Object.fromEntries(
          Object.entries(req.body ?? {}).filter(([k]) => !SECRET_KEYS.has(k)),
        );
        this.db
          .insert(auditLogs)
          .values({ companyId: user.companyId, userId: user.sub, action: req.method, path: req.originalUrl, payload })
          .catch(() => undefined);
      }),
    );
  }
}
