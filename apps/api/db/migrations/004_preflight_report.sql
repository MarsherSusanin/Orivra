BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS run_artifacts_one_preflight_report_per_run_idx
    ON proofline_private.run_artifacts (run_id)
    WHERE kind = 'preflight-report-v1';

INSERT INTO proofline_private.schema_migrations (version)
VALUES (4)
ON CONFLICT (version) DO NOTHING;

COMMIT;
