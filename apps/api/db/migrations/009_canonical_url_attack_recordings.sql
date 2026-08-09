BEGIN;

DO $roles$
BEGIN
    CREATE ROLE proofline_recording_importer NOLOGIN;
EXCEPTION WHEN duplicate_object THEN
    NULL;
END
$roles$;

CREATE TABLE IF NOT EXISTS proofline_private.canonical_url_attack_recordings (
    recording_sha256 bytea NOT NULL
        CHECK (octet_length(recording_sha256) = 32),
    recording_checksum bytea NOT NULL
        CHECK (octet_length(recording_checksum) = 32),
    authority_recording_checksum bytea NOT NULL
        CHECK (octet_length(authority_recording_checksum) = 32),
    canonical_bytes bytea NOT NULL,
    canonical_utf8_bytes integer NOT NULL
        CHECK (canonical_utf8_bytes BETWEEN 1 AND 6291456),
    recorded_at timestamptz NOT NULL
        CHECK (recorded_at = date_trunc('milliseconds', recorded_at)),
    release_commit_sha text NOT NULL
        CHECK (release_commit_sha ~ '^[a-f0-9]{40}$'),
    release_tree_sha text NOT NULL
        CHECK (release_tree_sha ~ '^[a-f0-9]{40}$'),
    attack_run_id text NOT NULL
        CHECK (attack_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    control_run_id text NOT NULL
        CHECK (control_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
    runtime_authority text NOT NULL
        CHECK (runtime_authority = 'fdc-coston2-runtime-v1'),
    runtime_verified_at timestamptz NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (recording_sha256),
    UNIQUE (recording_checksum),
    CONSTRAINT canonical_url_attack_authority_checksum_check CHECK (
        authority_recording_checksum = recording_checksum
    ),
    CONSTRAINT canonical_url_attack_recording_bytes_check CHECK (
        canonical_utf8_bytes = octet_length(canonical_bytes)
    ),
    CONSTRAINT canonical_url_attack_distinct_runs_check CHECK (
        attack_run_id <> control_run_id
    )
);

CREATE OR REPLACE FUNCTION proofline_private.prevent_canonical_url_attack_recording_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    RAISE EXCEPTION 'canonical_url_attack_recordings are append-only and immutable: % is forbidden', TG_OP;
END
$function$;

DROP TRIGGER IF EXISTS canonical_url_attack_recordings_append_only
    ON proofline_private.canonical_url_attack_recordings;
CREATE TRIGGER canonical_url_attack_recordings_append_only
BEFORE UPDATE OR DELETE ON proofline_private.canonical_url_attack_recordings
FOR EACH ROW EXECUTE FUNCTION proofline_private.prevent_canonical_url_attack_recording_mutation();

DROP TRIGGER IF EXISTS canonical_url_attack_recordings_no_truncate
    ON proofline_private.canonical_url_attack_recordings;
CREATE TRIGGER canonical_url_attack_recordings_no_truncate
BEFORE TRUNCATE ON proofline_private.canonical_url_attack_recordings
FOR EACH STATEMENT EXECUTE FUNCTION proofline_private.prevent_canonical_url_attack_recording_mutation();

REVOKE ALL ON TABLE proofline_private.canonical_url_attack_recordings FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.canonical_url_attack_recordings FROM proofline_worker;
GRANT USAGE ON SCHEMA proofline_private TO proofline_recording_importer;
GRANT SELECT, INSERT ON TABLE proofline_private.canonical_url_attack_recordings
    TO proofline_recording_importer;
GRANT SELECT ON TABLE proofline_private.canonical_url_attack_recordings
    TO proofline_api;

INSERT INTO proofline_private.schema_migrations (version)
VALUES (9)
ON CONFLICT (version) DO NOTHING;

COMMIT;
