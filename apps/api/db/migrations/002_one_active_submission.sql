BEGIN;

DO $submission_integrity$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM proofline_private.run_commands
        WHERE kind IN ('SUBMIT_RELAYER', 'ATTACH_WALLET_TRANSACTION')
          AND status <> 'cancelled'
        GROUP BY run_id
        HAVING COUNT(DISTINCT kind) > 1
    ) THEN
        RAISE EXCEPTION
            'submission authority migration refused: a run already has both wallet and relayer commands';
    END IF;
END
$submission_integrity$;

CREATE UNIQUE INDEX IF NOT EXISTS run_commands_one_active_submission_per_run_idx
    ON proofline_private.run_commands (run_id)
    WHERE kind IN ('SUBMIT_RELAYER', 'ATTACH_WALLET_TRANSACTION')
      AND status <> 'cancelled';

INSERT INTO proofline_private.schema_migrations (version)
VALUES (2)
ON CONFLICT (version) DO NOTHING;

COMMIT;
