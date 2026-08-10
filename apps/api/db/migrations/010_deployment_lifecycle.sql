BEGIN;

CREATE TABLE IF NOT EXISTS proofline_private.migration_checksums (
    version integer PRIMARY KEY REFERENCES proofline_private.schema_migrations(version) ON DELETE RESTRICT,
    -- Example accepted predicate: filename ~ '^[0-9]{3}_migration_name[.]sql$'.
    filename text NOT NULL UNIQUE
        CHECK (filename ~ '^[0-9]{3}_[a-z0-9_]+[.]sql$'),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32)
);

CREATE OR REPLACE FUNCTION proofline_private.prevent_migration_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'migration history is immutable: % is forbidden', TG_OP;
END
$function$;

DROP TRIGGER IF EXISTS schema_migrations_immutable
    ON proofline_private.schema_migrations;
CREATE TRIGGER schema_migrations_immutable
BEFORE UPDATE OR DELETE ON proofline_private.schema_migrations
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_migration_history_mutation();

DROP TRIGGER IF EXISTS schema_migrations_no_truncate
    ON proofline_private.schema_migrations;
CREATE TRIGGER schema_migrations_no_truncate
BEFORE TRUNCATE ON proofline_private.schema_migrations
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_migration_history_mutation();

DROP TRIGGER IF EXISTS migration_checksums_immutable
    ON proofline_private.migration_checksums;
CREATE TRIGGER migration_checksums_immutable
BEFORE UPDATE OR DELETE ON proofline_private.migration_checksums
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_migration_history_mutation();

DROP TRIGGER IF EXISTS migration_checksums_no_truncate
    ON proofline_private.migration_checksums;
CREATE TRIGGER migration_checksums_no_truncate
BEFORE TRUNCATE ON proofline_private.migration_checksums
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_migration_history_mutation();

CREATE TABLE IF NOT EXISTS proofline_private.deployment_worker_heartbeats (
    deployment_id text NOT NULL
        CHECK (deployment_id ~ '^deployment_[a-f0-9]{64}$'),
    worker_instance_id uuid NOT NULL,
    release_tree_sha text NOT NULL
        CHECK (release_tree_sha ~ '^[a-f0-9]{40}$'),
    started_at timestamptz NOT NULL
        CHECK (started_at = date_trunc('milliseconds', started_at)),
    last_heartbeat_at timestamptz NOT NULL
        CHECK (last_heartbeat_at = date_trunc('milliseconds', last_heartbeat_at)),
    stopped_at timestamptz
        CHECK (stopped_at IS NULL OR stopped_at = date_trunc('milliseconds', stopped_at)),
    PRIMARY KEY (deployment_id, worker_instance_id),
    CONSTRAINT deployment_worker_heartbeat_order_check
        CHECK (last_heartbeat_at >= started_at),
    CONSTRAINT deployment_worker_stopped_order_check
        CHECK (stopped_at IS NULL OR stopped_at >= last_heartbeat_at)
);

CREATE INDEX IF NOT EXISTS deployment_worker_heartbeats_current_idx
    ON proofline_private.deployment_worker_heartbeats
        (deployment_id, release_tree_sha, last_heartbeat_at DESC)
    WHERE stopped_at IS NULL;

CREATE INDEX IF NOT EXISTS deployment_worker_heartbeats_retention_idx
    ON proofline_private.deployment_worker_heartbeats
        (last_heartbeat_at, deployment_id, worker_instance_id);

REVOKE ALL ON TABLE proofline_private.schema_migrations FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.migration_checksums FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.deployment_worker_heartbeats FROM PUBLIC;

GRANT SELECT ON TABLE
    proofline_private.schema_migrations,
    proofline_private.migration_checksums
    TO proofline_api, proofline_worker, proofline_recording_importer;

GRANT SELECT ON TABLE proofline_private.deployment_worker_heartbeats
    TO proofline_api;
GRANT SELECT, INSERT, DELETE ON TABLE proofline_private.deployment_worker_heartbeats
    TO proofline_worker;
GRANT UPDATE (last_heartbeat_at, stopped_at)
    ON TABLE proofline_private.deployment_worker_heartbeats
    TO proofline_worker;

INSERT INTO proofline_private.schema_migrations (version)
VALUES (10)
ON CONFLICT (version) DO NOTHING;

COMMIT;
