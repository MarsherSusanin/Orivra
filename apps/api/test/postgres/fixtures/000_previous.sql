CREATE SCHEMA proofline_private;

CREATE TABLE proofline_private.projects (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proofline_private.runs (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    idempotency_key text NOT NULL,
    request_fingerprint bytea NOT NULL,
    manifest jsonb NOT NULL,
    projection jsonb,
    last_sequence bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, idempotency_key)
);

CREATE TABLE proofline_private.schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO proofline_private.schema_migrations (version) VALUES (0);
