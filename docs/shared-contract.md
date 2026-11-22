# Shared Development Contract

Team 34 — Residential Compound Portal.
This document defines the agreed implementation rules.
It describes planned behavior, not completed implementation.

## 1. Architecture and Ownership

One shared frontend connects to three independently deployed Express backends.

| Component | Owner | Local development port |
|-----------|-------|------------------------|
| Maintenance and shared identity | Youssef | 3001 |
| Facility Booking | Marwan | 3002 |
| Announcements and Service Fees | Malek | 3003 |

Development ports are for running Express directly.
Deployed API Gateway URLs are provided through configuration.

Each component must use its own API Gateway, Lambda, IAM role,
and CloudWatch log group in Floci.

## 2. Meaningful Business Functions

### Maintenance — Youssef

1. Validate maintenance reports and show possible active duplicates.
   Similar reports produce a warning, not an automatic rejection.
2. Enforce the maintenance workflow, including resident confirmation
   and reopening with a reason.
3. Calculate resolution deadlines from approved priority and identify
   overdue requests.

### Facility Booking — Marwan

1. Calculate availability using opening hours, closures, and existing
   bookings. Prevent overlapping bookings atomically.
2. Enforce booking duration, advance-booking, and per-unit limits.
3. Enforce cancellation rules, support justified admin overrides,
   and send booking/cancellation emails through Brevo.

### Announcements and Service Fees — Malek

1. Generate monthly unit invoices without duplicate unit/month invoices.
2. Record offline payments, calculate remaining balances, and identify
   overdue invoices. Reject overpayments and duplicate operations.
3. Publish targeted announcements with scheduling and expiry rules.

## 3. Roles and Permissions

Application roles: RESIDENT and ADMIN.
Team membership does not automatically grant application admin access.

| Action | RESIDENT | ADMIN |
|--------|----------|-------|
| Submit a maintenance report | Own account | Allowed |
| View maintenance reports | Own reports | All reports |
| Start work and mark a report resolved | No | Yes |
| Confirm resolution or reopen a report | Own reports within policy | No resident impersonation |
| Create a booking | For self, within unit limits | No booking on behalf of residents |
| View bookings | Own bookings | All bookings |
| Cancel a future booking | Own, before cutoff | Any, with a reason |
| Manage facilities and closures | No | Yes |
| View invoices and payment history | Own unit | All units |
| Generate invoices and record payments | No | Yes |
| View current announcements | Matching audience | All, including drafts |
| Manage announcements | No | Yes |
| Manage resident accounts and unit links | No | Yes |

Resident-management endpoints must not grant ADMIN privileges.
Initial admin creation uses a separate controlled setup process.

Every backend enforces role and ownership checks.
Frontend visibility alone is not authorization.
Disabled accounts are denied access even with an existing session.

## 4. Code Structure and Naming

Use Node.js 24 and JavaScript with ES modules.
Each service has its own package.json and deployment entry point.

Backend layers:
Routes -> Controllers -> Services -> Repositories.

- Variables, functions, filenames, and JSON properties: camelCase.
- Constants, enum values, and environment variables: UPPER_SNAKE_CASE.
- Resource URLs: lowercase plural names.
- Public API prefix: /api/v1.
- Internal API prefix: /internal/v1.
- Shared identifiers: id, userId, unitId, facilityId.
- Shared timestamps: createdAt, updatedAt.
- Generate identifiers server-side using UUIDs.
- Validate inputs in the backend and use parameterized SQL.

## 5. Common Data Formats

- Store and exchange timestamps as UTC ISO 8601 strings.
- Display times and evaluate local calendar rules using Africa/Cairo.
- Booking intervals use [startAt, endAt); adjacent slots may touch.
- Money uses integer piastres: amountMinor, with currency "EGP".
- Billing periods use billingPeriod in YYYY-MM format.
- Never trust client-supplied role, userId, or unitId as authorization.

## 6. Status Values

- Account: ACTIVE, DISABLED.
- Maintenance: OPEN, IN_PROGRESS, RESOLVED, CLOSED.
- Priority: HIGH, MEDIUM, LOW.
- Booking: CONFIRMED, CANCELLED, COMPLETED.
- Invoice: UNPAID, PARTIALLY_PAID, PAID.
- Announcement: DRAFT, SCHEDULED, PUBLISHED, EXPIRED.

Invoice isOverdue is calculated independently from payment status.

