import {
  CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { users, type Role } from '../db/schema';

export interface AuthUser {
  sub: string;
  companyId: string | null;
  role: Role;
  name: string;
}

export const ADMIN_ROLES: Role[] = ['COMPANY_ADMIN', 'OFFICE_STAFF'];
export const CREW_ROLES: Role[] = ['DRIVER', 'ATTENDANT'];

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route is open only to these roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

/** The caller's company. Every tenant query must be filtered by this. */
export function tenantOf(user: AuthUser): string {
  if (!user.companyId) throw new ForbiddenException('This action needs a company account');
  return user.companyId;
}

const ACTIVE_CACHE_MS = 60_000;

/**
 * Global guard: checks the Bearer token, that the account is still active
 * (a deactivated driver loses access within a minute), then the route's @Roles.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly activeCache = new Map<string, { active: boolean; until: number }>();

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectDb() private readonly db: Db,
  ) {}

  private async isActive(userId: string): Promise<boolean> {
    const hit = this.activeCache.get(userId);
    if (hit && hit.until > Date.now()) return hit.active;
    const [row] = await this.db.select({ active: users.active }).from(users).where(eq(users.id, userId));
    const active = !!row?.active;
    this.activeCache.set(userId, { active, until: Date.now() + ACTIVE_CACHE_MS });
    return active;
  }

  /** Called when an admin deactivates someone, so it takes effect at once on this server. */
  forget(userId: string) {
    this.activeCache.delete(userId);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    let user: AuthUser & { purpose?: string };
    try {
      user = this.jwt.verify(header.slice(7));
    } catch {
      throw new UnauthorizedException();
    }
    if (user.purpose) throw new UnauthorizedException(); // short-lived tickets are not access tokens
    if (!(await this.isActive(user.sub))) throw new UnauthorizedException('Account is deactivated');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}
