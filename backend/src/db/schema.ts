/**
 * School Bus Management System — database schema (v1).
 * Every tenant-owned table carries companyId. Money is stored in paise (integer).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, date, doublePrecision,
  jsonb, bigserial, uniqueIndex, index, primaryKey,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => ts('created_at').notNull().defaultNow();

// ───────────── Enums ─────────────

export const roleEnum = pgEnum('role', [
  'SUPER_ADMIN', 'COMPANY_ADMIN', 'OFFICE_STAFF', 'DRIVER', 'ATTENDANT', 'PARENT',
]);
export const staffTypeEnum = pgEnum('staff_type', ['DRIVER', 'ATTENDANT']);
export const studentStatusEnum = pgEnum('student_status', ['PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'INACTIVE']);
export const consentTypeEnum = pgEnum('consent_type', ['CHILD_DATA', 'GO_HOME_ALONE']);
export const busStatusEnum = pgEnum('bus_status', ['ACTIVE', 'INACTIVE', 'MAINTENANCE']);
export const directionEnum = pgEnum('direction', ['MORNING', 'AFTERNOON']);
export const tripStatusEnum = pgEnum('trip_status', ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const tripStudentStatusEnum = pgEnum('trip_student_status', [
  'SCHEDULED', 'ABSENT', 'BOARDED', 'NO_SHOW', 'AT_SCHOOL', 'HANDED_OVER', 'DROPPED_ALONE', 'HELD', 'RETURNED',
]);
export const incidentTypeEnum = pgEnum('incident_type', ['SOS', 'BREAKDOWN', 'DELAY', 'ACCIDENT', 'OTHER']);
export const billingPeriodEnum = pgEnum('billing_period', ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'CUSTOM']);
export const invoiceStatusEnum = pgEnum('invoice_status', [
  'DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED',
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type Direction = (typeof directionEnum.enumValues)[number];
export type TripStudentStatus = (typeof tripStudentStatusEnum.enumValues)[number];

// ───────────── Tenancy and access ─────────────

export const companies = pgTable('companies', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  logoUrl: text('logo_url'),
  gstin: text('gstin'),
  /** Safety and notification defaults — see src/common/settings.ts */
  settings: jsonb('settings').notNull().default({}),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  companyId: uuid('company_id').references(() => companies.id),
  role: roleEnum('role').notNull(),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  passwordHash: text('password_hash'),
  photoUrl: text('photo_url'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('users_company_phone_uq').on(t.companyId, t.phone),
  index('users_phone_idx').on(t.phone),
  index('users_email_idx').on(t.email),
]);

export const otpRequests = pgTable('otp_requests', {
  id: id(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  createdAt: createdAt(),
}, (t) => [index('otp_phone_created_idx').on(t.phone, t.createdAt)]);

export const devices = pgTable('devices', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pushToken: text('push_token').notNull().unique(),
  platform: text('platform').notNull(),
  lastSeen: ts('last_seen').notNull().defaultNow(),
});

export const auditLogs = pgTable('audit_logs', {
  id: id(),
  companyId: uuid('company_id').references(() => companies.id),
  userId: uuid('user_id'),
  action: text('action').notNull(),
  path: text('path').notNull(),
  payload: jsonb('payload'),
  at: ts('at').notNull().defaultNow(),
}, (t) => [index('audit_company_at_idx').on(t.companyId, t.at)]);

// ───────────── People ─────────────

export const parents = pgTable('parents', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  address: text('address'),
  emergencyContactName: text('emergency_contact_name'),
  emergencyContactPhone: text('emergency_contact_phone'),
  createdAt: createdAt(),
}, (t) => [index('parents_company_idx').on(t.companyId)]);

export const staffProfiles = pgTable('staff_profiles', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  type: staffTypeEnum('type').notNull(),
  licenseNumber: text('license_number'),
  licenseExpiry: date('license_expiry', { mode: 'string' }),
  address: text('address'),
  emergencyContact: text('emergency_contact'),
  policeVerified: boolean('police_verified').notNull().default(false),
  employmentStatus: text('employment_status').notNull().default('ACTIVE'),
});

