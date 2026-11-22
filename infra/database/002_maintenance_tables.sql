BEGIN;

CREATE TABLE maintenance.priority_policies (
    priority VARCHAR(20) PRIMARY KEY,
    resolution_hours INTEGER NOT NULL CHECK (resolution_hours > 0),
    CHECK (priority IN ('HIGH', 'MEDIUM', 'LOW'))
);

INSERT INTO maintenance.priority_policies (priority, resolution_hours)
VALUES
    ('HIGH', 24),
    ('MEDIUM', 72),
    ('LOW', 168);

CREATE TABLE maintenance.requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL
        REFERENCES identity.units(id) ON DELETE RESTRICT,
    facility_id UUID,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(30) NOT NULL,
    location_description VARCHAR(200) NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
        REFERENCES maintenance.priority_policies(priority),
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    due_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(title)) BETWEEN 3 AND 150),
    CHECK (length(trim(description)) BETWEEN 10 AND 5000),
    CHECK (length(trim(location_description)) > 0),
    CHECK (category IN (
        'PLUMBING', 'ELECTRICAL', 'CLEANING',
        'STRUCTURAL', 'OTHER'
    )),
    CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    CHECK (due_at > created_at)
);

CREATE TABLE maintenance.request_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID NOT NULL
        REFERENCES maintenance.requests(id) ON DELETE RESTRICT,
    actor_user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    event_type VARCHAR(30) NOT NULL,
    previous_status VARCHAR(20),
    next_status VARCHAR(20) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (event_type IN (
        'CREATED', 'STARTED', 'RESOLVED',
        'CLOSED', 'REOPENED', 'PRIORITY_CHANGED'
    )),
    CHECK (
        previous_status IS NULL OR
        previous_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')
    ),
    CHECK (next_status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    CHECK (
        event_type NOT IN ('REOPENED', 'PRIORITY_CHANGED') OR
        (reason IS NOT NULL AND length(trim(reason)) > 0)
    )
);

CREATE INDEX requests_user_id_idx
    ON maintenance.requests(user_id);

CREATE INDEX requests_unit_id_idx
    ON maintenance.requests(unit_id);

CREATE INDEX requests_active_deadline_idx
    ON maintenance.requests(due_at)
    WHERE status IN ('OPEN', 'IN_PROGRESS');

CREATE INDEX request_history_request_id_idx
    ON maintenance.request_history(request_id, created_at);

GRANT SELECT, INSERT, UPDATE
ON maintenance.requests TO maintenance_app;

GRANT SELECT, INSERT
ON maintenance.request_history TO maintenance_app;

GRANT SELECT, UPDATE
ON maintenance.priority_policies TO maintenance_app;

COMMIT;
