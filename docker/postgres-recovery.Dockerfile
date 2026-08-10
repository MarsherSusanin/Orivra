# syntax=docker/dockerfile:1
FROM wal_g_release AS wal_g_release
FROM --platform=linux/amd64 node@sha256:745403dc46b5ab4c998502b07a12cbf020cf2c30645427a68ec0718f02d647de AS node_runtime

FROM --platform=linux/amd64 postgres@sha256:45cd22f8d32e189d245403954882f88e7a8714301fda80dab6da90f1265b25a3
ARG PROOFLINE_WAL_G_BINARY_SHA256
COPY --from=wal_g_release --chmod=0555 /wal-g /usr/local/bin/wal-g
COPY --from=node_runtime /usr/local/bin/node /usr/local/bin/node
RUN printf '%s  %s\n' "${PROOFLINE_WAL_G_BINARY_SHA256#sha256:}" /usr/local/bin/wal-g \
      | sha256sum --check --strict -
COPY --chmod=0555 docker/recovery/proofline-backup-common.sh /usr/local/bin/proofline-backup-common.sh
COPY --chmod=0555 docker/recovery/proofline-archive-command.sh /usr/local/bin/proofline-archive-command.sh
COPY --chmod=0555 docker/recovery/proofline-base-backup.sh /usr/local/bin/proofline-base-backup.sh
COPY --chmod=0555 docker/recovery/proofline-backup-status.sh /usr/local/bin/proofline-backup-status.sh
COPY --chmod=0555 docker/recovery/proofline-backup-retention.sh /usr/local/bin/proofline-backup-retention.sh
COPY --chmod=0555 docker/recovery/proofline-pitr-fetch.sh /usr/local/bin/proofline-pitr-fetch.sh
COPY --chmod=0555 docker/recovery/proofline-restore-command.sh /usr/local/bin/proofline-restore-command.sh
COPY --chmod=0444 scripts/backup-evidence-validation.mjs /usr/local/lib/proofline/backup-evidence-validation.mjs
COPY --chmod=0444 scripts/backup-retention-authorization.mjs /usr/local/lib/proofline/backup-retention-authorization.mjs
USER postgres
