-- Migration 005: bookings support tables.
-- Run once using the database owner, in numbered order.
-- This is a one-time migration; do not rerun it.
-- Never edit this file after it has run; add a new numbered file instead.
BEGIN;

CREATE TABLE bookings.closure_previews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    maintenance_request_id UUID NOT NULL,
    facility_id UUID NOT NULL
        REFERENCES bookings.facilities(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    affected_booking_ids UUID[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    closure_id UUID NULL
        REFERENCES bookings.facility_closures(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_at > start_at),
    CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
    CHECK (expires_at > created_at),
    CHECK ((consumed_at IS NULL) = (closure_id IS NULL))
);

CREATE INDEX closure_previews_created_by_expires_idx
    ON bookings.closure_previews(created_by, expires_at);

GRANT SELECT, INSERT, UPDATE
ON bookings.closure_previews
TO bookings_app;

CREATE TABLE bookings.idempotency_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caller_service VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    endpoint VARCHAR(100) NOT NULL,
    idempotency_key UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    response_status SMALLINT NOT NULL,
    response_body JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (caller_service, user_id, endpoint, idempotency_key),
    CHECK (length(trim(caller_service)) > 0),
    CHECK (length(trim(endpoint)) > 0),
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CHECK (response_status BETWEEN 200 AND 299)
);

GRANT SELECT, INSERT
ON bookings.idempotency_records
TO bookings_app;

CREATE TABLE bookings.notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL
        REFERENCES bookings.bookings(id) ON DELETE RESTRICT,
    closure_id UUID NULL
        REFERENCES bookings.facility_closures(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    kind VARCHAR(40) NOT NULL,
    recipient_email VARCHAR(254) NULL,
    recipient_name VARCHAR(200) NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    state VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_error VARCHAR(500) NULL,
    provider_message_id VARCHAR(100) NULL,
    sent_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (booking_id, kind),
    CHECK (kind IN ('BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_CANCELLED_BY_CLOSURE')),
    CHECK (state IN ('PENDING', 'SENT', 'FAILED')),
    CHECK (attempts >= 0),
    CHECK (recipient_email IS NULL OR length(trim(recipient_email)) > 0),
    CHECK ((state = 'SENT') = (sent_at IS NOT NULL)),
    CHECK ((kind = 'BOOKING_CANCELLED_BY_CLOSURE') = (closure_id IS NOT NULL))
);

CREATE INDEX notification_jobs_pending_idx
    ON bookings.notification_jobs(next_attempt_at)
    WHERE state = 'PENDING';

GRANT SELECT, INSERT, UPDATE
ON bookings.notification_jobs
TO bookings_app;

COMMIT;
