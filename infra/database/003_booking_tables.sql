BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings.facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location_description VARCHAR(200) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(name)) > 0),
    CHECK (length(trim(location_description)) > 0),
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE bookings.opening_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL
        REFERENCES bookings.facilities(id) ON DELETE RESTRICT,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    opens_at TIME NOT NULL,
    closes_at TIME NOT NULL,
    UNIQUE (facility_id, day_of_week),
    CHECK (closes_at > opens_at)
);

CREATE TABLE bookings.booking_policies (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    max_future_bookings_per_unit INTEGER NOT NULL
        CHECK (max_future_bookings_per_unit > 0),
    advance_days INTEGER NOT NULL CHECK (advance_days > 0),
    cancellation_cutoff_minutes INTEGER NOT NULL
        CHECK (cancellation_cutoff_minutes >= 0),
    allowed_duration_minutes INTEGER[] NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        cardinality(allowed_duration_minutes) > 0
        AND array_position(allowed_duration_minutes, NULL) IS NULL
        AND 0 < ALL(allowed_duration_minutes)
    )
);

INSERT INTO bookings.booking_policies (
    id,
    max_future_bookings_per_unit,
    advance_days,
    cancellation_cutoff_minutes,
    allowed_duration_minutes
)
VALUES (TRUE, 2, 7, 120, ARRAY[60, 120]);

CREATE TABLE bookings.facility_closures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL
        REFERENCES bookings.facilities(id) ON DELETE RESTRICT,
    maintenance_request_id UUID
        REFERENCES maintenance.requests(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    cleared_by UUID
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    cleared_at TIMESTAMPTZ,
    clear_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_at > start_at),
    CHECK (length(trim(reason)) > 0),
    CHECK (status IN ('ACTIVE', 'CLEARED')),
    CHECK (
        (
            status = 'ACTIVE'
            AND cleared_by IS NULL
            AND cleared_at IS NULL
            AND clear_reason IS NULL
        )
        OR
        (
            status = 'CLEARED'
            AND cleared_by IS NOT NULL
            AND cleared_at IS NOT NULL
            AND clear_reason IS NOT NULL
            AND length(trim(clear_reason)) > 0
        )
    )
);

CREATE TABLE bookings.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL
        REFERENCES bookings.facilities(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    unit_id UUID NOT NULL
        REFERENCES identity.units(id) ON DELETE RESTRICT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    cancelled_by UUID
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    closure_id UUID
        REFERENCES bookings.facility_closures(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_at > start_at),
    CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED')),
    CHECK (
        (
            status = 'CANCELLED'
            AND cancelled_by IS NOT NULL
            AND cancelled_at IS NOT NULL
            AND cancellation_reason IS NOT NULL
            AND length(trim(cancellation_reason)) > 0
        )
        OR
        (
            status <> 'CANCELLED'
            AND cancelled_by IS NULL
            AND cancelled_at IS NULL
            AND cancellation_reason IS NULL
            AND closure_id IS NULL
        )
    ),
    CONSTRAINT bookings_no_overlap
        EXCLUDE USING gist (
            facility_id WITH =,
            tstzrange(start_at, end_at, '[)') WITH &&
        )
        WHERE (status IN ('CONFIRMED', 'COMPLETED'))
);

CREATE INDEX bookings_user_id_idx
    ON bookings.bookings(user_id);

CREATE INDEX bookings_unit_start_idx
    ON bookings.bookings(unit_id, start_at)
    WHERE status = 'CONFIRMED';

CREATE INDEX closures_facility_start_idx
    ON bookings.facility_closures(facility_id, start_at)
    WHERE status = 'ACTIVE';

ALTER TABLE maintenance.requests
ADD CONSTRAINT requests_facility_id_fk
FOREIGN KEY (facility_id)
REFERENCES bookings.facilities(id)
ON DELETE RESTRICT;

GRANT SELECT, INSERT, UPDATE
ON bookings.facilities, bookings.facility_closures, bookings.bookings
TO bookings_app;

GRANT SELECT, INSERT, UPDATE, DELETE
ON bookings.opening_hours
TO bookings_app;

GRANT SELECT, UPDATE
ON bookings.booking_policies
TO bookings_app;

COMMIT;
