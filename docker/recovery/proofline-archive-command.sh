#!/bin/sh
set -eu
. /usr/local/bin/proofline-backup-common.sh
[ "$#" -eq 2 ] || proofline_fail
wal_path=$1
wal_name=$2
[ -f "$wal_path" ] && [ ! -L "$wal_path" ] || proofline_fail
printf '%s\n' "$wal_name" \
  | grep -Eq '^([0-9A-F]{24}|[0-9A-F]{24}\.[0-9A-F]{8}\.backup)$' \
  || proofline_fail
[ "$(basename "$wal_path")" = "$wal_name" ] || proofline_fail
proofline_configure_storage
[ -n "$WALG_PREVENT_WAL_OVERWRITE" ] || proofline_fail
[ -n "$WALG_LIBSODIUM_KEY" ] || proofline_fail
case "$WALG_S3_PREFIX" in s3://*/proofline/v1/*) ;; *) proofline_fail ;; esac
# pg_controldata supplies the exact system_identifier used in the prefix.
proofline_use_writer
exec wal-g wal-push "$wal_path"
