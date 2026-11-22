BEGIN;

CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS maintenance;
CREATE SCHEMA IF NOT EXISTS bookings;
CREATE SCHEMA IF NOT EXISTS community;

DO $$
DECLARE
    account_name TEXT;
BEGIN
    FOREACH account_name IN ARRAY ARRAY[
        'maintenance_app',
        'bookings_app',
        'community_app'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_roles WHERE rolname = account_name
        ) THEN
            EXECUTE format(
                'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS',
                account_name
            );
        END IF;
    END LOOP;
END
$$;

REVOKE ALL ON SCHEMA identity, maintenance, bookings, community
FROM PUBLIC;

GRANT USAGE ON SCHEMA identity, maintenance TO maintenance_app;
GRANT USAGE ON SCHEMA bookings TO bookings_app;
GRANT USAGE ON SCHEMA community TO community_app;

COMMIT;

-- Set role passwords separately through private administration.
-- Never add real passwords to this file.
-- Run numbered migration files in order using the database owner.
-- Files 001 onward are one-time migrations; do not rerun them.
