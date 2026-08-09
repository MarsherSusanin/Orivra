BEGIN;

CREATE TABLE IF NOT EXISTS proofline_private.quota_windows (
    quota_kind text NOT NULL CHECK (
        quota_kind IN (
            'wallet_challenge_address_minute',
            'wallet_challenge_global_minute',
            'project_run_day',
            'active_live'
        )
    ),
    subject_digest bytea NOT NULL CHECK (octet_length(subject_digest) = 32),
    window_start timestamptz NOT NULL,
    window_end timestamptz NOT NULL,
    limit_value integer NOT NULL CHECK (limit_value > 0),
    used_count integer NOT NULL,
    PRIMARY KEY (quota_kind, subject_digest, window_start),
    CONSTRAINT quota_windows_usage_check CHECK (
        (quota_kind = 'active_live' AND used_count = 0)
        OR
        (quota_kind <> 'active_live' AND used_count BETWEEN 1 AND limit_value)
    ),
    CONSTRAINT quota_windows_duration_check CHECK (
        (
            quota_kind IN (
                'wallet_challenge_address_minute',
                'wallet_challenge_global_minute'
            )
            AND window_start = date_trunc('minute', window_start)
            AND window_end = window_start + interval '1 minute'
        )
        OR
        (
            quota_kind IN ('project_run_day', 'active_live')
            AND window_start = date_trunc('day', window_start, 'UTC')
            AND window_end = window_start + interval '1 day'
        )
    )
);

CREATE INDEX IF NOT EXISTS quota_windows_window_end_idx
    ON proofline_private.quota_windows (window_end);

REVOKE ALL ON TABLE proofline_private.quota_windows FROM PUBLIC;
REVOKE ALL ON TABLE proofline_private.quota_windows,
    proofline_private.wallet_challenges
    FROM proofline_worker;
GRANT SELECT, INSERT, DELETE ON TABLE proofline_private.quota_windows
    TO proofline_api;
GRANT UPDATE (used_count) ON TABLE proofline_private.quota_windows
    TO proofline_api;
GRANT DELETE ON TABLE proofline_private.wallet_challenges
    TO proofline_api;

INSERT INTO proofline_private.schema_migrations (version)
VALUES (8)
ON CONFLICT (version) DO NOTHING;

COMMIT;