export const schools = pgTable('schools', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  address: text('address'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  phone: text('phone'),
  email: text('email'),
  /** e.g. [{"label":"Primary","start":"08:00","end":"13:30"}] */
  timings: jsonb('timings').notNull().default([]),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
}, (t) => [index('schools_company_idx').on(t.companyId)]);

export const students = pgTable('students', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  photoUrl: text('photo_url'),
  registrationNumber: text('registration_number'),
  className: text('class_name'),
  section: text('section'),
  homeAddress: text('home_address'),
  emergencyContactPhone: text('emergency_contact_phone'),
  specialInstructions: text('special_instructions'),
  status: studentStatusEnum('status').notNull().default('PENDING_APPROVAL'),
  mayGoHomeAlone: boolean('may_go_home_alone').notNull().default(false),
  /** Monthly transport fee in paise; null = no fee */
  monthlyFeePaise: integer('monthly_fee_paise'),
  serviceStart: date('service_start', { mode: 'string' }),
  serviceEnd: date('service_end', { mode: 'string' }),
  /** Code the company gives a parent to link this student to their account */
  activationCode: text('activation_code').unique(),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
}, (t) => [index('students_company_school_idx').on(t.companyId, t.schoolId)]);

export const parentStudents = pgTable('parent_students', {
  parentId: uuid('parent_id').notNull().references(() => parents.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  relation: text('relation').notNull().default('PARENT'),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.parentId, t.studentId] })]);

export const authorizedAdults = pgTable('authorized_adults', {
  id: id(),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  relation: text('relation').notNull(),
  phone: text('phone'),
  photoUrl: text('photo_url'),
  approved: boolean('approved').notNull().default(false),
  createdAt: createdAt(),
});

/** DPDP: verifiable parental consent. Never deleted, only revoked. */
export const consents = pgTable('consents', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  parentId: uuid('parent_id').notNull().references(() => parents.id),
  studentId: uuid('student_id'),
  type: consentTypeEnum('type').notNull(),
  version: text('version').notNull(),
  method: text('method').notNull(),
  grantedAt: ts('granted_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

// ───────────── Places ─────────────

export const holidays = pgTable('holidays', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  schoolId: uuid('school_id').references(() => schools.id),
  date: date('date', { mode: 'string' }).notNull(),
  name: text('name').notNull(),
}, (t) => [index('holidays_company_date_idx').on(t.companyId, t.date)]);

export const stops = pgTable('stops', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  address: text('address'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
}, (t) => [index('stops_company_idx').on(t.companyId)]);

// ───────────── Operations ─────────────

export const buses = pgTable('buses', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  registrationNumber: text('registration_number').notNull(),
  fleetNumber: text('fleet_number'),
  photoUrl: text('photo_url'),
  capacity: integer('capacity').notNull(),
  model: text('model'),
  type: text('type'),
  gpsDeviceId: text('gps_device_id'),
  insuranceExpiry: date('insurance_expiry', { mode: 'string' }),
  fitnessExpiry: date('fitness_expiry', { mode: 'string' }),
  permitExpiry: date('permit_expiry', { mode: 'string' }),
  status: busStatusEnum('status').notNull().default('ACTIVE'),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('buses_company_reg_uq').on(t.companyId, t.registrationNumber)]);

