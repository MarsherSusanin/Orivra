BEGIN;

DO $submission_integrity$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM proofline_private.run_commands
        WHERE kind IN (
            'ATTACH_WALLET_TRANSACTION',
            'SUBMIT_RELAYER',
            'APPLY_REPLAY_EVIDENCE'
        )
          AND status <> 'cancelled'
        GROUP BY run_id
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'submission authority migration refused: a run already has conflicting submission commands';
    END IF;
END
$submission_integrity$;

DROP INDEX IF EXISTS proofline_private.run_commands_one_active_submission_per_run_idx;

CREATE UNIQUE INDEX IF NOT EXISTS run_commands_one_active_submission_per_run_idx
    ON proofline_private.run_commands (run_id)
    WHERE kind IN (
        'ATTACH_WALLET_TRANSACTION',
        'SUBMIT_RELAYER',
        'APPLY_REPLAY_EVIDENCE'
    )
      AND status <> 'cancelled';

INSERT INTO proofline_private.schema_migrations (version)
VALUES (5)
ON CONFLICT (version) DO NOTHING;

COMMIT;
