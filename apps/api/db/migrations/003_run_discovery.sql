BEGIN;

CREATE INDEX IF NOT EXISTS runs_project_id_updated_at_id_idx
    ON proofline_private.runs (project_id, updated_at DESC, id DESC);

INSERT INTO proofline_private.schema_migrations (version)
VALUES (3)
ON CONFLICT (version) DO NOTHING;

COMMIT;
