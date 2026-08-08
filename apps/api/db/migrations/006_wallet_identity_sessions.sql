BEGIN;

CREATE TABLE IF NOT EXISTS proofline_private.wallet_identities (
    id uuid PRIMARY KEY,
    chain_id smallint NOT NULL DEFAULT 114 CHECK (chain_id = 114),
    address bytea NOT NULL CHECK (octet_length(address) = 20),
    default_project_id uuid NOT NULL REFERENCES proofline_private.projects(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chain_id, address),
    UNIQUE (default_project_id)
);

CREATE TABLE IF NOT EXISTS proofline_private.wallet_challenges (
    id text PRIMARY KEY CHECK (id ~ '^challenge_[a-f0-9]{64}$'),
    address bytea NOT NULL CHECK (octet_length(address) = 20),
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 32),
    message text NOT NULL CHECK (octet_length(message) <= 8192),
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT wallet_challenges_issued_at_millisecond_check
        CHECK (issued_at = date_trunc('milliseconds', issued_at)),
    CONSTRAINT wallet_challenges_expires_at_millisecond_check
        CHECK (expires_at = date_trunc('milliseconds', expires_at)),
    CHECK (expires_at = issued_at + interval '5 minutes'),
    CHECK (consumed_at IS NULL OR consumed_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS wallet_challenges_expires_at_idx
    ON proofline_private.wallet_challenges (expires_at);

ALTER TABLE proofline_private.api_tokens
    ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'legacy'
        CHECK (kind IN ('legacy', 'browser', 'cli', 'action')),
    ADD COLUMN IF NOT EXISTS label text,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS wallet_identity_id uuid
        REFERENCES proofline_private.wallet_identities(id);

DO $constraints$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_tokens_browser_identity_expiry_check'
          AND conrelid = 'proofline_private.api_tokens'::regclass
    ) THEN
        ALTER TABLE proofline_private.api_tokens
            ADD CONSTRAINT api_tokens_browser_identity_expiry_check
            CHECK (
                (kind <> 'browser'
                    OR (expires_at IS NOT NULL AND wallet_identity_id IS NOT NULL))
                AND
                (kind NOT IN ('cli', 'action')
                    OR (expires_at IS NOT NULL AND wallet_identity_id IS NOT NULL))
            );
    END IF;
END
$constraints$;

REVOKE ALL ON TABLE proofline_private.wallet_identities FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.wallet_challenges FROM PUBLIC;

GRANT SELECT, INSERT ON TABLE proofline_private.wallet_identities
    TO proofline_api;
GRANT SELECT, INSERT ON TABLE proofline_private.wallet_challenges
    TO proofline_api;
GRANT UPDATE (consumed_at) ON TABLE proofline_private.wallet_challenges
    TO proofline_api;

INSERT INTO proofline_private.schema_migrations (version)
VALUES (6)
ON CONFLICT (version) DO NOTHING;

COMMIT;
