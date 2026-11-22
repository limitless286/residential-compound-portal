BEGIN;

CREATE TABLE community.fee_policies (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    monthly_amount_minor INTEGER NOT NULL CHECK (monthly_amount_minor > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
    due_day SMALLINT NOT NULL CHECK (due_day BETWEEN 1 AND 28),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE community.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL
        REFERENCES identity.units(id) ON DELETE RESTRICT,
    billing_period DATE NOT NULL,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EGP' CHECK (currency = 'EGP'),
    due_date DATE NOT NULL,
    generated_by UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (unit_id, billing_period),
    CHECK (EXTRACT(DAY FROM billing_period) = 1),
    CHECK (due_date >= billing_period)
);

CREATE TABLE community.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL
        REFERENCES community.invoices(id) ON DELETE RESTRICT,
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    payment_reference VARCHAR(100) NOT NULL UNIQUE,
    payment_method VARCHAR(20) NOT NULL,
    paid_at TIMESTAMPTZ NOT NULL,
    recorded_by UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    idempotency_key UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(payment_reference)) > 0),
    CHECK (payment_method IN ('CASH', 'BANK_TRANSFER'))
);

CREATE VIEW community.invoice_balances AS
SELECT
    i.id,
    i.unit_id,
    i.billing_period,
    i.amount_minor,
    i.currency,
    i.due_date,
    COALESCE(p.paid_amount_minor, 0::BIGINT) AS paid_amount_minor,
    i.amount_minor::BIGINT
        - COALESCE(p.paid_amount_minor, 0::BIGINT) AS remaining_amount_minor,
    CASE
        WHEN COALESCE(p.paid_amount_minor, 0::BIGINT) = 0
            THEN 'UNPAID'
        WHEN p.paid_amount_minor < i.amount_minor
            THEN 'PARTIALLY_PAID'
        ELSE 'PAID'
    END AS status,
    (
        i.due_date < (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo')::DATE
        AND COALESCE(p.paid_amount_minor, 0::BIGINT) < i.amount_minor
    ) AS is_overdue,
    i.created_at
FROM community.invoices i
LEFT JOIN (
    SELECT invoice_id, SUM(amount_minor) AS paid_amount_minor
    FROM community.payments
    GROUP BY invoice_id
) p ON p.invoice_id = i.id;

CREATE TABLE community.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    body TEXT NOT NULL,
    audience_type VARCHAR(20) NOT NULL DEFAULT 'ALL',
    building_id UUID
        REFERENCES identity.buildings(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    publish_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_by UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    approved_by UUID
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    maintenance_request_id UUID
        REFERENCES maintenance.requests(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(trim(title)) BETWEEN 3 AND 150),
    CHECK (length(trim(body)) BETWEEN 10 AND 10000),
    CHECK (audience_type IN ('ALL', 'BUILDING')),
    CHECK (
        (audience_type = 'ALL' AND building_id IS NULL)
        OR
        (audience_type = 'BUILDING' AND building_id IS NOT NULL)
    ),
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED')),
    CHECK (
        status = 'DRAFT'
        OR (publish_at IS NOT NULL AND approved_by IS NOT NULL)
    ),
    CHECK (
        expires_at IS NULL
        OR (publish_at IS NOT NULL AND expires_at > publish_at)
    )
);

CREATE TABLE community.announcement_reads (
    announcement_id UUID NOT NULL
        REFERENCES community.announcements(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL
        REFERENCES identity.users(id) ON DELETE RESTRICT,
    read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX payments_invoice_id_idx
    ON community.payments(invoice_id);

CREATE INDEX invoices_due_date_idx
    ON community.invoices(due_date);

CREATE INDEX announcements_schedule_idx
    ON community.announcements(status, publish_at);

GRANT SELECT, INSERT, UPDATE
ON community.fee_policies, community.announcements
TO community_app;

GRANT SELECT, INSERT
ON community.invoices, community.payments, community.announcement_reads
TO community_app;

GRANT SELECT
ON community.invoice_balances
TO community_app;

COMMIT;
