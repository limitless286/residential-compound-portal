# Team Implementation Handoff

## 1. Current Project Status

The shared foundation currently includes:

- Three local Node.js and Express backends.
- PostgreSQL schemas and initial tables hosted on Neon.
- Separate database runtime accounts for each component.
- Shared login, current-user lookup, and logout.
- Hashed passwords and opaque session tokens.
- DynamoDB session storage through Floci.
- Absolute session expiry and a 30-minute inactivity timeout.
- Protected service-to-service authentication introspection.
- Reusable authentication and role middleware.
- Local authentication and authorization checks.

Business workflows, frontend screens, external email integration, and cloud deployment remain to be implemented.

The authorization checks cover eight distinct scenarios, executed against both bookings and community. They do not prove that business endpoints enforce ownership, because those endpoints are not implemented yet.

## 2. Component Ownership

| Student | Component | Main responsibilities |
| --- | --- | --- |
| Youssef | Maintenance and shared identity | Maintenance requests, priority deadlines, status workflow, shared authentication, resident administration, building and unit administration |
| Marwan | Facility bookings | Availability, booking rules, cancellations, facility closures, booking notification emails |
| Malek | Community | Monthly invoices, payment recording, overdue balances, targeted announcements |

Each student implements and tests their component's backend, frontend screens, cloud resources, and report evidence.

Coordinate changes to shared authentication, contracts, and infrastructure before editing them.

## 3. Local Startup

Run commands from the repository root.

After cloning, or pulling dependency changes, install the locked dependencies:

```powershell
npm.cmd --prefix services/maintenance ci
npm.cmd --prefix services/bookings ci
npm.cmd --prefix services/community ci
```

Open Docker Desktop, then start Floci:

```powershell
docker compose -f infra/floci/docker-compose.yml up -d
```

Run each backend in a separate PowerShell terminal:

```powershell
npm.cmd --prefix services/maintenance run dev
```

```powershell
npm.cmd --prefix services/bookings run dev
```

```powershell
npm.cmd --prefix services/community run dev
```

| Backend | Local address |
| --- | --- |
| Maintenance and identity | http://127.0.0.1:3001 |
| Bookings | http://127.0.0.1:3002 |
| Community | http://127.0.0.1:3003 |

Keep maintenance running while using protected booking or community endpoints. It currently hosts the shared identity API.

Floci session-table creation and TTL configuration must also be completed on each developer's local environment.

## 4. Private Configuration

Each service uses its own ignored `.env` file. Use `.env.example` as a starting point and fill in the required values locally.

Every backend needs its own `PORT` and `DATABASE_URL`.

Maintenance additionally requires:

- `AWS_PROFILE=floci`
- `AWS_REGION=us-east-1`
- `DYNAMODB_ENDPOINT_URL=http://localhost:4566`
- `SESSIONS_TABLE_NAME=compound-sessions`
- `BOOKINGS_AUTH_KEY`
- `COMMUNITY_AUTH_KEY`

Bookings and community additionally require:

- `SERVICE_NAME` matching their component.
- `IDENTITY_BASE_URL=http://127.0.0.1:3001`
- `AUTH_SERVICE_KEY` matching their registered key in identity.

Demo account seeding requires `DEMO_SEED_ENABLED=true` and the demo password environment variables. Demo aliases are disabled when `NODE_ENV=production`.

Give each teammate only the runtime credentials needed for their component.

Never commit real credentials or use the database owner's connection string as application configuration.

## 5. Code and API Conventions

- Use camelCase for JavaScript variables, functions, and JSON fields.
- Use UPPER_SNAKE_CASE for environment variables and constants.
- Use snake_case for SQL identifiers.
- Map database fields to camelCase in API responses.
- Use server-generated UUIDs for identifiers.
- Exchange timestamps as UTC ISO 8601 strings.
- Apply Africa/Cairo time when interpreting local business dates.
- Represent money as integer minor units, such as `amountMinor`.
- Use EGP as the initial currency.
- Represent API billing periods as `YYYY-MM`.
- Use `/api/v1` for public application APIs and `/internal/v1` for internal APIs.

Successful JSON responses follow:

```json
{
  "data": {},
  "requestId": "request-identifier"
}
```

