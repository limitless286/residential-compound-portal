-- Migration 007: maintenance overdue notifications.
-- Run once using the database owner.
-- Depends on 002 (maintenance.requests), not on 005 or 006.
-- Never edit this migration after it has been executed.

BEGIN;

CREATE TABLE maintenance.overdue_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    request_id UUID NOT NULL
        REFERENCES maintenance.requests(id) ON DELETE RESTRICT,

    due_at TIMESTAMPTZ NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,

    priority VARCHAR(20) NOT NULL
        CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW')),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (request_id, due_at, window_start),

    CHECK (due_at < created_at),
    CHECK (window_start <= created_at)
);

CREATE INDEX overdue_notifications_created_at_idx
    ON maintenance.overdue_notifications(created_at DESC, id DESC);

GRANT SELECT, INSERT
ON maintenance.overdue_notifications
TO maintenance_app;

COMMIT;
