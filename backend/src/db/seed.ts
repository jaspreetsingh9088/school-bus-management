/**
 * Demo data for local development: one bus company, one school, a morning and an
 * afternoon route with three stops, a driver, an attendant, a parent and two children.
 * Run: npm run db:seed. Skips if the demo company already exists.
 * On Vercel it runs during the build only when SEED_DEMO=true.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { hashPassword } from '../common/passwords';
import * as s from './schema';

async function main() {
  if (!process.env.DATABASE_URL) return console.warn('DATABASE_URL is not set: skipping seed');
  if (process.env.VERCEL && process.env.SEED_DEMO !== 'true') return console.log('SEED_DEMO is not true: skipping seed');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: s });
  const [existing] = await db.select({ id: s.companies.id }).from(s.companies).where(eq(s.companies.slug, 'demo-transport'));
  if (existing) {
    console.log('Demo data already present: skipping seed');
    return pool.end();
  }

  const password = process.env.SEED_PASSWORD ?? 'ChangeMe!2026';
  await db.insert(s.users).values({
    role: 'SUPER_ADMIN', name: 'Platform Owner', phone: '+919000000000', email: 'owner@example.com', passwordHash: await hashPassword(password),
  });

  const [company] = await db.insert(s.companies).values({ name: 'Demo School Transport', slug: 'demo-transport', phone: '+918000000000' }).returning();
  const c = company.id;
  await db.insert(s.users).values({
    companyId: c, role: 'COMPANY_ADMIN', name: 'Demo Admin', phone: '+919000000001', email: 'admin@example.com', passwordHash: await hashPassword(password),
  });
  const [driver] = await db.insert(s.users).values({ companyId: c, role: 'DRIVER', name: 'Ravi Kumar', phone: '+919000000002' }).returning();
  const [attendant] = await db.insert(s.users).values({ companyId: c, role: 'ATTENDANT', name: 'Lakshmi N', phone: '+919000000003' }).returning();
  await db.insert(s.staffProfiles).values([
    { companyId: c, userId: driver.id, type: 'DRIVER', licenseNumber: 'KA01 20190012345', licenseExpiry: '2028-03-31', policeVerified: true },
    { companyId: c, userId: attendant.id, type: 'ATTENDANT', policeVerified: true },
  ]);

  const [school] = await db.insert(s.schools).values({
    companyId: c, name: 'Greenfield Public School', address: 'Indiranagar, Bengaluru', lat: 12.9719, lng: 77.6412,
    timings: [{ label: 'All classes', start: '08:30', end: '14:30' }],
  }).returning();
  const [bus] = await db.insert(s.buses).values({ companyId: c, registrationNumber: 'KA01AB1234', fleetNumber: 'Bus 7', capacity: 40 }).returning();
  const stopRows = await db.insert(s.stops).values([
    { companyId: c, name: 'HAL 2nd Stage, 12th Main', lat: 12.9634, lng: 77.6480 },
    { companyId: c, name: 'Domlur Layout gate', lat: 12.9610, lng: 77.6387 },
    { companyId: c, name: 'Defence Colony park', lat: 12.9767, lng: 77.6390 },
  ]).returning();

  const [morning] = await db.insert(s.routes).values({
    companyId: c, schoolId: school.id, name: 'Route 7 — Morning', code: 'R7-AM', direction: 'MORNING', busId: bus.id, driverId: driver.id, attendantId: attendant.id,
  }).returning();
  const [afternoon] = await db.insert(s.routes).values({
    companyId: c, schoolId: school.id, name: 'Route 7 — Afternoon', code: 'R7-PM', direction: 'AFTERNOON', busId: bus.id, driverId: driver.id, attendantId: attendant.id,
  }).returning();
  const am = await db.insert(s.routeStops).values(stopRows.map((st, i) => ({ routeId: morning.id, stopId: st.id, sequence: i + 1, scheduledTime: ['07:30', '07:40', '07:50'][i] }))).returning();
  const pm = await db.insert(s.routeStops).values([...stopRows].reverse().map((st, i) => ({ routeId: afternoon.id, stopId: st.id, sequence: i + 1, scheduledTime: ['14:50', '15:00', '15:10'][i] }))).returning();

  const kids = await db.insert(s.students).values([
    { companyId: c, schoolId: school.id, name: 'Aarav Sharma', className: '4', section: 'B', status: 'ACTIVE', activationCode: 'DEMO7AAR' },
    { companyId: c, schoolId: school.id, name: 'Diya Sharma', className: '1', section: 'A', status: 'ACTIVE', activationCode: 'DEMO7DIY' },
  ]).returning();
  for (const kid of kids) {
    await db.insert(s.studentAssignments).values([
      { studentId: kid.id, routeId: morning.id, routeStopId: am[0].id, direction: 'MORNING' },
      { studentId: kid.id, routeId: afternoon.id, routeStopId: pm.find((r) => r.stopId === stopRows[0].id)!.id, direction: 'AFTERNOON' },
    ]);
  }
  const [parentUser] = await db.insert(s.users).values({ companyId: c, role: 'PARENT', name: 'Priya Sharma', phone: '+919000000004' }).returning();
  const [parent] = await db.insert(s.parents).values({ companyId: c, userId: parentUser.id }).returning();
  await db.insert(s.parentStudents).values(kids.map((k, i) => ({ parentId: parent.id, studentId: k.id, relation: 'MOTHER', isPrimary: i === 0 })));
  await db.insert(s.authorizedAdults).values({ studentId: kids[0].id, name: 'Suresh Sharma', relation: 'Grandfather', approved: true });

  console.log(`Seeded. Admin login: admin@example.com / ${password}. Driver OTP phone +919000000002, parent +919000000004.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
