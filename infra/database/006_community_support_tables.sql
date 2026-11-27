-- Migration 006: community support tables.
-- Run once using the database owner, in numbered order.
-- This is a one-time migration; do not rerun it.
-- Never edit this file after it has run; add a new numbered file instead.
-- Depends only on 001 (identity.users) and 004 (community schema objects).
-- It does not depend on 005.
-- Adds: idempotency records, a read-receipt index, and a column-level
-- UPDATE grant that enables invoice row locking for payments.
BEGIN;

CREATE TABLE community.idempotency_records (
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

CREATE INDEX announcement_reads_user_id_idx
    ON community.announcement_reads(user_id);

GRANT SELECT, INSERT
ON community.idempotency_records
TO community_app;

-- PostgreSQL requires UPDATE privilege on at least one column before a
-- role may use SELECT ... FOR UPDATE. lock_version is a technical column
-- that exists only to carry that privilege, so payment recording can take
-- a real row lock on the invoice without UPDATE access to financial fields
-- (id, unit_id, billing_period, amount_minor, currency, due_date,
-- generated_by, created_at). The payment workflow does not modify it.
ALTER TABLE community.invoices
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 0;

GRANT UPDATE (lock_version)
ON community.invoices
TO community_app;

COMMIT;