Maintenance normally follows:
OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED.

A valid resident reopening returns the request to OPEN and records
a REOPENED history event.

## 7. Configurable Initial Policies

- Maintenance resolution targets:
  HIGH: 24 hours; MEDIUM: 72 hours; LOW: 7 days.
- Resident reopening window: 48 hours after resolution.
- Booking duration: 1 or 2 hours.
- Maximum future active bookings: 2 per unit.
- Advance-booking limit: 7 days.
- Resident cancellation cutoff: 2 hours before start.
- Billing and due dates are configured by the admin.
- No automatic late-payment penalties in the initial scope.

These values belong in policy configuration, not scattered code literals.

## 8. API Responses and HTTP Status Codes

Success:
```json
{
  "data": {},
  "requestId": "generated-request-id"
}
```

Error:
```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "The selected slot is unavailable."
  },
  "requestId": "generated-request-id"
}
```

- 200: successful read or update.
- 201: resource created.
- 204: successful operation with no response body.
- 400: invalid input.
- 401: missing, invalid, or expired authentication.
- 403: insufficient role or failed ownership check.
- 404: resource does not exist.
- 409: conflicting booking, state, or idempotency payload.
- 429: rate limit exceeded.
- 500: unexpected server error; no internal details returned.
- 503: a required dependency is unavailable.

A valid retry with the same idempotency key and payload returns
the recorded result. Reusing that key with a different payload returns 409.

## 9. Authentication

Youssef owns the shared identity module.

- Approved accounts only; no public self-registration.
- Passwords use asynchronous node:crypto.scrypt with a unique salt.
- Sessions use cryptographically random opaque tokens.
- Store token hashes in DynamoDB, never raw session tokens.
- Browser requests use Authorization: Bearer <token>.
- Keep the browser token in memory in the initial implementation.
- Initial idle timeout: 30 minutes; absolute lifetime: 8 hours.
- Check expiry in application code; do not rely on DynamoDB TTL deletion.
- Logout invalidates the session server-side.

Identity endpoints:
- POST /api/v1/auth/login
- POST /api/v1/auth/logout
- GET /api/v1/auth/me
- POST /internal/v1/auth/introspect

Every service validates protected requests through identity introspection,
then applies its own role and ownership checks.
If identity is unavailable, fail closed with 503.

## 10. Data Ownership

Use Neon PostgreSQL for business data with separate schemas
and restricted runtime credentials.

- identity: users, units, and user/unit links.
- maintenance: requests, history, and maintenance policies.
- bookings: facilities, hours, closures, bookings, and booking rules.
- community: invoices, payments, announcements, and audience data.

DynamoDB stores shared identity sessions.

A service accesses only its own data.
Cross-service operations use protected internal APIs.
Shared identifiers do not authorize direct access to another schema.

## 11. Integration Rules

Maintenance may request a facility closure preview and confirmation:
- POST /internal/v1/facility-closures/preview
- POST /internal/v1/facility-closures

Booking owns closure creation and cancellation of affected bookings.
Confirmation rechecks availability and applies changes transactionally.

Maintenance may request an announcement draft:
- POST /internal/v1/announcements/drafts

Community owns the draft. An admin must review it before publication.
Resolving maintenance does not automatically reopen a facility.

Internal requests require a distinct service credential with limited
permissions and the initiating user's session where user authorization
is required. A service credential is not an ADMIN account.

Use Idempotency-Key for invoice generation, payment recording,
and retryable internal mutations.

Email failure must not roll back a successful booking or cancellation.
Persist delivery/retry status and log the failure.
If a closure succeeds but announcement drafting fails, retain the closure
and record pending retry work; do not report complete success.

Do not start untracked background work after a Lambda response.

## 12. Secrets and Logging

- Real secrets belong in private environment configuration.
- Commit only placeholder .env.example files.
- Never log passwords, tokens, API keys, or database connection strings.
- Log requestId, service, action, outcome, timestamp, and useful identifiers.
- Every service produces its own security and error evidence.
- Emulator behavior must be tested before claiming IAM enforcement.

## 13. Git Workflow

Suggested branch prefixes:
- feature/maintenance-
- feature/bookings-
- feature/community-
- chore/shared-

Each student makes real commits for their own component.
Use pull requests and review changes before merging into main.
Coordinate changes to this contract and shared files before implementation.
Commit package-lock.json files and use npm ci after cloning.