export const maintenanceRecords = pgTable('maintenance_records', {
  id: id(),
  busId: uuid('bus_id').notNull().references(() => buses.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  description: text('description').notNull(),
  costPaise: integer('cost_paise'),
});

export const routes = pgTable('routes', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  schoolId: uuid('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  code: text('code'),
  direction: directionEnum('direction').notNull(),
  busId: uuid('bus_id').references(() => buses.id),
  driverId: uuid('driver_id').references(() => users.id),
  attendantId: uuid('attendant_id').references(() => users.id),
  active: boolean('active').notNull().default(true),
  /** Days the route runs, ISO weekday numbers: 1 = Monday … 7 = Sunday. Default Monday–Saturday. */
  days: integer('days').array().notNull().default(sql`'{1,2,3,4,5,6}'::integer[]`),
  /** Road-following path [[lat, lng], …] for the map, worked out from the stops */
  path: jsonb('path'),
  /** Set when archived instead of deleted (the record has trip history) */
  deletedAt: ts('deleted_at'),
  createdAt: createdAt(),
}, (t) => [index('routes_company_idx').on(t.companyId)]);

export const routeStops = pgTable('route_stops', {
  id: id(),
  routeId: uuid('route_id').notNull().references(() => routes.id, { onDelete: 'cascade' }),
  stopId: uuid('stop_id').notNull().references(() => stops.id),
  sequence: integer('sequence').notNull(),
  /** "HH:mm" local time */
  scheduledTime: text('scheduled_time').notNull(),
  /** Overrides the company default wait at this stop */
  waitSeconds: integer('wait_seconds'),
}, (t) => [uniqueIndex('route_stops_route_seq_uq').on(t.routeId, t.sequence)]);

export const studentAssignments = pgTable('student_assignments', {
  id: id(),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  routeId: uuid('route_id').notNull().references(() => routes.id, { onDelete: 'cascade' }),
  routeStopId: uuid('route_stop_id').notNull().references(() => routeStops.id, { onDelete: 'cascade' }),
  direction: directionEnum('direction').notNull(),
}, (t) => [uniqueIndex('assignments_student_dir_uq').on(t.studentId, t.direction)]);

export const absences = pgTable('absences', {
  id: id(),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  /** null = whole day */
  direction: directionEnum('direction'),
  reason: text('reason'),
  createdById: uuid('created_by_id').notNull(),
  cancelledAt: ts('cancelled_at'),
  createdAt: createdAt(),
}, (t) => [index('absences_student_date_idx').on(t.studentId, t.date)]);

// ───────────── Trips ─────────────

export const trips = pgTable('trips', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  routeId: uuid('route_id').notNull().references(() => routes.id),
  busId: uuid('bus_id').notNull().references(() => buses.id),
  driverId: uuid('driver_id').notNull().references(() => users.id),
  attendantId: uuid('attendant_id').references(() => users.id),
  date: date('date', { mode: 'string' }).notNull(),
  direction: directionEnum('direction').notNull(),
  status: tripStatusEnum('status').notNull().default('SCHEDULED'),
  startedAt: ts('started_at'),
  endedAt: ts('ended_at'),
  arrivedSchoolAt: ts('arrived_school_at'),
  emptyBusCheckedAt: ts('empty_bus_checked_at'),
  emptyBusCheckedBy: uuid('empty_bus_checked_by'),
  lastLat: doublePrecision('last_lat'),
  lastLng: doublePrecision('last_lng'),
  lastSpeedKmh: doublePrecision('last_speed_kmh'),
  lastPositionAt: ts('last_position_at'),
}, (t) => [
  uniqueIndex('trips_route_date_uq').on(t.routeId, t.date),
  index('trips_company_date_idx').on(t.companyId, t.date),
]);

export const tripStopEvents = pgTable('trip_stop_events', {
  id: id(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  routeStopId: uuid('route_stop_id').notNull().references(() => routeStops.id),
  approachNotified: boolean('approach_notified').notNull().default(false),
  arrivedAt: ts('arrived_at'),
  departedAt: ts('departed_at'),
}, (t) => [uniqueIndex('trip_stop_events_uq').on(t.tripId, t.routeStopId)]);

export const tripStudents = pgTable('trip_students', {
  id: id(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id').notNull().references(() => students.id),
  routeStopId: uuid('route_stop_id').notNull().references(() => routeStops.id),
  status: tripStudentStatusEnum('status').notNull().default('SCHEDULED'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('trip_students_uq').on(t.tripId, t.studentId)]);

export const studentStatusEvents = pgTable('student_status_events', {
  id: id(),
  tripStudentId: uuid('trip_student_id').notNull().references(() => tripStudents.id, { onDelete: 'cascade' }),
  /** Sent by the app so a retried offline upload is never applied twice */
  clientEventId: text('client_event_id').notNull().unique(),
  fromStatus: tripStudentStatusEnum('from_status').notNull(),
  toStatus: tripStudentStatusEnum('to_status').notNull(),
  /** Time on the device when it happened */
  occurredAt: ts('occurred_at').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  byUserId: uuid('by_user_id').notNull(),
  authorizedAdultId: uuid('authorized_adult_id'),
  receivedByParentId: uuid('received_by_parent_id'),
  note: text('note'),
  isOverride: boolean('is_override').notNull().default(false),
});

export const gpsPoints = pgTable('gps_points', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  tripId: uuid('trip_id').notNull().references(() => trips.id, { onDelete: 'cascade' }),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  speedKmh: doublePrecision('speed_kmh'),
  heading: doublePrecision('heading'),
  accuracyM: doublePrecision('accuracy_m'),
  recordedAt: ts('recorded_at').notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
}, (t) => [index('gps_trip_recorded_idx').on(t.tripId, t.recordedAt)]);

export const incidents = pgTable('incidents', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  tripId: uuid('trip_id').references(() => trips.id),
  type: incidentTypeEnum('type').notNull(),
  raisedById: uuid('raised_by_id').notNull(),
  note: text('note'),
  lat: doublePrecision('lat'),
  lng: doublePrecision('lng'),
  photoUrl: text('photo_url'),
  status: text('status').notNull().default('OPEN'),
  createdAt: createdAt(),
  resolvedAt: ts('resolved_at'),
  resolvedBy: uuid('resolved_by'),
});

// ───────────── Communication ─────────────

export const notifications = pgTable('notifications', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: jsonb('data').notNull().default({}),
  /** Safety alerts cannot be muted by the parent */
  safety: boolean('safety').notNull().default(false),
  status: text('status').notNull().default('QUEUED'),
  readAt: ts('read_at'),
  sentAt: ts('sent_at'),
  createdAt: createdAt(),
}, (t) => [index('notifications_user_created_idx').on(t.userId, t.createdAt)]);

