# Booking Locking Protocol

Owner: Marwan, bookings.

This is the facility-locking protocol referred to in shared-contract.md
section 14.6 ("All booking and closure mutations must follow the agreed
facility-locking protocol"). It applies to every write in the bookings
service.

## 1. One transaction per mutation

Every booking creation, cancellation, closure and facility change runs in
exactly one database transaction, opened with `withTransaction` from
`services/bookings/src/config/database.js`. All checks, locks and writes
for that operation use the `client` passed to the work function.

## 2. Lock timeout

`withTransaction` sets the lock timeout itself. Right after `BEGIN` it runs:

```sql
SELECT set_config('lock_timeout', $1, true);  -- $1 = '5000ms'
```

The third argument (`true`) makes the setting local to the transaction, so
it ends with `COMMIT` or `ROLLBACK` and the pooled connection is not
affected afterwards.

Callers must not set the lock timeout themselves.

After rolling back, `withTransaction` maps SQLSTATE `55P03` (lock timeout)
and `40P01` (deadlock detected) to HTTP 503 with code `SERVICE_BUSY`. Any
other error is rethrown unchanged.

## 3. Lock order

Locks are always taken in this order. A transaction may skip a level it
does not need, but it never goes back to an earlier level.

1. **(a) Unit lock** - only when creating a booking:

   ```sql
   SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));  -- $1 = unitId
   ```

   The limit of 2 future active bookings per unit spans all facilities,
   so a facility lock alone cannot protect it.

2. **(b) Facility row:**

   ```sql
   SELECT ... FROM bookings.facilities WHERE id = $1 FOR UPDATE;
   ```

3. **(c) Booking rows of that facility**, ordered by `id`, `FOR UPDATE`.

All three are transaction-scoped and are released by `COMMIT` or
`ROLLBACK`.

### Read after locking

Every check that depends on database state is read after the locks it
needs are held, inside the same transaction. This covers facility status,
opening hours, closures, overlapping bookings, the per-unit booking count
and booking status. A value read before the lock, or in another
transaction, must not be used for a decision.

## 4. Operations

| Operation | Locks taken, in order |
| --- | --- |
| Create booking | (a) unit advisory lock -> (b) facility row |
| Cancel booking | read `facility_id` without a lock -> (b) facility row -> (c) the booking row, then re-check its status |
| Edit facility | (b) facility row |
| Change opening hours | (b) facility row |
| Confirm closure (internal, 14.6) | (b) facility row -> (c) affected booking rows, ordered by `id` |
| Clear closure | (b) facility row |
| Create closure (admin, `POST /api/v1/admin/facility-closures`) | (b) facility row -> (c) affected booking rows, ordered by `id` |
| Create facility | none (the row does not exist yet) |
| Update booking policy | none (single-row update); bookings read the policy inside their own transaction, and a change applies to bookings created after it commits |

### Cancellation detail

The booking's `facility_id` is read first with a plain `SELECT` (no lock),
because the facility lock must be held before any booking row is locked.
After taking (b), lock the booking row (c) and read its status again. If it
is no longer cancellable (for example, a closure or another request already
cancelled it), stop and return the appropriate error.

## 5. Final safety net

The `bookings_no_overlap` constraint stays in place. If it ever fires
(SQLSTATE `23P01`), the service maps it to HTTP 409 with code
`BOOKING_CONFLICT`. The locks above are the primary protection; the
constraint catches anything they miss.

## 6. No outside work inside the transaction

While holding locks, and anywhere inside the transaction, do not send
email and do not call another service. The transaction only writes rows
(including notification/retry records). Email delivery and any other
service calls happen after `COMMIT`. This keeps lock hold times short and
matches shared-contract.md section 11: "Email failure must not roll back a
successful booking or cancellation."

## 7. Why this order cannot deadlock

A deadlock needs two transactions that each hold a lock the other is
waiting for. That requires one of them to take locks in the opposite order.
This protocol rules that out:

- **One global order.** Every transaction acquires locks in the order
  (a) -> (b) -> (c) and never returns to an earlier level. A transaction
  holding a facility lock never waits for a unit lock, and one holding a
  booking row never waits for a facility lock.
- **One lock per level for (a) and (b).** A booking creation locks exactly
  one unit, and each operation locks exactly one facility, so there are no
  two locks at the same level to take in different orders.
- **Fixed order inside (c).** When several booking rows are locked, they
  are always locked in ascending `id` order, so two transactions cannot
  lock the same set in opposite orders.
- **The unlocked read in cancellation holds nothing.** Reading
  `facility_id` before (b) takes no lock, so it cannot be part of a wait
  cycle.
- **No external waits.** No email or service call happens while locks are
  held, so a transaction never waits on something outside the database.

**Invariant:** No operation may lock more than one facility. A future
operation that needs two facilities must lock them in ascending id order,
and this document must be updated first.

**Cancellation and the unit limit.** Cancellation does not take the unit
lock (a). A cancel racing with a booking creation can only make the unit's
booking count look higher, never lower, so the limit is never exceeded.

If a lock is still slow because of a long-running holder, `lock_timeout`
ends the wait after 5 seconds with `55P03` / `SERVICE_BUSY` instead of
hanging.
