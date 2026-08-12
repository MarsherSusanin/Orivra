#!/bin/sh
set -eu

proofline_fail() {
  printf '%s\n' "${1:-BACKUP_CONFIGURATION_INVALID}" >&2
  exit 64
}

proofline_read_secret() {
  secret_path=$1
  [ -n "$secret_path" ] || proofline_fail
  [ -f "$secret_path" ] && [ ! -L "$secret_path" ] || proofline_fail
  secret_size=$(wc -c < "$secret_path")
  [ "$secret_size" -gt 0 ] && [ "$secret_size" -le 4096 ] || proofline_fail
  IFS= read -r secret_value < "$secret_path" || [ -n "${secret_value:-}" ]
  [ -n "${secret_value:-}" ] || proofline_fail
  printf '%s' "$secret_value"
}

proofline_system_identifier() {
  if [ "${PROOFLINE_BACKUP_QA:-}" = "true" ] && [ -n "${PROOFLINE_BACKUP_SYSTEM_IDENTIFIER:-}" ]; then
    printf '%s\n' "$PROOFLINE_BACKUP_SYSTEM_IDENTIFIER" | grep -E '^[1-9][0-9]*$'
    return
  fi
  pg_controldata "${PGDATA:?}" |
    sed -n 's/^Database system identifier:[[:space:]]*//p' |
    grep -E '^[1-9][0-9]*$'
}

proofline_configure_storage() {
  case "${PROOFLINE_BACKUP_SLOT:-}" in
    production) ;;
    qa) [ "${PROOFLINE_BACKUP_QA:-}" = "true" ] || proofline_fail ;;
    *) proofline_fail ;;
  esac
  case "${PROOFLINE_BACKUP_BUCKET:-}" in
    ''|*[!a-z0-9.-]*|.*|*.) proofline_fail ;;
  esac
  system_identifier=$(proofline_system_identifier) || proofline_fail
  WALG_S3_PREFIX="s3://${PROOFLINE_BACKUP_BUCKET}/proofline/v1/${PROOFLINE_BACKUP_SLOT}/${system_identifier}"
  AWS_ENDPOINT="${PROOFLINE_BACKUP_ENDPOINT:?}"
  AWS_REGION="${PROOFLINE_BACKUP_REGION:?}"
  WALG_PREVENT_WAL_OVERWRITE=true
  WALG_LIBSODIUM_KEY=$(proofline_read_secret "${PROOFLINE_BACKUP_ENCRYPTION_KEY_FILE:?}")
  export WALG_S3_PREFIX AWS_ENDPOINT AWS_REGION WALG_PREVENT_WAL_OVERWRITE WALG_LIBSODIUM_KEY
  if [ "${PROOFLINE_BACKUP_QA:-}" = "true" ]; then
    [ "$AWS_ENDPOINT" = "http://minio:9000" ] || proofline_fail
    AWS_S3_FORCE_PATH_STYLE=true
    export AWS_S3_FORCE_PATH_STYLE
  else
    [ "$AWS_ENDPOINT" = "https://s3.twcstorage.ru" ] || proofline_fail
    [ "$AWS_REGION" = "ru-1" ] || proofline_fail
    [ "$PROOFLINE_BACKUP_BUCKET" = "orivra-backet" ] || proofline_fail
    AWS_S3_FORCE_PATH_STYLE=true
    export AWS_S3_FORCE_PATH_STYLE
  fi
}

proofline_use_writer() {
  AWS_ACCESS_KEY_ID=$(proofline_read_secret "${PROOFLINE_BACKUP_WRITER_ACCESS_KEY_ID_FILE:?}")
  AWS_SECRET_ACCESS_KEY=$(proofline_read_secret "${PROOFLINE_BACKUP_WRITER_SECRET_ACCESS_KEY_FILE:?}")
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
}

proofline_use_reader() {
  AWS_ACCESS_KEY_ID=$(proofline_read_secret "${PROOFLINE_BACKUP_READER_ACCESS_KEY_ID_FILE:?}")
  AWS_SECRET_ACCESS_KEY=$(proofline_read_secret "${PROOFLINE_BACKUP_READER_SECRET_ACCESS_KEY_FILE:?}")
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
}

proofline_use_retention() {
  AWS_ACCESS_KEY_ID=$(proofline_read_secret "${PROOFLINE_BACKUP_RETENTION_ACCESS_KEY_ID_FILE:?}")
  AWS_SECRET_ACCESS_KEY=$(proofline_read_secret "${PROOFLINE_BACKUP_RETENTION_SECRET_ACCESS_KEY_FILE:?}")
  export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
}
