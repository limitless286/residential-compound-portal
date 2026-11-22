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
| Submit a maintenance report | Own account | No |
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
## 14. Internal API Contract Details

This section defines implementation targets. These endpoints are not
implemented merely because they are documented here.

### 14.1 Common Internal Request Rules

All endpoints below require:

- X-Service-Name: the registered calling component.
- X-Service-Key: that caller's private credential for the receiving component.
- Authorization: Bearer <initiating-user-token>.
- Content-Type: application/json for requests with a JSON body.

The receiving component must:

1. Authenticate the calling service.
2. Check that the caller is permitted to use this endpoint.
3. Authenticate the initiating user through identity.
4. Enforce the required role and ownership.
5. Validate the request before accessing or changing data.

A caller credential alone never permits an operation.

Use the existing data/requestId and error/requestId response envelopes.
The examples below show the contents of data only.

Reject unknown input properties with HTTP 400.

Shared validation rules:

- Identifiers must be valid UUIDs.
- Timestamps must include a timezone and be normalized to UTC.
- Text must be trimmed and checked for non-empty content and maximum length.
- Do not accept a client-supplied application role.
- Never return password hashes, session hashes, tokens, or service keys.

Authentication errors:

| Condition | HTTP status |
| --- | --- |
| Missing service authentication | 401 |
| Invalid service credential or forbidden calling service | 403 |
| Missing, invalid, expired, or disabled user session | 401 |
| Authenticated user lacks the required permission | 403 |
| Required dependency is unavailable | 503 |

The existing introspection endpoint keeps its current contract.

### 14.2 Service Credential Scope

Use separate caller credentials for each receiving component.

| Receiving component | Allowed caller | Configuration at receiver | Configuration at caller |
| --- | --- | --- | --- |
| Identity | Bookings | BOOKINGS_AUTH_KEY | AUTH_SERVICE_KEY |
| Identity | Community | COMMUNITY_AUTH_KEY | AUTH_SERVICE_KEY |
| Bookings | Maintenance | MAINTENANCE_AUTH_KEY | BOOKINGS_SERVICE_KEY |
| Community | Maintenance | MAINTENANCE_AUTH_KEY | COMMUNITY_SERVICE_KEY |

The two MAINTENANCE_AUTH_KEY values must be different secrets.

Maintenance additionally requires:

- BOOKINGS_BASE_URL: local default http://127.0.0.1:3002
- COMMUNITY_BASE_URL: local default http://127.0.0.1:3003

Base URLs must be configurable for deployment.

Do not reuse a key across different receivers. Do not commit actual keys.

Identity's existing caller credentials may authenticate the new identity
lookups, but each lookup must explicitly allow only its documented caller.

### 14.3 Active Unit Lookup

Owner: Youssef, identity.
Caller: community only.
Initiating role: ADMIN only.

GET /internal/v1/units/active

Query parameters:

- limit: optional integer, default 100, minimum 1, maximum 200.
- cursor: optional opaque pagination cursor returned by this endpoint.

Example response data:

```json
{
  "units": [
    {
      "unitId": "11111111-1111-4111-8111-111111111111",
      "buildingId": "22222222-2222-4222-8222-222222222222",
      "unitNumber": "101"
    }
  ],
  "nextCursor": null
}
```

Rules:

- Return ACTIVE units only.
- Do not require a unit to have a resident account.
- Return no resident names, emails, or password information.
- Use stable ordering and keyset pagination.
- Return nextCursor as null when no further page exists.
- Invalid cursors return 400 with INVALID_CURSOR.

Community must fetch all pages before beginning invoice creation.
If lookup fails, do not report successful invoice generation.

The collected unit list is the input snapshot for that generation operation.
The invoice unit/month uniqueness constraint remains mandatory.

### 14.4 Booking Notification Recipient Lookup

Owner: Youssef, identity.
Caller: bookings only.
Initiating roles: RESIDENT or ADMIN.

POST /internal/v1/users/notification-recipient

Request:

```json
{
  "userId": "33333333-3333-4333-8333-333333333333"
}
```

Example response data:

```json
{
  "userId": "33333333-3333-4333-8333-333333333333",
  "email": "resident@example.com",
  "fullName": "Demo Resident"
}
```

