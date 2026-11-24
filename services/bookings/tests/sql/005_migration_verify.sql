-- Verification script for migrations 000-005 (bookings support tables).
-- Run ONLY against a throwaway PostgreSQL, as the superuser, after applying
-- migrations 000-005 in order. Never run against Neon or any shared database.
-- Every test prints one NOTICE line: "PASS <id>" or "FAIL <id> ...".
\set ON_ERROR_STOP on

CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;

CREATE FUNCTION t.expect_ok(test_id text, stmt text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE NOTICE 'PASS %', test_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'FAIL % unexpected error % %', test_id, SQLSTATE, SQLERRM;
  END;
END
$f$;

CREATE FUNCTION t.expect_err(test_id text, expected_state text, stmt text) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN
    EXECUTE stmt;
    RAISE EXCEPTION '__no_error__' USING ERRCODE = 'P0001';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '__no_error__' THEN
      RAISE NOTICE 'FAIL % no error, expected %', test_id, expected_state;
    ELSIF SQLSTATE = expected_state THEN
      RAISE NOTICE 'PASS %', test_id;
    ELSE
      RAISE NOTICE 'FAIL % got % %, expected %', test_id, SQLSTATE, SQLERRM, expected_state;
    END IF;
  END;
END
$f$;

-- Fixtures, inserted as the database owner.
INSERT INTO identity.buildings (id, code, name)
VALUES ('b0000000-0000-0000-0000-000000000001', 'B1', 'Building 1');
INSERT INTO identity.units (id, building_id, unit_number)
VALUES ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', '101');
INSERT INTO identity.users (id, unit_id, full_name, email, password_hash, role)
VALUES
  ('a0000000-0000-0000-0000-000000000001', NULL, 'Test Admin', 'admin@test.local', 'x', 'ADMIN'),
  ('a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'Test Resident', 'resident@test.local', 'x', 'RESIDENT');
INSERT INTO bookings.facilities (id, name, location_description)
VALUES ('f0000000-0000-0000-0000-000000000001', 'Test Gym', 'Ground floor');

SET ROLE bookings_app;

-- Section A: existing tables, as bookings_app
SELECT t.expect_ok('A01 insert booking 10:00-11:00', $q$
  INSERT INTO bookings.bookings (id, facility_id, user_id, unit_id, start_at, end_at)
  VALUES ('10000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
          '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z') $q$);
SELECT t.expect_err('A02 overlapping booking rejected', '23P01', $q$
  INSERT INTO bookings.bookings (id, facility_id, user_id, unit_id, start_at, end_at)
  VALUES ('10000000-0000-0000-0000-000000000099', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
          '2030-01-01T10:30:00Z', '2030-01-01T11:30:00Z') $q$);
SELECT t.expect_ok('A03 adjacent booking 11:00-12:00 allowed', $q$
  INSERT INTO bookings.bookings (id, facility_id, user_id, unit_id, start_at, end_at)
  VALUES ('10000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
          '2030-01-01T11:00:00Z', '2030-01-01T12:00:00Z') $q$);
SELECT t.expect_ok('A04 cancelled booking may overlap', $q$
  INSERT INTO bookings.bookings (id, facility_id, user_id, unit_id, start_at, end_at,
                                 status, cancelled_by, cancelled_at, cancellation_reason)
  VALUES ('10000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
          '2030-01-01T10:00:00Z', '2030-01-01T11:00:00Z',
          'CANCELLED', 'a0000000-0000-0000-0000-000000000001', now(), 'test') $q$);
SELECT t.expect_err('A05 bookings_app cannot read identity.users', '42501', $q$
  SELECT 1 FROM identity.users $q$);

-- Section B: closure_previews
SELECT t.expect_ok('B01 insert closure', $q$
  INSERT INTO bookings.facility_closures (id, facility_id, created_by, start_at, end_at, reason)
  VALUES ('d0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'Pipe repair') $q$);
SELECT t.expect_ok('B02 insert valid preview', $q$
  INSERT INTO bookings.closure_previews (id, maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, affected_booking_ids, expires_at)
  VALUES ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          'f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'Pipe repair',
          ARRAY['10000000-0000-0000-0000-000000000001']::uuid[], now() + interval '10 minutes') $q$);
SELECT t.expect_err('B03 end_at must be after start_at', '23514', $q$
  INSERT INTO bookings.closure_previews (maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, expires_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T08:00:00Z', 'Pipe repair', now() + interval '10 minutes') $q$);
SELECT t.expect_err('B04 reason too short', '23514', $q$
  INSERT INTO bookings.closure_previews (maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, expires_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'ab', now() + interval '10 minutes') $q$);
SELECT t.expect_err('B05 expires_at must be after created_at', '23514', $q$
  INSERT INTO bookings.closure_previews (maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, expires_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'Pipe repair', now() - interval '1 minute') $q$);
SELECT t.expect_err('B06 consumed_at without closure_id', '23514', $q$
  INSERT INTO bookings.closure_previews (maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, expires_at, consumed_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'Pipe repair',
          now() + interval '10 minutes', now()) $q$);
SELECT t.expect_err('B07 unknown facility rejected', '23503', $q$
  INSERT INTO bookings.closure_previews (maintenance_request_id, facility_id, created_by,
      start_at, end_at, reason, expires_at)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'f0000000-0000-0000-0000-0000000000ff',
          'a0000000-0000-0000-0000-000000000001',
          '2030-01-02T08:00:00Z', '2030-01-02T18:00:00Z', 'Pipe repair', now() + interval '10 minutes') $q$);
SELECT t.expect_ok('B08 consume preview (UPDATE allowed)', $q$
  UPDATE bookings.closure_previews
  SET consumed_at = now(), closure_id = 'd0000000-0000-0000-0000-000000000001'
  WHERE id = 'e0000000-0000-0000-0000-000000000001' $q$);
SELECT t.expect_err('B09 DELETE on closure_previews denied', '42501', $q$
  DELETE FROM bookings.closure_previews WHERE id = 'e0000000-0000-0000-0000-000000000001' $q$);

-- Section C: idempotency_records
SELECT t.expect_ok('C01 insert valid record', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /closures/confirm',
          '11111111-1111-1111-1111-111111111111', repeat('a', 64), 201, '{"data":{"ok":true}}'::jsonb) $q$);
SELECT t.expect_err('C02 duplicate tuple rejected', '23505', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /closures/confirm',
          '11111111-1111-1111-1111-111111111111', repeat('b', 64), 201, '{}'::jsonb) $q$);
SELECT t.expect_ok('C03 same key, different endpoint allowed', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /other',
          '11111111-1111-1111-1111-111111111111', repeat('a', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_ok('C04 same key, different user allowed', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000002', 'POST /closures/confirm',
          '11111111-1111-1111-1111-111111111111', repeat('a', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C05 uppercase fingerprint rejected', '23514', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /x',
          '22222222-2222-2222-2222-222222222222', repeat('A', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C06 short fingerprint rejected', '23514', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /x',
          '22222222-2222-2222-2222-222222222222', 'abc', 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C07 non-2xx status rejected', '23514', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', 'POST /x',
          '22222222-2222-2222-2222-222222222222', repeat('a', 64), 500, '{}'::jsonb) $q$);
SELECT t.expect_err('C08 blank caller_service rejected', '23514', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('   ', 'a0000000-0000-0000-0000-000000000001', 'POST /x',
          '22222222-2222-2222-2222-222222222222', repeat('a', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C09 blank endpoint rejected', '23514', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-000000000001', '   ',
          '22222222-2222-2222-2222-222222222222', repeat('a', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C10 unknown user rejected', '23503', $q$
  INSERT INTO bookings.idempotency_records (caller_service, user_id, endpoint, idempotency_key,
      request_fingerprint, response_status, response_body)
  VALUES ('maintenance', 'a0000000-0000-0000-0000-0000000000ff', 'POST /x',
          '22222222-2222-2222-2222-222222222222', repeat('a', 64), 200, '{}'::jsonb) $q$);
SELECT t.expect_err('C11 UPDATE on idempotency_records denied', '42501', $q$
  UPDATE bookings.idempotency_records SET response_status = 200 $q$);
SELECT t.expect_err('C12 DELETE on idempotency_records denied', '42501', $q$
  DELETE FROM bookings.idempotency_records $q$);

-- Section D: notification_jobs
SELECT t.expect_ok('D01 insert job with defaults', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CONFIRMED') $q$);
SELECT t.expect_ok('D02 defaults are correct', $q$
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM bookings.notification_jobs
                   WHERE booking_id = '10000000-0000-0000-0000-000000000001'
                     AND state = 'PENDING' AND attempts = 0 AND recipient_email IS NULL
                     AND sent_at IS NULL AND payload = '{}'::jsonb) THEN
      RAISE EXCEPTION 'defaults wrong';
    END IF;
  END $d$ $q$);
SELECT t.expect_err('D03 duplicate (booking_id, kind) rejected', '23505', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CONFIRMED') $q$);
SELECT t.expect_err('D04 closure kind needs closure_id', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CANCELLED_BY_CLOSURE') $q$);
SELECT t.expect_err('D05 non-closure kind forbids closure_id', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, closure_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'BOOKING_CANCELLED') $q$);
SELECT t.expect_err('D06 unknown kind rejected', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'NEWSLETTER') $q$);
SELECT t.expect_err('D07 SENT requires sent_at', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind, state)
  VALUES ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CANCELLED', 'SENT') $q$);
SELECT t.expect_err('D08 PENDING forbids sent_at', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind, state, sent_at)
  VALUES ('10000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CANCELLED', 'PENDING', now()) $q$);
SELECT t.expect_err('D09 negative attempts rejected', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind, attempts)
  VALUES ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CONFIRMED', -1) $q$);
SELECT t.expect_err('D10 blank recipient_email rejected', '23514', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind, recipient_email)
  VALUES ('10000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CONFIRMED', '   ') $q$);
SELECT t.expect_err('D11 unknown booking rejected', '23503', $q$
  INSERT INTO bookings.notification_jobs (booking_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-0000000000ff', 'a0000000-0000-0000-0000-000000000002', 'BOOKING_CONFIRMED') $q$);
SELECT t.expect_ok('D12 mark job SENT (UPDATE allowed)', $q$
  UPDATE bookings.notification_jobs
  SET state = 'SENT', sent_at = now(), attempts = 1, provider_message_id = 'msg-1', updated_at = now()
  WHERE booking_id = '10000000-0000-0000-0000-000000000001' AND kind = 'BOOKING_CONFIRMED' $q$);
SELECT t.expect_ok('D13 closure job with closure_id', $q$
  INSERT INTO bookings.notification_jobs (booking_id, closure_id, user_id, kind)
  VALUES ('10000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-000000000002', 'BOOKING_CANCELLED_BY_CLOSURE') $q$);
SELECT t.expect_err('D14 DELETE on notification_jobs denied', '42501', $q$
  DELETE FROM bookings.notification_jobs $q$);
SELECT t.expect_ok('D15 pending partial index exists', $q$
  DO $d$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes
                   WHERE schemaname = 'bookings' AND indexname = 'notification_jobs_pending_idx'
                     AND indexdef LIKE '%WHERE%' AND indexdef LIKE '%PENDING%') THEN
      RAISE EXCEPTION 'index missing or not partial';
    END IF;
  END $d$ $q$);

-- Section E: another runtime role must not reach the new tables
RESET ROLE;
SET ROLE maintenance_app;
SELECT t.expect_err('E01 maintenance_app denied on idempotency_records', '42501', $q$
  SELECT 1 FROM bookings.idempotency_records $q$);
SELECT t.expect_err('E02 maintenance_app denied on notification_jobs', '42501', $q$
  SELECT 1 FROM bookings.notification_jobs $q$);
SELECT t.expect_err('E03 maintenance_app denied on closure_previews', '42501', $q$
  SELECT 1 FROM bookings.closure_previews $q$);
RESET ROLE;

SELECT 'END_OF_TESTS';
