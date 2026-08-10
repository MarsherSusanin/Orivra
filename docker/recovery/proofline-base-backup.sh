#!/bin/bash
set -euo pipefail
. /usr/local/bin/proofline-backup-common.sh
proofline_configure_storage
proofline_use_writer
database_url=$(proofline_read_secret "${PROOFLINE_BACKUP_DATABASE_URL_FILE:?}")
database_prefix='postgres://proofline_backup_login:'
database_suffix='@postgres:5432/proofline'
case "$database_url" in
  "$database_prefix"*"$database_suffix") ;;
  *) proofline_fail ;;
esac
database_password=${database_url#"$database_prefix"}
database_password=${database_password%"$database_suffix"}
case "$database_password" in
  ''|*[!A-Za-z0-9._~-]*) proofline_fail ;;
esac
PGHOST=postgres
PGPORT=5432
PGUSER=proofline_backup_login
PGDATABASE=proofline
PGPASSWORD=$database_password
export PGHOST PGPORT PGUSER PGDATABASE PGPASSWORD
request_pipe=$(mktemp -u /tmp/proofline-backup-lock.XXXXXX.in)
response_pipe=$(mktemp -u /tmp/proofline-backup-lock.XXXXXX.out)
mkfifo -m 600 "$request_pipe" "$response_pipe"
cleanup() {
  if [ -n "${psql_pid:-}" ]; then kill "$psql_pid" 2>/dev/null || true; fi
  rm -f "$request_pipe" "$response_pipe"
}
trap cleanup EXIT INT TERM
exec 8<>"$response_pipe"
psql -XAtq "$database_url" <"$request_pipe" >"$response_pipe" &
psql_pid=$!
exec 9>"$request_pipe"
printf '%s\n' "SELECT CASE WHEN pg_try_advisory_lock(-4708329426407388776) THEN 'LOCKED' ELSE 'BACKUP_ALREADY_RUNNING' END;" >&9
IFS= read -r lock_result <&8
if [ "$lock_result" != "LOCKED" ]; then
  printf '%s\n' "BACKUP_ALREADY_RUNNING" >&2
  exit 75
fi
wal-g backup-push "${PGDATA:?}"
printf '%s\n' "SELECT pg_advisory_unlock(-4708329426407388776);" >&9
