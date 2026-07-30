BEGIN;

CREATE SCHEMA IF NOT EXISTS proofline_private;

DO $roles$
BEGIN
    CREATE ROLE proofline_api NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$roles$;

DO $roles$
BEGIN
    CREATE ROLE proofline_worker NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$roles$;

CREATE TABLE IF NOT EXISTS proofline_private.projects (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proofline_private.api_tokens (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    scope text NOT NULL CHECK (scope IN ('project')),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proofline_private.runs (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    idempotency_key text NOT NULL,
    request_fingerprint bytea NOT NULL CHECK (octet_length(request_fingerprint) = 32),
    manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'object'),
    projection jsonb CHECK (projection IS NULL OR jsonb_typeof(projection) = 'object'),
    last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS proofline_private.run_events (
    run_id uuid NOT NULL REFERENCES proofline_private.runs(id),
    sequence bigint NOT NULL CHECK (sequence > 0),
    dedupe_key text NOT NULL,
    event_type text NOT NULL,
    event_payload jsonb NOT NULL CHECK (jsonb_typeof(event_payload) = 'object'),
    occurred_at timestamptz NOT NULL,
    PRIMARY KEY (run_id, sequence),
    UNIQUE (run_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS proofline_private.run_artifacts (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES proofline_private.runs(id),
    kind text NOT NULL,
    canonical_bytes bytea NOT NULL,
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (run_id, kind, sha256)
);

CREATE TABLE IF NOT EXISTS proofline_private.run_commands (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    run_id uuid NOT NULL REFERENCES proofline_private.runs(id),
    idempotency_key text NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'leased', 'succeeded', 'dead', 'cancelled')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_token uuid,
    lease_expires_at timestamptz,
    last_error jsonb CHECK (last_error IS NULL OR jsonb_typeof(last_error) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS proofline_private.relayer_transactions (
    id uuid PRIMARY KEY,
    run_id uuid NOT NULL REFERENCES proofline_private.runs(id),
    idempotency_key text NOT NULL UNIQUE,
    chain_id smallint NOT NULL CHECK (chain_id = 114),
    from_address bytea NOT NULL CHECK (octet_length(from_address) = 20),
    nonce numeric(78, 0) NOT NULL CHECK (nonce >= 0),
    target_address bytea NOT NULL CHECK (octet_length(target_address) = 20),
    calldata_hash bytea NOT NULL CHECK (octet_length(calldata_hash) = 32),
    command_fingerprint bytea NOT NULL CHECK (octet_length(command_fingerprint) = 32),
    value_wei numeric(78, 0) NOT NULL CHECK (value_wei >= 0),
    raw_signed_transaction bytea NOT NULL,
    transaction_hash bytea NOT NULL UNIQUE CHECK (octet_length(transaction_hash) = 32),
    broadcast_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT relayer_transactions_run_id_unique UNIQUE (run_id),
    UNIQUE (chain_id, from_address, nonce)
);

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'relayer_transactions_run_id_unique'
          AND conrelid = 'proofline_private.relayer_transactions'::regclass
    ) THEN
        ALTER TABLE proofline_private.relayer_transactions
            ADD CONSTRAINT relayer_transactions_run_id_unique UNIQUE (run_id);
    END IF;
END
$constraints$;

CREATE TABLE IF NOT EXISTS proofline_private.share_tokens (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    run_id uuid NOT NULL REFERENCES proofline_private.runs(id),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proofline_private.relayer_audit_events (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    run_id uuid REFERENCES proofline_private.runs(id) ON DELETE SET NULL,
    event_type text NOT NULL,
    evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proofline_private.schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO proofline_private.schema_migrations (version)
VALUES (1)
ON CONFLICT (version) DO NOTHING;

CREATE OR REPLACE FUNCTION proofline_private.prevent_run_event_update_or_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'run_events are append-only: % is forbidden', TG_OP;
END
$function$;

DROP TRIGGER IF EXISTS run_events_append_only ON proofline_private.run_events;
CREATE TRIGGER run_events_append_only
BEFORE UPDATE OR DELETE ON proofline_private.run_events
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

DROP TRIGGER IF EXISTS run_events_no_truncate ON proofline_private.run_events;
CREATE TRIGGER run_events_no_truncate
BEFORE TRUNCATE ON proofline_private.run_events
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

DROP TRIGGER IF EXISTS relayer_audit_events_append_only ON proofline_private.relayer_audit_events;
CREATE TRIGGER relayer_audit_events_append_only
BEFORE UPDATE OR DELETE ON proofline_private.relayer_audit_events
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

DROP TRIGGER IF EXISTS relayer_audit_events_no_truncate ON proofline_private.relayer_audit_events;
CREATE TRIGGER relayer_audit_events_no_truncate
BEFORE TRUNCATE ON proofline_private.relayer_audit_events
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

DROP TRIGGER IF EXISTS run_artifacts_append_only ON proofline_private.run_artifacts;
CREATE TRIGGER run_artifacts_append_only
BEFORE UPDATE OR DELETE ON proofline_private.run_artifacts
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

DROP TRIGGER IF EXISTS run_artifacts_no_truncate ON proofline_private.run_artifacts;
CREATE TRIGGER run_artifacts_no_truncate
BEFORE TRUNCATE ON proofline_private.run_artifacts
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_run_event_update_or_delete();

CREATE INDEX IF NOT EXISTS run_events_run_id_sequence_idx
    ON proofline_private.run_events (run_id, sequence);
CREATE INDEX IF NOT EXISTS run_commands_available_at_created_at_queued_idx
    ON proofline_private.run_commands (available_at, created_at)
    WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS run_commands_expired_lease_idx
    ON proofline_private.run_commands (lease_expires_at, created_at)
    WHERE status = 'leased';
CREATE UNIQUE INDEX IF NOT EXISTS run_commands_one_relayer_submission_per_run_idx
    ON proofline_private.run_commands (run_id)
    WHERE kind = 'SUBMIT_RELAYER' AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS share_tokens_token_digest_idx
    ON proofline_private.share_tokens (token_digest);
CREATE INDEX IF NOT EXISTS runs_project_id_created_at_idx
    ON proofline_private.runs (project_id, created_at DESC);

REVOKE ALL ON SCHEMA proofline_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA proofline_private FROM PUBLIC;
GRANT USAGE ON SCHEMA proofline_private TO proofline_api, proofline_worker;
GRANT SELECT, INSERT, UPDATE ON proofline_private.projects,
    proofline_private.api_tokens,
    proofline_private.runs,
    proofline_private.share_tokens
    TO proofline_api;
GRANT SELECT, INSERT ON proofline_private.run_artifacts TO proofline_api;
GRANT SELECT, INSERT ON proofline_private.run_events TO proofline_api;
GRANT SELECT ON proofline_private.relayer_transactions,
    proofline_private.relayer_audit_events
    TO proofline_api;
GRANT SELECT ON proofline_private.projects,
    proofline_private.runs,
    proofline_private.run_events,
    proofline_private.run_artifacts,
    proofline_private.run_commands,
    proofline_private.relayer_transactions
    TO proofline_worker;
GRANT INSERT ON proofline_private.run_events,
    proofline_private.run_artifacts,
    proofline_private.relayer_transactions,
    proofline_private.relayer_audit_events
    TO proofline_worker;
GRANT UPDATE (broadcast_at)
    ON proofline_private.relayer_transactions
    TO proofline_worker;
GRANT UPDATE ON proofline_private.runs,
    proofline_private.run_commands
    TO proofline_worker;

COMMIT;