Rules:

- A RESIDENT may request only their own recipient record.
- An ADMIN may request the resident recipient for an authorized booking action.
- Bookings derives userId from the stored booking, never from an
  unverified notification-recipient field in a public request.
- Identity returns only an ACTIVE RESIDENT linked to an ACTIVE unit.
- A resident requesting another user's record receives 403.
- A permitted lookup with no eligible recipient receives 404 with
  RECIPIENT_NOT_FOUND.
- Do not return unit occupants or unrelated user records.

Use this lookup during confirmation and cancellation workflows.

Persist the necessary email delivery payload and retry state after an
authorized lookup. Never persist the initiating user's raw session token.

If recipient lookup or email delivery fails after the booking transaction,
keep the booking result and record notification work as pending or failed.
Do not report the email as delivered.

### 14.5 Facility Closure Preview

Owner: Marwan, bookings.
Caller: maintenance only.
Initiating role: ADMIN only.

POST /internal/v1/facility-closures/preview

Request:

```json
{
  "maintenanceRequestId": "44444444-4444-4444-8444-444444444444",
  "facilityId": "55555555-5555-4555-8555-555555555555",
  "startAt": "2026-12-01T08:00:00Z",
  "endAt": "2026-12-01T12:00:00Z",
  "reason": "Electrical maintenance"
}
```

Example response data:

```json
{
  "previewId": "66666666-6666-4666-8666-666666666666",
  "expiresAt": "2026-11-30T15:10:00Z",
  "facilityId": "55555555-5555-4555-8555-555555555555",
  "startAt": "2026-12-01T08:00:00Z",
  "endAt": "2026-12-01T12:00:00Z",
  "affectedBookingCount": 2,
  "requiresCancellationConfirmation": true
}
```

Rules:

- Maintenance first verifies that the source request exists, is OPEN or
  IN_PROGRESS, and references the supplied facility.
- Bookings trusts this source validation only from the authenticated
  maintenance caller; it independently validates the admin and facility.
- The facility must exist and be ACTIVE.
- startAt must be in the future and endAt must be after startAt.
- reason must contain 3 to 1000 characters.
- Count overlapping CONFIRMED bookings using half-open time intervals.
- Reject overlapping ACTIVE closures with 409 CLOSURE_CONFLICT.
- Preview does not create a closure or cancel bookings.
- Store the preview with its validated input, initiating admin,
  affected booking identifiers, and expiry.
- Initial preview lifetime: 10 minutes.
- Return 200.

The preview must remain usable across Lambda invocations; do not keep it
only in process memory.

### 14.6 Facility Closure Confirmation

Owner: Marwan, bookings.
Caller: maintenance only.
Initiating role: ADMIN only.

POST /internal/v1/facility-closures

Requires Idempotency-Key.

Request:

```json
{
  "previewId": "66666666-6666-4666-8666-666666666666",
  "confirmAffectedBookings": true
}
```

Example response data:

```json
{
  "closureId": "77777777-7777-4777-8777-777777777777",
  "maintenanceRequestId": "44444444-4444-4444-8444-444444444444",
  "facilityId": "55555555-5555-4555-8555-555555555555",
  "status": "ACTIVE",
  "cancelledBookingCount": 2,
  "notifications": {
    "state": "PENDING",
    "pendingCount": 2
  }
}
```

Rules:

- Maintenance revalidates the source request before requesting confirmation.
- The preview must belong to the initiating admin.
- Unknown preview returns 404.
- Expired or consumed preview returns 409 PREVIEW_UNAVAILABLE,
  except for an already completed idempotent retry.
- If affected bookings exist and confirmation is false, return
  409 CANCELLATION_CONFIRMATION_REQUIRED.
- Under a facility lock, recheck facility state, closure conflicts,
  interval validity, and affected bookings.
- If the affected booking set changed, return 409 PREVIEW_OUTDATED.
  Require a fresh preview and renewed admin confirmation.
- Create the closure, cancel affected bookings with the recorded reason,
  create notification jobs, consume the preview, and record the
  idempotency result in one database transaction.
- A failed transaction must not leave partial cancellations.
- Return 201 after successful creation.
- Return notification state NOT_REQUIRED with pendingCount 0 when
  no bookings were cancelled.

