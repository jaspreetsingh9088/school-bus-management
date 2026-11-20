/**
 * End-to-end test of a full school day against a real PostgreSQL database:
 * setup → morning pickup → afternoon drop-off with a held child → tenant isolation.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { hashPassword, normalizePhone } from '../src/common/passwords';
import { zoned } from '../src/common/time';
import { runMigrations } from '../src/db/migrate';
import { configureApp } from '../src/main';
import { ConsoleSmsProvider, SmsProvider } from '../src/notifications/providers';

const STOP1 = { lat: 12.9634, lng: 77.648 };
const STOP2 = { lat: 12.961, lng: 77.6387 };
const STOP3 = { lat: 12.9767, lng: 77.639 };

let app: INestApplication;
let pool: Pool;
let sms: ConsoleSmsProvider;
let baseUrl: string;

const http = () => request(app.getHttpServer());
const as = (token: string) => ({
  get: (u: string) => http().get(`/api/v1${u}`).set('Authorization', `Bearer ${token}`),
  post: (u: string, body: object = {}) => http().post(`/api/v1${u}`).set('Authorization', `Bearer ${token}`).send(body),
  patch: (u: string, body: object = {}) => http().patch(`/api/v1${u}`).set('Authorization', `Bearer ${token}`).send(body),
  put: (u: string, body: object = {}) => http().put(`/api/v1${u}`).set('Authorization', `Bearer ${token}`).send(body),
  del: (u: string) => http().delete(`/api/v1${u}`).set('Authorization', `Bearer ${token}`),
});

async function otpLogin(phone: string, extra: object = {}) {
  await http().post('/api/v1/auth/otp/request').send({ phone }).expect(200);
  const msg = [...sms.sent].reverse().find((m) => m.to === normalizePhone(phone))!;
  const code = /\b(\d{6})\b/.exec(msg.text)![1];
  const res = await http().post('/api/v1/auth/otp/verify').send({ phone, code, ...extra }).expect(200);
  return res.body;
}

async function notificationsOf(userId: string): Promise<{ type: string; title: string }[]> {
  const { rows } = await pool.query('select type, title from notifications where user_id = $1 order by created_at', [userId]);
  return rows;
}

const at = (offsetSeconds = 0) => new Date(Date.now() + offsetSeconds * 1000).toISOString();
let eventSeq = 0;
const ev = (studentId: string, toStatus: string, extra: object = {}) => ({
  clientEventId: `test-${++eventSeq}`, studentId, toStatus, occurredAt: at(), ...extra,
});

// Shared state across the ordered steps below
const S: Record<string, any> = {};

beforeAll(async () => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await runMigrations();
  await pool.query(
    `insert into users (role, name, phone, email, password_hash) values ('SUPER_ADMIN', 'Owner', '+919999999999', 'owner@test.in', $1)`,
    [await hashPassword('owner-pass-1')],
  );

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.listen(0);
  baseUrl = await app.getUrl();
  sms = app.get(SmsProvider) as ConsoleSmsProvider;
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
});

describe('setup by the platform owner and company admin', () => {
  it('creates two bus companies', async () => {
    const owner = await http().post('/api/v1/auth/login').send({ email: 'owner@test.in', password: 'owner-pass-1' }).expect(200);
    for (const [key, slug, phone] of [['A', 'alpha-bus', '+919811111111'], ['B', 'beta-bus', '+919822222222']]) {
      const res = await as(owner.body.token).post('/platform/companies', {
        name: `${key} Transport`, slug, adminName: `${key} Admin`, adminEmail: `admin@${slug}.in`, adminPhone: phone, adminPassword: 'admin-pass-1',
      }).expect(201);
      S[`company${key}`] = res.body.company.id;
      const login = await http().post('/api/v1/auth/login').send({ email: `admin@${slug}.in`, password: 'admin-pass-1' }).expect(200);
      S[`admin${key}`] = login.body.token;
      S[`admin${key}UserId`] = login.body.user.id;
    }
  });

  it('rejects requests without a token or with the wrong role', async () => {
    await http().get('/api/v1/admin/schools').expect(401);
    await as(S.adminA).post('/platform/companies', {}).expect(403);
  });

  it('sets up a school, stops, bus, crew and routes', async () => {
    const a = as(S.adminA);
    S.school = (await a.post('/admin/schools', { name: 'Greenfield School', lat: 12.9719, lng: 77.6412 }).expect(201)).body.id;
    S.stops = [];
    for (const [i, p] of [STOP1, STOP2, STOP3].entries()) {
      S.stops.push((await a.post('/admin/stops', { name: `Stop ${i + 1}`, ...p }).expect(201)).body.id);
    }
    S.bus = (await a.post('/admin/buses', { registrationNumber: 'KA01AB1234', capacity: 2 }).expect(201)).body.id;
    await a.post('/admin/buses', { registrationNumber: 'KA01AB1234', capacity: 30 }).expect(409);

    S.driver = (await a.post('/admin/staff', { role: 'DRIVER', name: 'Ravi', phone: '9800000001', licenseNumber: 'KA01-123' }).expect(201)).body;
    S.attendant = (await a.post('/admin/staff', { role: 'ATTENDANT', name: 'Lakshmi', phone: '9800000002' }).expect(201)).body;
    S.otherDriver = (await a.post('/admin/staff', { role: 'DRIVER', name: 'Mohan', phone: '9800000003' }).expect(201)).body;
    expect(S.driver.passwordHash).toBeUndefined();

    // A driver can't be put in the attendant seat
    await a.post('/admin/routes', { schoolId: S.school, name: 'Bad', direction: 'MORNING', attendantId: S.driver.id }).expect(400);

    const common = { schoolId: S.school, busId: S.bus, driverId: S.driver.id, attendantId: S.attendant.id };
    S.am = (await a.post('/admin/routes', { ...common, name: 'R7 AM', direction: 'MORNING' }).expect(201)).body.id;
    S.pm = (await a.post('/admin/routes', { ...common, name: 'R7 PM', direction: 'AFTERNOON' }).expect(201)).body.id;

    // Morning stop times are past today's cut-off; afternoon is late in the day.
    const amStops = (await a.put(`/admin/routes/${S.am}/stops`, {
      stops: S.stops.map((stopId: string, i: number) => ({ stopId, scheduledTime: `00:0${i + 1}` })),
    }).expect(200)).body;
    const pmStops = (await a.put(`/admin/routes/${S.pm}/stops`, {
      stops: [...S.stops].reverse().map((stopId: string, i: number) => ({ stopId, scheduledTime: `23:5${i + 5}` })),
    }).expect(200)).body;
    S.amStop = (stopId: string) => amStops.find((r: any) => r.stopId === stopId).id;
    S.pmStop = (stopId: string) => pmStops.find((r: any) => r.stopId === stopId).id;
  });

  it('adds students and parents, and assigns them to stops', async () => {
    const a = as(S.adminA);
    S.kids = [];
    for (const name of ['Aarav', 'Diya', 'Kabir']) {
      const res = await a.post('/admin/students', { schoolId: S.school, name, className: '4' }).expect(201);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.activationCode).toHaveLength(8);
      S.kids.push(res.body);
    }
    const [s1, s2, s3] = S.kids;
    await a.put(`/admin/routes/${S.am}/assignments`, { assignments: [
      { studentId: s1.id, routeStopId: S.amStop(S.stops[0]) },
      { studentId: s2.id, routeStopId: S.amStop(S.stops[1]) },
      { studentId: s3.id, routeStopId: S.amStop(S.stops[2]) },
    ] }).expect(200);
    const pm = await a.put(`/admin/routes/${S.pm}/assignments`, { assignments: [
      { studentId: s1.id, routeStopId: S.pmStop(S.stops[0]) },
      { studentId: s2.id, routeStopId: S.pmStop(S.stops[1]) },
      { studentId: s3.id, routeStopId: S.pmStop(S.stops[2]) },
    ] }).expect(200);
    expect(pm.body.capacityWarning).toBe('3 students but 2 seats');

    // Parent P is added by the office and linked to the first two children
    S.parentP = (await a.post('/admin/parents', { name: 'Priya', phone: '9811000001' }).expect(201)).body;
    await a.post(`/admin/parents/${S.parentP.parentId}/children`, { studentId: s1.id }).expect(200);
    await a.post(`/admin/parents/${S.parentP.parentId}/children`, { studentId: s2.id }).expect(200);
    S.tokenP = (await otpLogin('+919811000001')).token;
  });

  it('lets a parent self-register, give consent, then link a child with the activation code', async () => {
    const reg = await otpLogin('9811000003', { companySlug: 'alpha-bus', name: 'Farah' });
    S.tokenP3 = reg.token;
    S.userP3 = reg.user.id;
    const p3 = as(S.tokenP3);
    await p3.post('/parent/children/link', { activationCode: S.kids[2].activationCode }).expect(403); // consent first
    await p3.post('/parent/consent', { version: 'old' }).expect(400);
    await p3.post('/parent/consent', { version: '2026-11' }).expect(200);
    await p3.post('/parent/children/link', { activationCode: 'WRONG123' }).expect(404);
    await p3.post('/parent/children/link', { activationCode: S.kids[2].activationCode.toLowerCase() }).expect(200);
    const kids = (await p3.get('/parent/children').expect(200)).body;
    expect(kids).toHaveLength(1);
    expect(kids[0].morning.stopName).toBe('Stop 3');

    // A child added by a parent waits for approval
    const added = await p3.post('/parent/children', { schoolId: S.school, name: 'Zoya' }).expect(201);
    expect(added.body.status).toBe('PENDING_APPROVAL');
    const queue = (await as(S.adminA).get('/admin/approvals').expect(200)).body;
    expect(queue.students.map((s: any) => s.name)).toContain('Zoya');
  });

  it('asks a parent with accounts at two companies which one to open', async () => {
    await otpLogin('9811000003', { companySlug: 'beta-bus', name: 'Farah' });
    const res = await otpLogin('9811000003');
    expect(res.chooseAccount).toBe(true);
    expect(res.accounts).toHaveLength(2);
    const pick = res.accounts.find((x: any) => x.companyName === 'B Transport');
    const login = await http().post('/api/v1/auth/select-account').send({ ticket: res.ticket, userId: pick.userId }).expect(200);
    S.tokenP3atB = login.body.token;
    await as(res.ticket).get('/auth/me').expect(401); // the ticket is not a login
  });

  it('limits wrong OTP tries', async () => {
    await http().post('/api/v1/auth/otp/request').send({ phone: '9811000009' }).expect(200);
    for (let i = 0; i < 5; i++) {
      await http().post('/api/v1/auth/otp/verify').send({ phone: '9811000009', code: '000000' }).expect(401);
    }
    const msg = [...sms.sent].reverse().find((m) => m.to === '+919811000009')!;
    const code = /\b(\d{6})\b/.exec(msg.text)![1];
    const res = await http().post('/api/v1/auth/otp/verify').send({ phone: '9811000009', code }).expect(401);
    expect(res.body.message).toMatch(/Too many/);
  });
});

describe('absences', () => {
  it('rejects a same-day absence after the cut-off', async () => {
    const today = zoned(new Date(), 'Asia/Kolkata').date;
    const res = await as(S.tokenP).post('/parent/absences', { studentId: S.kids[1].id, date: today, direction: 'MORNING' }).expect(400);
    expect(res.body.message).toMatch(/Too late/);
  });

  it("doesn't let a parent mark someone else's child", async () => {
    const tomorrow = zoned(new Date(Date.now() + 86_400_000), 'Asia/Kolkata').date;
    await as(S.tokenP).post('/parent/absences', { studentId: S.kids[2].id, date: tomorrow }).expect(404);
  });

  it("puts tomorrow's absence on tomorrow's trip", async () => {
    const tomorrow = zoned(new Date(Date.now() + 86_400_000), 'Asia/Kolkata').date;
    await as(S.tokenP).post('/parent/absences', { studentId: S.kids[1].id, date: tomorrow }).expect(201);
    const gen = await as(S.adminA).post('/admin/trips/generate', { date: tomorrow }).expect(200);
    expect(gen.body.created).toBe(2);
    const sheet = (await as(S.adminA).get(`/admin/trips/${gen.body.trips[0]}`).expect(200)).body;
    const all = sheet.stops.flatMap((s: any) => s.students);
    expect(all.find((k: any) => k.studentId === S.kids[1].id).status).toBe('ABSENT');
    expect(all.find((k: any) => k.studentId === S.kids[0].id).status).toBe('SCHEDULED');
  });
});

describe('morning trip', () => {
  it("generates today's trips once", async () => {
    const today = zoned(new Date(), 'Asia/Kolkata').date;
    const first = await as(S.adminA).post('/admin/trips/generate', { date: today }).expect(200);
    const again = await as(S.adminA).post('/admin/trips/generate', { date: today }).expect(200);
    expect(first.body.created).toBe(2);
    expect(again.body.created).toBe(0);
    const trips = (await as(S.adminA).get(`/admin/trips?date=${today}`).expect(200)).body;
    S.amTrip = trips.find((t: any) => t.trip.direction === 'MORNING').trip.id;
    S.pmTrip = trips.find((t: any) => t.trip.direction === 'AFTERNOON').trip.id;
  });

  it('lets only the assigned crew start the trip', async () => {
    S.tokenDriver = (await otpLogin('9800000001')).token;
    S.tokenAttendant = (await otpLogin('9800000002')).token;
    const other = (await otpLogin('9800000003')).token;
    await as(other).post(`/crew/trips/${S.amTrip}/start`).expect(403);
    await as(S.tokenP).post(`/crew/trips/${S.amTrip}/start`).expect(403);

    const mine = (await as(S.tokenDriver).get('/crew/trips/today').expect(200)).body;
    expect(mine).toHaveLength(2);
    await as(S.tokenP).get(`/parent/trips/${S.amTrip}/live`).expect(403); // not running yet
    const started = await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/start`).expect(200);
    expect(started.body.status).toBe('IN_PROGRESS');
    await as(S.tokenAttendant).post(`/crew/trips/${S.amTrip}/start`).expect(409);
    expect((await notificationsOf(S.parentP.userId)).map((n) => n.type)).toContain('TRIP_STARTED');
  });

  it('sends "approaching" and "arrived" alerts from GPS', async () => {
    const d = as(S.tokenDriver);
    await d.post(`/crew/trips/${S.amTrip}/positions`, { points: [{ lat: 12.99, lng: 77.7, speedKmh: 30, recordedAt: at(-20) }] }).expect(200);
    let types = (await notificationsOf(S.parentP.userId)).map((n) => n.type);
    expect(types).not.toContain('BUS_APPROACHING');

    await d.post(`/crew/trips/${S.amTrip}/positions`, { points: [{ lat: STOP1.lat + 0.005, lng: STOP1.lng, speedKmh: 25, recordedAt: at(-10) }] }).expect(200);
    await d.post(`/crew/trips/${S.amTrip}/positions`, { points: [{ ...STOP1, speedKmh: 0, recordedAt: at(-5) }] }).expect(200);
    types = (await notificationsOf(S.parentP.userId)).map((n) => n.type);
    expect(types.filter((t) => t === 'BUS_APPROACHING')).toHaveLength(1);
    expect(types).toContain('BUS_ARRIVED');

    const live = (await as(S.tokenP).get(`/parent/trips/${S.amTrip}/live`).expect(200)).body;
    expect(live.signalLost).toBe(false);
    expect(live.children).toHaveLength(2); // only this parent's children
    expect(live.children.find((c: any) => c.studentId === S.kids[0].id).busReachedStop).toBe(true);
    expect(live.children.find((c: any) => c.studentId === S.kids[1].id).etaSeconds).toBeGreaterThan(0);
    expect(live.toSchool.distanceM).toBeGreaterThan(0);
  });

  it('keeps an older offline point as history only', async () => {
    const res = await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/positions`, { points: [{ ...STOP1, recordedAt: at(-60) }] }).expect(200);
    expect(res.body.live).toBe(false);
  });

  it('locks the driver out of marking while the bus moves, but not the attendant', async () => {
    await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/positions`, { points: [{ ...STOP1, speedKmh: 40, recordedAt: at(-1) }] }).expect(200);
    await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/student-events`, { events: [ev(S.kids[0].id, 'BOARDED')] }).expect(423);
    const e = ev(S.kids[0].id, 'BOARDED');
    const res = await as(S.tokenAttendant).post(`/crew/trips/${S.amTrip}/student-events`, { events: [e] }).expect(200);
    expect(res.body[0]).toMatchObject({ ok: true, status: 'BOARDED' });
    // Same event uploaded again after a network retry
    const retry = await as(S.tokenAttendant).post(`/crew/trips/${S.amTrip}/student-events`, { events: [e] }).expect(200);
    expect(retry.body[0]).toMatchObject({ ok: true, duplicate: true });
    const boarded = (await notificationsOf(S.parentP.userId)).filter((n) => n.type === 'STUDENT_BOARDED');
    expect(boarded).toHaveLength(1);
    await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/positions`, { points: [{ ...STOP2, speedKmh: 0, recordedAt: at(0) }] }).expect(200);
  });

  it('allows a no-show only after waiting at the stop', async () => {
    const att = as(S.tokenAttendant);
    const url = `/crew/trips/${S.amTrip}/student-events`;
    const tooSoon = await att.post(url, { events: [ev(S.kids[1].id, 'NO_SHOW')] }).expect(200);
    expect(tooSoon.body[0].ok).toBe(false);
    expect(tooSoon.body[0].error).toMatch(/Wait 120 seconds/);
    const ok = await att.post(url, { events: [ev(S.kids[1].id, 'NO_SHOW', { occurredAt: at(130) })] }).expect(200);
    expect(ok.body[0]).toMatchObject({ ok: true, status: 'NO_SHOW' });
    expect((await notificationsOf(S.parentP.userId)).map((n) => n.type)).toContain('STUDENT_NO_SHOW');
    expect(sms.sent.some((m) => m.to === '+919811000001' && /was not at the bus/.test(m.text))).toBe(true);

    const bad = await att.post(url, { events: [ev(S.kids[2].id, 'AT_SCHOOL')] }).expect(200);
    expect(bad.body[0].error).toMatch(/Cannot change SCHEDULED to AT_SCHOOL/);
    await att.post(url, { events: [ev(S.kids[2].id, 'BOARDED')] }).expect(200);
  });

  it('will not end the trip or pass the empty-bus check with children on board', async () => {
    const att = as(S.tokenAttendant);
    await att.post(`/crew/trips/${S.amTrip}/end`).expect(409);
    const check = await att.post(`/crew/trips/${S.amTrip}/empty-bus-check`).expect(409);
    expect(check.body.students.map((s: any) => s.name).sort()).toEqual(['Aarav', 'Kabir']);
    expect((await notificationsOf(S.adminAUserId)).map((n) => n.type)).toContain('ALERT_EMPTY_BUS_CHECK');
  });

  it('arrives at school, passes the check and ends', async () => {
    const att = as(S.tokenAttendant);
    expect((await att.post(`/crew/trips/${S.amTrip}/arrive-school`).expect(200)).body.arrived).toBe(2);
    await att.post(`/crew/trips/${S.amTrip}/end`).expect(409); // check not done yet
    await att.post(`/crew/trips/${S.amTrip}/empty-bus-check`).expect(200);
    const done = await att.post(`/crew/trips/${S.amTrip}/end`).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    expect((await notificationsOf(S.userP3)).map((n) => n.type)).toContain('STUDENT_AT_SCHOOL');
    await as(S.tokenP).get(`/parent/trips/${S.amTrip}/live`).expect(403); // tracking closes with the trip
    await as(S.tokenDriver).post(`/crew/trips/${S.amTrip}/positions`, { points: [{ ...STOP1, recordedAt: at() }] }).expect(409);
  });
});

describe('afternoon trip', () => {
  let socket: Socket;
  afterAll(() => socket?.disconnect());

  it('streams the bus position to a parent subscribed to the trip', async () => {
    await as(S.tokenDriver).post(`/crew/trips/${S.pmTrip}/start`).expect(200);
    socket = io(baseUrl, { auth: { token: S.tokenP }, transports: ['websocket'] });
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    const sub = await socket.emitWithAck('trip:subscribe', { tripId: S.pmTrip });
    expect(sub.ok).toBe(true);
    const wrong = await socket.emitWithAck('trip:subscribe', { tripId: S.amTrip });
    expect(wrong.ok).toBe(false); // morning trip has ended

    const received = new Promise<any>((resolve) => socket.once('bus:position', resolve));
    await as(S.tokenDriver).post(`/crew/trips/${S.pmTrip}/positions`, { points: [{ lat: 12.9719, lng: 77.6412, speedKmh: 0, recordedAt: at() }] }).expect(200);
    const pos = await received;
    expect(pos.tripId).toBe(S.pmTrip);
    expect(pos.etas.length).toBe(3);
  });

  it('refuses the trip room to a parent from another company', async () => {
    const other = io(baseUrl, { auth: { token: S.tokenP3atB }, transports: ['websocket'] });
    await new Promise<void>((resolve) => other.on('connect', () => resolve()));
    expect((await other.emitWithAck('trip:subscribe', { tripId: S.pmTrip })).ok).toBe(false);
    other.disconnect();
  });

  it('hands a child only to a verified adult', async () => {
    const att = as(S.tokenAttendant);
    const url = `/crew/trips/${S.pmTrip}/student-events`;
    await att.post(url, { events: S.kids.map((k: any) => ev(k.id, 'BOARDED')) }).expect(200);

    const noOne = await att.post(url, { events: [ev(S.kids[0].id, 'HANDED_OVER')] }).expect(200);
    expect(noOne.body[0].error).toMatch(/Choose who received/);

    const proposed = await as(S.tokenP).post(`/parent/children/${S.kids[0].id}/authorized-adults`, { name: 'Uncle Raj', relation: 'Uncle' }).expect(201);
    const unapproved = await att.post(url, { events: [ev(S.kids[0].id, 'HANDED_OVER', { authorizedAdultId: proposed.body.id })] }).expect(200);
    expect(unapproved.body[0].error).toMatch(/not an approved pickup/);

    await as(S.adminA).post(`/admin/students/${S.kids[0].id}/authorized-adults/${proposed.body.id}/approve`).expect(200);
    const ok = await att.post(url, { events: [ev(S.kids[0].id, 'HANDED_OVER', { authorizedAdultId: proposed.body.id })] }).expect(200);
    expect(ok.body[0]).toMatchObject({ ok: true, status: 'HANDED_OVER' });
    const titles = (await notificationsOf(S.parentP.userId)).map((n) => n.title);
    expect(titles).toContain('Aarav has been dropped off');

    const byParent = await att.post(url, { events: [ev(S.kids[1].id, 'HANDED_OVER', { receivedByParentId: S.parentP.parentId })] }).expect(200);
    expect(byParent.body[0].ok).toBe(true);
  });

  it('holds a child when no adult is there, alerts everyone, then returns them', async () => {
    const att = as(S.tokenAttendant);
    const url = `/crew/trips/${S.pmTrip}/student-events`;
    const alone = await att.post(url, { events: [ev(S.kids[2].id, 'DROPPED_ALONE')] }).expect(200);
    expect(alone.body[0].error).toMatch(/not allowed this child to go home alone/);

    await att.post(url, { events: [ev(S.kids[2].id, 'HELD')] }).expect(200);
    expect((await notificationsOf(S.userP3)).map((n) => n.type)).toContain('STUDENT_HELD');
    expect((await notificationsOf(S.adminAUserId)).map((n) => n.type)).toContain('ALERT_HELD');
    expect(sms.sent.some((m) => m.to === '+919811000003' && /No one was at the stop/.test(m.text))).toBe(true);

    await att.post(`/crew/trips/${S.pmTrip}/empty-bus-check`).expect(409); // Kabir is still held
    await att.post(url, { events: [ev(S.kids[2].id, 'RETURNED')] }).expect(200);
    const dash = (await as(S.adminA).get('/admin/dashboard').expect(200)).body;
    expect(dash.alerts.needsAttention.map((x: any) => x.status)).toEqual(expect.arrayContaining(['NO_SHOW', 'RETURNED']));

    await att.post(`/crew/trips/${S.pmTrip}/empty-bus-check`).expect(200);
    await att.post(`/crew/trips/${S.pmTrip}/end`).expect(200);
  });

  it('lets an admin correct a status, with a reason', async () => {
    const a = as(S.adminA);
    await a.post(`/admin/trips/${S.amTrip}/students/${S.kids[1].id}/override`, { toStatus: 'AT_SCHOOL' }).expect(400);
    const res = await a.post(`/admin/trips/${S.amTrip}/students/${S.kids[1].id}/override`, { toStatus: 'AT_SCHOOL', note: 'Dropped at school by parent' }).expect(200);
    expect(res.body.status).toBe('AT_SCHOOL');
    const { rows } = await pool.query('select is_override, note from student_status_events where is_override');
    expect(rows).toHaveLength(1);
  });
});

describe('company data stays separate', () => {
  it("hides company A's records from company B", async () => {
    const b = as(S.adminB);
    await b.get(`/admin/students/${S.kids[0].id}`).expect(404);
    await b.get(`/admin/trips/${S.amTrip}`).expect(404);
    await b.patch(`/admin/routes/${S.am}`, { name: 'Hijack' }).expect(404);
    await b.post('/admin/routes', { schoolId: S.school, name: 'X', direction: 'MORNING' }).expect(404);
    expect((await b.get('/admin/students').expect(200)).body).toHaveLength(0);
    expect((await b.get('/admin/schools').expect(200)).body).toHaveLength(0);
    await as(S.tokenP3atB).get(`/parent/trips/${S.pmTrip}/live`).expect(404);
    await as(S.tokenP3atB).post('/parent/children/link', { activationCode: S.kids[0].activationCode }).expect(403); // no consent at B yet
  });

  it('locks out a deactivated driver straight away', async () => {
    await as(S.tokenDriver).get('/crew/trips/today').expect(200);
    await as(S.adminA).post(`/admin/users/${S.driver.id}/active/false`).expect(200);
    await as(S.tokenDriver).get('/crew/trips/today').expect(401);
    await as(S.adminB).post(`/admin/users/${S.driver.id}/active/true`).expect(404); // other company can't touch him
    await as(S.adminA).post(`/admin/users/${S.driver.id}/active/true`).expect(200);
    await as(S.tokenDriver).get('/crew/trips/today').expect(200);
  });

  it('keeps an audit log of admin changes', async () => {
    await new Promise((r) => setTimeout(r, 200));
    const { rows } = await pool.query('select count(*)::int as n from audit_logs where company_id = $1', [S.companyA]);
    expect(rows[0].n).toBeGreaterThan(10);
    const { rows: secrets } = await pool.query(`select count(*)::int as n from audit_logs where payload ? 'password'`);
    expect(secrets[0].n).toBe(0);
  });
});
