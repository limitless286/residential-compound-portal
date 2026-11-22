BEGIN;

CREATE TABLE identity.buildings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(code)) > 0),
    CHECK (length(trim(name)) > 0)
);

CREATE TABLE identity.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID NOT NULL
        REFERENCES identity.buildings(id) ON DELETE RESTRICT,
    unit_number VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (building_id, unit_number),
    CHECK (length(trim(unit_number)) > 0),
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE TABLE identity.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID
        REFERENCES identity.units(id) ON DELETE RESTRICT,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'RESIDENT',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(full_name)) > 0),
    CHECK (email = lower(trim(email)) AND length(email) > 0),
    CHECK (length(password_hash) > 0),
    CHECK (role IN ('RESIDENT', 'ADMIN')),
    CHECK (status IN ('ACTIVE', 'DISABLED')),
    CHECK (role <> 'RESIDENT' OR unit_id IS NOT NULL)
);

CREATE INDEX users_unit_id_idx ON identity.users(unit_id);

GRANT SELECT, INSERT, UPDATE
ON identity.buildings, identity.units, identity.users
TO maintenance_app;

COMMIT;
