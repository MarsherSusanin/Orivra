#!/bin/sh
set -eu
. /usr/local/bin/proofline-backup-common.sh
proofline_configure_storage
proofline_use_retention
[ -f "${PROOFLINE_BACKUP_EVIDENCE_FILE:?}" ] || proofline_fail
[ -n "${PROOFLINE_BACKUP_EVIDENCE_SHA256:?}" ] || proofline_fail
node /usr/local/lib/proofline/backup-retention-authorization.mjs
exec wal-g delete retain FULL 8 --confirm
