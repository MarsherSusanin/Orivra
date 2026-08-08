BEGIN;

ALTER TABLE proofline_private.api_tokens
    ADD COLUMN IF NOT EXISTS issuance_key_digest bytea
        CHECK (
            issuance_key_digest IS NULL
            OR octet_length(issuance_key_digest) = 32
        ),
    ADD COLUMN IF NOT EXISTS issuance_fingerprint bytea
        CHECK (
            issuance_fingerprint IS NULL
            OR octet_length(issuance_fingerprint) = 32
        );

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_tokens_account_issuance_evidence_check'
          AND conrelid = 'proofline_private.api_tokens'::regclass
    ) THEN
        ALTER TABLE proofline_private.api_tokens
            ADD CONSTRAINT api_tokens_account_issuance_evidence_check
            CHECK (
                (
                    kind IN ('cli', 'action')
                    AND label IS NOT NULL
                    AND char_length(label) BETWEEN 1 AND 128
                    AND label = btrim(label)
                    AND wallet_identity_id IS NOT NULL
                    AND issuance_key_digest IS NOT NULL
                    AND issuance_fingerprint IS NOT NULL
                    AND created_at = date_trunc('milliseconds', created_at)
                    AND expires_at = date_trunc('milliseconds', expires_at)
                    AND expires_at > created_at
                    AND expires_at <= created_at + interval '90 days'
                    AND mod(
                        extract(epoch FROM (expires_at - created_at))::numeric,
                        86400
                    ) = 0
                )
                OR
                (
                    kind NOT IN ('cli', 'action')
                    AND issuance_key_digest IS NULL
                    AND issuance_fingerprint IS NULL
                )
            );
    END IF;
END
$constraints$;

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_account_issuance_key_unique
    ON proofline_private.api_tokens (project_id, issuance_key_digest)
    WHERE kind IN ('cli', 'action');

CREATE INDEX IF NOT EXISTS api_tokens_account_wallet_created_idx
    ON proofline_private.api_tokens
        (wallet_identity_id, created_at DESC, id DESC)
    WHERE kind IN ('cli', 'action');

REVOKE ALL ON TABLE proofline_private.api_tokens FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.api_tokens FROM proofline_api;
GRANT SELECT, INSERT ON TABLE proofline_private.api_tokens TO proofline_api;
GRANT UPDATE (revoked_at) ON TABLE proofline_private.api_tokens TO proofline_api;

INSERT INTO proofline_private.schema_migrations (version)
VALUES (7)
ON CONFLICT (version) DO NOTHING;

COMMIT;