export const serviceRequests = pgTable('service_requests', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  parentId: uuid('parent_id').notNull().references(() => parents.id),
  studentId: uuid('student_id').notNull().references(() => students.id),
  type: text('type').notNull(),
  details: jsonb('details').notNull().default({}),
  status: text('status').notNull().default('RECEIVED'),
  effectiveDate: date('effective_date', { mode: 'string' }),
  decidedById: uuid('decided_by_id'),
  createdAt: createdAt(),
});

// ───────────── Money (APIs arrive in Phase 4) ─────────────

export const feePlans = pgTable('fee_plans', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  name: text('name').notNull(),
  period: billingPeriodEnum('period').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  schoolId: uuid('school_id').references(() => schools.id),
  routeId: uuid('route_id').references(() => routes.id),
  taxable: boolean('taxable').notNull().default(false),
  taxRateBps: integer('tax_rate_bps').notNull().default(0),
  active: boolean('active').notNull().default(true),
});

export const feeAssignments = pgTable('fee_assignments', {
  id: id(),
  studentId: uuid('student_id').notNull().references(() => students.id, { onDelete: 'cascade' }),
  feePlanId: uuid('fee_plan_id').notNull().references(() => feePlans.id),
  discountPaise: integer('discount_paise').notNull().default(0),
  discountReason: text('discount_reason'),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
});

export const invoices = pgTable('invoices', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  number: text('number').notNull(),
  studentId: uuid('student_id').notNull().references(() => students.id),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  subtotal: integer('subtotal').notNull(),
  tax: integer('tax').notNull().default(0),
  total: integer('total').notNull(),
  paid: integer('paid').notNull().default(0),
  status: invoiceStatusEnum('status').notNull().default('ISSUED'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('invoices_company_number_uq').on(t.companyId, t.number),
  uniqueIndex('invoices_student_period_uq').on(t.studentId, t.periodStart),
]);

export const invoiceLines = pgTable('invoice_lines', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  amountPaise: integer('amount_paise').notNull(),
});

export const payments = pgTable('payments', {
  id: id(),
  companyId: uuid('company_id').notNull().references(() => companies.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  studentId: uuid('student_id').notNull().references(() => students.id),
  amountPaise: integer('amount_paise').notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  gatewayOrderId: text('gateway_order_id').unique(),
  gatewayPaymentId: text('gateway_payment_id').unique(),
  status: text('status').notNull().default('PENDING'),
  paidAt: ts('paid_at'),
  recordedById: uuid('recorded_by_id'),
  createdAt: createdAt(),
});

export const creditNotes = pgTable('credit_notes', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  amountPaise: integer('amount_paise').notNull(),
  reason: text('reason').notNull(),
  approvedBy: uuid('approved_by').notNull(),
  createdAt: createdAt(),
});
