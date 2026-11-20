import {
  BadRequestException, HttpException, HttpStatus, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { AuthUser } from '../common/auth';
import { hashOtp, normalizePhone, randomDigits, safeEqualHex, verifyPassword } from '../common/passwords';
import { Db, InjectDb } from '../db/db.module';
import { companies, devices, otpRequests, parents, users } from '../db/schema';
import { SmsProvider } from '../notifications/providers';

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_MAX_REQUESTS = 5; // per phone per 15 minutes (spec 10)
const OTP_WINDOW_MS = 15 * 60_000;

type UserRow = typeof users.$inferSelect;

export interface LoginResult {
  token: string;
  user: { id: string; name: string; role: string; companyId: string | null; companyName?: string };
}

@Injectable()
export class AuthService {
  private readonly otpSecret = process.env.OTP_SECRET ?? process.env.JWT_SECRET!;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jwt: JwtService,
    private readonly sms: SmsProvider,
  ) {}

  phoneOrThrow(raw: string): string {
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException('Enter a valid mobile number');
    return phone;
  }

  /**
   * DEMO ONLY: when DEMO_OTP_CODE is set, every login uses that code and the API says so,
   * so a school can try the apps before an SMS account exists. Never set it in production.
   */
  private readonly demoCode = /^\d{6}$/.test(process.env.DEMO_OTP_CODE ?? '') ? process.env.DEMO_OTP_CODE! : null;

  async requestOtp(rawPhone: string): Promise<{ sent: true; expiresInSeconds: number; demoCode?: string }> {
    const phone = this.phoneOrThrow(rawPhone);
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), gt(otpRequests.createdAt, new Date(Date.now() - OTP_WINDOW_MS))));
    if (count >= OTP_MAX_REQUESTS) {
      throw new HttpException('Too many codes requested. Try again in 15 minutes.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const code = this.demoCode ?? randomDigits(6);
    await this.db.insert(otpRequests).values({
      phone, codeHash: hashOtp(phone, code, this.otpSecret), expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });
    // DLT-registered template text goes here in production.
    await this.sms.send(phone, `${code} is your School Bus login code. It expires in 5 minutes. Do not share it.`);
    return { sent: true, expiresInSeconds: OTP_TTL_MS / 1000, ...(this.demoCode ? { demoCode: this.demoCode } : {}) };
  }

  /**
   * Checks the code, then:
   *  - one account for this number → logged in
   *  - several (e.g. parent at two bus companies) → a ticket to pick one with selectAccount()
   *  - none → registration needed (pass companySlug + name to self-register as a parent)
   */
  async verifyOtp(input: { phone: string; code: string; companySlug?: string; name?: string }) {
    const phone = this.phoneOrThrow(input.phone);
    const [otp] = await this.db
      .select()
      .from(otpRequests)
      .where(and(eq(otpRequests.phone, phone), isNull(otpRequests.consumedAt)))
      .orderBy(desc(otpRequests.createdAt))
      .limit(1);
    if (!otp || otp.expiresAt < new Date()) throw new UnauthorizedException('Code expired. Request a new one.');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new UnauthorizedException('Too many wrong tries. Request a new code.');
    if (!safeEqualHex(otp.codeHash, hashOtp(phone, input.code, this.otpSecret))) {
      await this.db.update(otpRequests).set({ attempts: otp.attempts + 1 }).where(eq(otpRequests.id, otp.id));
      throw new UnauthorizedException('Wrong code');
    }
    await this.db.update(otpRequests).set({ consumedAt: new Date() }).where(eq(otpRequests.id, otp.id));

    const accounts = await this.db
      .select({ user: users, companyName: companies.name })
      .from(users)
      .leftJoin(companies, eq(companies.id, users.companyId))
      .where(and(eq(users.phone, phone), eq(users.active, true)));

    if (input.companySlug) {
      const [company] = await this.db.select().from(companies).where(eq(companies.slug, input.companySlug));
      if (!company || !company.active) throw new BadRequestException('Unknown bus company');
      const existing = accounts.find((a) => a.user.companyId === company.id);
      if (existing) return this.issue(existing.user, company.name);
      if (!input.name?.trim()) throw new BadRequestException('Name is needed to register');
      const user = await this.registerParent(company.id, phone, input.name.trim());
      return this.issue(user, company.name);
    }

    if (accounts.length === 1) return this.issue(accounts[0].user, accounts[0].companyName ?? undefined);
    if (accounts.length === 0) return { needsRegistration: true as const };

    const ticket = this.jwt.sign({ phone, purpose: 'select-account' }, { expiresIn: '5m' });
    return {
      chooseAccount: true as const,
      ticket,
      accounts: accounts.map((a) => ({ userId: a.user.id, role: a.user.role, companyName: a.companyName })),
    };
  }

  async selectAccount(ticket: string, userId: string): Promise<LoginResult> {
    let payload: { phone: string; purpose: string };
    try {
      payload = this.jwt.verify(ticket);
    } catch {
      throw new UnauthorizedException('Ticket expired. Log in again.');
    }
    if (payload.purpose !== 'select-account') throw new UnauthorizedException();
    const [row] = await this.db
      .select({ user: users, companyName: companies.name })
      .from(users)
      .leftJoin(companies, eq(companies.id, users.companyId))
      .where(and(eq(users.id, userId), eq(users.phone, payload.phone), eq(users.active, true)));
    if (!row) throw new UnauthorizedException();
    return this.issue(row.user, row.companyName ?? undefined);
  }

  /** Email + password, for admin panel users (and crew if the company prefers passwords). */
  async loginWithPassword(email: string, password: string): Promise<LoginResult> {
    const rows = await this.db
      .select({ user: users, companyName: companies.name })
      .from(users)
      .leftJoin(companies, eq(companies.id, users.companyId))
      .where(and(eq(users.email, email.toLowerCase()), eq(users.active, true)));
    for (const row of rows) {
      if (await verifyPassword(password, row.user.passwordHash)) return this.issue(row.user, row.companyName ?? undefined);
    }
    throw new UnauthorizedException('Wrong email or password');
  }

  async registerDevice(user: AuthUser, pushToken: string, platform: string) {
    await this.db
      .insert(devices)
      .values({ userId: user.sub, pushToken, platform })
      .onConflictDoUpdate({ target: devices.pushToken, set: { userId: user.sub, platform, lastSeen: new Date() } });
    return { ok: true };
  }

  private async registerParent(companyId: string, phone: string, name: string): Promise<UserRow> {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ companyId, role: 'PARENT', name, phone }).returning();
      await tx.insert(parents).values({ companyId, userId: user.id });
      return user;
    });
  }

  private async issue(user: UserRow, companyName?: string): Promise<LoginResult> {
    const claims: AuthUser = { sub: user.id, companyId: user.companyId, role: user.role, name: user.name };
    const isApp = ['PARENT', 'DRIVER', 'ATTENDANT'].includes(user.role);
    const token = this.jwt.sign(claims, { expiresIn: isApp ? '30d' : '12h' });
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return { token, user: { id: user.id, name: user.name, role: user.role, companyId: user.companyId, companyName } };
  }
}
