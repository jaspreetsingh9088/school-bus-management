# School Bus Management System

Live bus tracking, safe pickup and drop-off records, and transport admin for school bus companies.

| Part | Folder | Where it runs |
| --- | --- | --- |
| API (NestJS + PostgreSQL) | `backend/` | Vercel (serverless) + Neon Postgres |
| Admin web panel (Next.js) | `web/` | Vercel |
| Android app for parents, drivers and attendants (Flutter) | `mobile/` | APK from GitHub Releases |

## Live demo

| What | Link |
| --- | --- |
| Admin panel | https://school-bus-admin-jade.vercel.app |
| API | https://school-bus-management-api.vercel.app/api/v1/health |
| Android app (APK) | https://github.com/jaspreetsingh9088/school-bus-management/releases/latest/download/school-bus.apk |

## CI/CD

- **CI** (`.github/workflows/ci.yml`): every push and pull request runs the backend tests against PostgreSQL and builds the admin panel.
- **Android** (`.github/workflows/android.yml`): every change under `mobile/` builds a release APK and publishes it as the latest GitHub Release, so the link above always gives the newest app. The API address comes from the `API_URL` repository variable.
- **CD:** Vercel's GitHub integration deploys `backend/` and `web/` as two Vercel projects. Pushes to `main` go to production, and pull requests get preview links. During each API deploy, database migrations run automatically.

## Demo mode (free tier)

This setup is for showing the system to schools, before paying for any services:

| Need | Free choice now | Paid upgrade later |
| --- | --- | --- |
| Hosting | Vercel Hobby | Vercel Pro, or a container host for WebSockets |
| Database | Neon free tier | Neon paid tier, or AWS RDS in Mumbai |
| Login SMS | `DEMO_OTP_CODE` (everyone uses the same code, shown in the app) | DLT-registered SMS provider (MSG91 / Twilio) |
| Maps | OpenStreetMap | Google Maps Platform |
| Live updates | Apps refresh every 5 seconds | Socket.IO on a host with WebSockets |
| App distribution | APK download | Google Play / App Store |

**Never set `DEMO_OTP_CODE` when real families use the system.**

### Vercel environment variables

**API project** (root directory `backend`):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Added automatically by the Neon integration |
| `JWT_SECRET` | 64 random characters |
| `DEMO_OTP_CODE` | `123456`, for demos only |
| `SEED_DEMO` | `true`, to load demo data on first deploy |
| `CRON_SECRET` | Random string; Vercel Cron uses it for the nightly trip job |
| `REALTIME` | `off` |

**Web project** (root directory `web`): set `NEXT_PUBLIC_API_URL` to the API project's URL.

### Demo logins

| Who | Login |
| --- | --- |
| Admin panel | `admin@example.com` / `ChangeMe!2026` |
| Driver (app) | mobile `9000000002`, code `123456` |
| Attendant (app) | mobile `9000000003`, code `123456` |
| Parent (app) | mobile `9000000004`, code `123456` |

---

## Backend details

The backend is built to the **Requirements v2** document.

The backend for Phase 2 (core platform) and Phase 3 (trips, tracking and safety) is done and tested. Fees and payments (Phase 4) have database tables but no API yet. The admin panel and the two Flutter apps come next.

## Run it

**With Docker** (database and API together):

```bash
docker compose up --build
# API: http://localhost:3000/api/v1/health
```

**Without Docker** (you need Node 22 and PostgreSQL 16):

```bash
cd backend
cp .env.example .env          # set DATABASE_URL and JWT_SECRET
npm install
npm run db:migrate
npm run db:seed               # demo company, school, routes, crew, parent
npm run dev
```

The seed prints the demo logins. In development, OTP codes are printed in the API log instead of being sent by SMS.

**Tests** run against a real Postgres database (`schoolbus_test`):

```bash
createdb schoolbus_test
npm test                      # 35 tests: unit tests + a full school day end to end
```

## Stack

| Part | Choice |
| --- | --- |
| API | NestJS 11 (Node 22, TypeScript) |
| Database | PostgreSQL 16 through Drizzle ORM; SQL migrations in `backend/drizzle/` |
| Real-time | Socket.IO |
| Auth | Mobile OTP (parents, crew) and email + password (admin panel); JWT |
| SMS / push | Console stand-ins in `notifications/providers.ts`. Replace them with an SMS provider whose templates are DLT-registered, and with Firebase Cloud Messaging. |