Error responses follow:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe error message"
  },
  "requestId": "request-identifier"
}
```

HTTP 204 responses have no body.

Use appropriate status codes, including 400, 401, 403, 404, 409, 429, and 503. Do not expose stack traces, passwords, tokens, or connection strings in responses or logs.

## 6. Existing Authentication API

### POST /api/v1/auth/login

Available on maintenance/identity only.

```json
{
  "login": "user@example.com",
  "password": "user-password"
}
```

Returns:

- `accessToken`
- `tokenType`: `Bearer`
- `expiresAt`: absolute expiry timestamp
- `user`: id, email, fullName, role, unitId, buildingId

The session can expire before `expiresAt` after 30 minutes of inactivity.

Demo aliases `admin`, `resident`, and `resident2` are available only in enabled, non-production demo mode.

Keep the token in browser memory in the initial frontend design.

### GET /api/v1/auth/me

Available on all three backends.

Requires `Authorization: Bearer <token>`.

Returns the authenticated user's safe profile. Identity is the source of current roles and account status.

### POST /api/v1/auth/logout

Available on maintenance/identity only.

Requires a valid session. Deletes the session and returns HTTP 204.

### POST /internal/v1/auth/introspect

Available on maintenance/identity only.

Requires:

- `X-Service-Name`
- `X-Service-Key`
- `Authorization: Bearer <user-token>`

Returns userId, email, fullName, role, unitId, buildingId, and status.

A service credential does not grant an application role. The calling component must still enforce the user's role and ownership.

## 7. Backend Permissions

Attach `requireAuthentication` before role middleware.

| Endpoint permission | Role middleware |
| --- | --- |
| Admin only | `requireRole('ADMIN')` |
| Resident only | `requireRole('RESIDENT')` |
| Both roles | `requireRole('ADMIN', 'RESIDENT')` |

Enforce ownership in business logic and database queries:

- Maintenance: the request belongs to the authenticated user.
- Bookings: the booking belongs to the authenticated user.
- Fees: the invoice belongs to the authenticated user's unit.

Implement documented admin exceptions explicitly.

Never authorize an action using a role, userId, or unitId supplied in the request body.

## 8. Planned Maintenance APIs — Youssef

These are implementation targets, not existing endpoints.

| Method and path | Permission | Behavior |
| --- | --- | --- |
| POST /api/v1/maintenance-requests | Resident | Validate report; derive userId and unitId from authentication |
| GET /api/v1/maintenance-requests | Both | Own requests for residents; all requests for admins; validated filters |
| GET /api/v1/maintenance-requests/:id | Both | Ownership or admin access |
| PATCH /api/v1/maintenance-requests/:id/start | Admin | OPEN to IN_PROGRESS |
| PATCH /api/v1/maintenance-requests/:id/resolve | Admin | IN_PROGRESS to RESOLVED; record reason |
| PATCH /api/v1/maintenance-requests/:id/confirm | Owning resident | RESOLVED to CLOSED |
| PATCH /api/v1/maintenance-requests/:id/reopen | Owning resident | Validate reason and 48-hour window |
| PATCH /api/v1/maintenance-requests/:id/priority | Admin | Validate priority and reason; recalculate deadline |
| GET /api/v1/admin/maintenance-overview | Admin | Status and overdue summaries |

Request creation accepts title, description, category, locationDescription, and optional facilityId.

Implement meaningful rules:

- Warn about matching active requests.
- Validate status transitions and record history.
- Apply priority deadlines: HIGH 24 hours, MEDIUM 72 hours, LOW 168 hours.

Add resident administration under `/api/v1/admin/residents`, plus admin building and unit management.

Resident-management input must not permit creation or promotion of ADMIN accounts.

## 9. Planned Booking APIs — Marwan

| Method and path | Permission | Behavior |
| --- | --- | --- |
| GET /api/v1/facilities | Both | Residents see active facilities |
| GET /api/v1/facilities/:id/availability | Both | Validate date and durationMinutes |
| POST /api/v1/bookings | Resident | Validate facilityId, startAt, endAt; derive user and unit |
| GET /api/v1/bookings | Both | Own bookings for residents; all for admins |
| PATCH /api/v1/bookings/:id/cancel | Both | Ownership, cutoff, or justified admin override |
| POST /api/v1/admin/facilities | Admin | Create facility |
| PATCH /api/v1/admin/facilities/:id | Admin | Validated facility changes |
| PUT /api/v1/admin/facilities/:id/opening-hours | Admin | Configure weekly schedule |
| GET /api/v1/admin/booking-policies | Admin | Read policy |
| PUT /api/v1/admin/booking-policies | Admin | Validate and update limits |
| POST /api/v1/admin/facility-closures | Admin | Create closure with reason |
| PATCH /api/v1/admin/facility-closures/:id/clear | Admin | Explicit reopening with reason |

Initial rules:

- Allowed durations: 60 or 120 minutes.
- Maximum advance booking: 7 days.
- Maximum future active bookings: 2 per unit across facilities.
- Resident cancellation: at least 2 hours before the start.
- Validate opening hours, closures, and overlapping bookings.

Use transactions and facility locking for booking and closure checks. Serialize per-unit limit checks across facilities. Return HTTP 409 for booking exclusion-constraint conflicts.

Implement protected internal closure preview and confirmation APIs according to the agreed shared contract.

Use Brevo for real confirmation and cancellation emails. Persist delivery and retry state. Email failure must not undo a successful booking.

## 10. Planned Community APIs — Malek

| Method and path | Permission | Behavior |
| --- | --- | --- |
| GET /api/v1/invoices | Both | Resident's unit only; admin filters |
| GET /api/v1/invoices/:id | Both | Unit ownership or admin access |
| GET /api/v1/admin/fee-policy | Admin | Read fee policy |
| PUT /api/v1/admin/fee-policy | Admin | Validate monthlyAmountMinor, currency, dueDay |
| POST /api/v1/admin/invoice-generations | Admin | Generate for billingPeriod; require Idempotency-Key |
| POST /api/v1/admin/payments | Admin | Record validated payment; require Idempotency-Key |
| GET /api/v1/admin/overdue-invoices | Admin | Outstanding overdue balances |
| GET /api/v1/announcements | Both | Eligible audience for residents; admin filters |
| POST /api/v1/admin/announcements | Admin | Create draft |
| PATCH /api/v1/admin/announcements/:id | Admin | Validated draft or schedule changes |
| POST /api/v1/admin/announcements/:id/publish | Admin | Approve publication or scheduling |
| POST /api/v1/announcements/:id/read | Eligible resident | Idempotent read receipt |

Payment input includes invoiceId, amountMinor, paymentReference, paymentMethod, and paidAt.

Implement meaningful rules:

- Generate one invoice per active unit per billing period.
- Support partial payments and calculate remaining balances.
- Reject overpayments and duplicate payment recording.
- Enforce announcement audience, schedule, expiry, and approval rules.

Obtain active units through identity's protected internal API. Do not query identity tables with the community runtime account.

Lock the invoice row while checking its balance and recording a payment.

Identical idempotent retries must not create duplicates. Reusing a key with a different payload returns HTTP 409.

Implement the protected internal announcement-draft API.

## 11. Remaining Integration Contracts

Agree exact request and response payloads in a shared-contract PR before implementing dependent workflows:

- Identity active-unit lookup for invoice generation.
- Identity recipient lookup for booking notification emails.
- Closure preview and confirmation.
- Internal announcement-draft creation.

Internal APIs must validate the calling service and apply the initiating user's role and ownership rules.

Do not grant broad cross-schema database access to bypass these APIs.

Maintenance-triggered announcements remain drafts requiring admin review. Resolving a maintenance request must not automatically clear a facility closure.

## 12. Database Changes

Initial migrations are under `infra/database`.

Do not edit migrations already executed. Add a new numbered migration for subsequent changes.

Components may need extra tables for:

- Idempotency records.
- Email delivery and retries.
- Integration operation tracking.

Runtime accounts should receive only the permissions their component needs. Run schema migrations using the appropriate administrative process.

## 13. Cloud Deployment Responsibilities

Each component must deploy and use its own:

- API Gateway.
- Lambda.
- IAM execution role.
- CloudWatch log group.

Provide evidence of actual use and monitoring for each component.

Youssef additionally owns the shared DynamoDB session table.

Neon is external database storage and does not count as an AWS service.

The current Express backends run directly on Node.js locally. Lambda and API Gateway deployment is not implemented yet.

Local Floci addresses are not publicly accessible deployment URLs.

## 14. Security and Submission Work Remaining

- Attach authentication, role, and ownership checks to business endpoints.
- Validate all business inputs.
- Test disabled accounts and dependency failures.
- Replace the in-memory login limiter with a shared store before Lambda deployment.
- Replace short demo passwords and disable demo mode for real deployment.
- Rotate exposed credentials before real deployment.
- Configure HTTPS for externally accessible application traffic.
- Verify and document IAM enforcement supported by the emulator.
- Complete at least six application-specific threats with mitigations.
- Document at least eight security tests with expected and actual results.
- Collect logging and monitoring evidence.
- Complete every mandatory final-report section.
- Add an Individual Contribution Statement for each student.
- Provide an accessible GitHub repository and a working demo video of no more than five minutes.

## 15. Contribution Workflow

Use feature branches and pull requests.

Each student must author meaningful commits for their own component and be able to explain their implementation.

Coordinate shared-file changes before implementation.

The shared foundation is not evidence of completed individual business functions.