The closure result does not mean emails have already been delivered.

All booking and closure mutations must follow the agreed facility-locking
protocol, including concurrent cancellation and facility changes.

### 14.7 Maintenance Announcement Draft

Owner: Malek, community.
Caller: maintenance only.
Initiating role: ADMIN only.

POST /internal/v1/announcements/drafts

Requires Idempotency-Key.

Request:

```json
{
  "maintenanceRequestId": "44444444-4444-4444-8444-444444444444",
  "title": "Facility maintenance",
  "body": "The facility will be temporarily unavailable during maintenance.",
  "audienceType": "ALL",
  "buildingId": null
}
```

Example response data:

```json
{
  "announcementId": "88888888-8888-4888-8888-888888888888",
  "maintenanceRequestId": "44444444-4444-4444-8444-444444444444",
  "status": "DRAFT",
  "audienceType": "ALL",
  "buildingId": null
}
```

Rules:

- Maintenance verifies that the source maintenance request exists.
- For BUILDING targeting, maintenance verifies the building against
  identity data it is permitted to access before making the request.
- Community accepts these source assertions only from the authenticated
  maintenance caller and still validates the initiating admin.
- title: 3 to 150 characters.
- body: 10 to 10000 characters.
- audienceType: ALL or BUILDING.
- ALL requires buildingId to be absent or null.
- BUILDING requires a valid buildingId.
- Store the authenticated admin as createdBy.
- Always create DRAFT; this endpoint cannot publish or schedule.
- Do not accept status, approvedBy, or createdBy as request input.
- Create the draft and record the idempotency result atomically.
- Return 201.

An admin reviews the draft through community's normal management APIs.

### 14.8 Mutation Idempotency

Use Idempotency-Key on closure confirmation and announcement-draft creation,
as well as invoice generation and payment recording.

- The key must be a client-generated UUID.
- Scope stored keys by caller, initiating user, endpoint, and key.
- Store a fingerprint of the validated request payload.
- The same key and same payload replay the recorded status and result.
- Reusing a key with a different payload returns 409 IDEMPOTENCY_CONFLICT.
- Concurrent identical requests must not create duplicate operations.
- An operation still in progress may return 409 OPERATION_IN_PROGRESS.
- Do not permanently cache transient failures as completed operations.
- Authenticate and authorize every retry before returning a stored result.
- Retain mutation records for the project lifetime in the initial design.

A lost HTTP response after commit must be recoverable by retrying with
the original key and payload.

### 14.9 Timeouts and Partial Failure

- Initial internal HTTP timeout: 10 seconds, configurable.
- Propagate a valid requestId for related logging.
- A requestId is for tracing, not authorization or idempotency.
- Retry transient failures with bounded backoff.
- Mutations must reuse their original idempotency key and payload.
- Do not automatically retry validation or permission failures.
- Never store raw user tokens for later retry jobs.

Maintenance tracks closure and announcement steps separately.

If closure confirmation succeeds but draft creation fails:

- Keep the closure.
- Record announcement work as pending.
- Show the completed closure and pending announcement separately.
- Do not claim that the entire workflow succeeded.

Later user-authorized retries require a current valid admin session.
Notification delivery jobs may retry using their previously authorized,
persisted delivery payload without retaining the user's session token.

Use a durable worker or an explicit administrative retry mechanism.
Do not start untracked background tasks after a Lambda response.

### 14.10 Implementation Ownership

| Work | Owner |
| --- | --- |
| Active-unit and recipient identity APIs | Youssef |
| Maintenance integration calls and pending-operation tracking | Youssef |
| Closure preview, confirmation, locking, and notification jobs | Marwan |
| Announcement-draft endpoint and draft idempotency | Malek |
| Component-specific migrations and tests | Respective component owner |

Each owner adds new numbered migrations for the required tables.
Do not modify already executed migrations.

Before merging dependent integrations, test:

- Allowed and forbidden callers.
- Admin and resident permissions.
- Ownership failures.
- Invalid payloads.
- Changed and expired previews.
- Concurrent booking and closure requests.
- Identical retries and conflicting idempotency payloads.
- Dependency failures and recovery after a lost response.