> **Change from the v2 document:** the document listed Prisma. Drizzle is used instead because it needs no downloaded engine binary and produces plain SQL migrations. PostGIS isn't needed yet, because distances are worked out in the app. It can be added later for map-area (geofence) features.

## Code map

```
backend/src/
  db/schema.ts            all tables (multi-company; every row has companyId)
  auth/                   OTP request/verify, account picker, password login, push tokens
  admin/                  admin panel API: schools, stops, buses, staff, routes, students,
                          parents, approvals, trips, dashboard, incidents, announcements
  parent/                 Parent app API: consent, children, absences, pickups, live tracking, SOS
  crew/                   Driver & Attendant app API: today's trips, start/end, GPS, boarding events
  trips/
    status-machine.ts     which status changes the crew may make (Requirements v2, 4.1)
    trips.service.ts      trip generation, boarding/drop-off rules, empty-bus check, overrides
    tracking.service.ts   GPS intake, stop arrival, "approaching" alerts, ETA, parent live view
  notifications/          saves, pushes, texts and emits every alert
  realtime/               Socket.IO gateway and rooms
```

## Safety rules the API enforces

- **Handover:** a child is handed over only to an approved authorized adult or a linked parent. Going home alone is allowed only with the parent's recorded permission.
- **No adult at the stop:** the child is set to **HELD**. The parent gets a push and an SMS, and admins are alerted. **RETURNED** is the only way to close a held child's record without a handover.
- **Morning no-show:** can be marked only after the bus has reached the stop and waited the set time (default 2 minutes).
- **Empty-bus check:** fails, and alerts admins, while any child is still marked on board. A trip can't end until every child has a final status and the check has passed.
- **Driving lock:** a driver can't mark students above 10 km/h. The attendant can.
- **Parent absences:** close 30 minutes before the stop time and update the driver's list live.
- **Parent tracking:** parents see the bus only while their own child's trip is running. Other children's statuses are never sent to them.
- **Retries:** the crew app sends a `clientEventId` with every event, so uploads retried after going offline are never applied twice.
- **Company separation:** every query is filtered by company. Tests check that company B gets "not found" for company A's records.
- **Records:** every admin change is kept in the audit log, with passwords and codes removed. Parent consent records are kept for the data protection law (DPDP).

Default wait times, cut-offs and distances are in `common/settings.ts`. Each company can override them in `companies.settings`.

## API at a glance (`/api/v1`)

| Who | Endpoints |
| --- | --- |
| Anyone | `POST auth/otp/request`, `auth/otp/verify`, `auth/select-account`, `auth/login` · `GET health` |
| Logged in | `GET auth/me` · `POST auth/devices` |
| Platform owner | `POST platform/companies` |
| Admin panel | `admin/dashboard`, `admin/approvals`, CRUD on `admin/schools`, `stops`, `buses`, `routes`, `students`, `parents`, `staff` · `PUT admin/routes/:id/stops`, `/assignments` · `POST admin/trips/generate` · `GET admin/trips?date=`, `admin/trips/:id`, `/track` · `POST admin/trips/:id/students/:sid/override` · `admin/incidents`, `admin/announcements`, `admin/holidays` |
| Parent app | `parent/me`, `consent`, `children` (+ `link`, `today`, `absences`, `authorized-adults`, `go-home-alone`), `absences`, `trips/:id/live`, `notifications`, `sos` |
| Crew app | `GET crew/trips/today`, `crew/trips/:id` · `POST crew/trips/:id/start`, `positions`, `student-events`, `stops/:rsid/arrive`, `arrive-school`, `empty-bus-check`, `end` · `POST crew/incidents` |

**Socket.IO.** Connect with `io(url, { auth: { token } })`, then emit `trip:subscribe { tripId }`. Events: `bus:position`, `trip:status`, `student:status` (staff only), `alert` (admins), `notification`.

## Not built yet

- **Fees and payments API** (Phase 4): invoices, Razorpay, receipts and GST.
- **Real SMS and push:** an SMS provider (MSG91 or Twilio) and Firebase.
- **Photo uploads** to S3.
- **Google Routes ETA:** currently a distance-based estimate (`estimateEtas`).
- **Scheduled jobs:** daily trip generation, document-expiry reminders, GPS data cleanup.
- **Excel/CSV student import**, reports and exports.
- **IP-based rate limits** and refresh tokens.
