#!/bin/sh
set -eu
. /usr/local/bin/proofline-backup-common.sh
proofline_configure_storage
proofline_use_reader
case "${PROOFLINE_RESTORE_BACKUP_ID:-}" in base_[0-9A-F][0-9A-F][0-9A-F][0-9A-F]*) ;;
  *) proofline_fail ;;
esac
[ -d "${PGDATA:?}" ] || proofline_fail
[ -z "$(find "$PGDATA" -mindepth 1 -maxdepth 1 -print -quit)" ] || {
  printf '%s\n' "RESTORE_VOLUME_NONEMPTY" >&2
  exit 65
}
wal-g backup-fetch "$PGDATA" "$PROOFLINE_RESTORE_BACKUP_ID"
[ "${recovery_target_inclusive:?}" = "on" ] || proofline_fail
[ "${recovery_target_action:?}" = "pause" ] || proofline_fail
[ "${recovery_target_timeline:?}" = "${PROOFLINE_RECOVERY_TARGET_TIMELINE:?}" ] || proofline_fail
recovery_target_time=$(printf '%s\n' "${PROOFLINE_RECOVERY_TARGET_TIME:?}" |
  sed -E 's/^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6})Z$/\1 \2+00/')
[ "$recovery_target_time" != "$PROOFLINE_RECOVERY_TARGET_TIME" ] || proofline_fail
cat >> "$PGDATA/postgresql.auto.conf" <<EOF
restore_command = '/usr/local/bin/proofline-restore-command.sh %f %p'
recovery_target_time = '${recovery_target_time}'
recovery_target_inclusive = '${recovery_target_inclusive}'
recovery_target_timeline = '${recovery_target_timeline}'
recovery_target_action = '${recovery_target_action}'
EOF
touch "$PGDATA/recovery.signal"
