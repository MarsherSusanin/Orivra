#!/bin/sh
set -eu
. /usr/local/bin/proofline-backup-common.sh
[ "$#" -eq 2 ] || proofline_fail
wal_name=$1
wal_path=$2
printf '%s\n' "$wal_name" \
  | grep -Eq '^([0-9A-F]{24}|[0-9A-F]{8}\.history)$' \
  || proofline_fail
[ -n "$wal_path" ] && [ ! -L "$wal_path" ] || proofline_fail
proofline_configure_storage
proofline_use_reader
exec wal-g wal-fetch "$wal_name" "$wal_path"
