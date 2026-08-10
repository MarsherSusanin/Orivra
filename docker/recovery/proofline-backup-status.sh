#!/bin/sh
set -eu
. /usr/local/bin/proofline-backup-common.sh
proofline_configure_storage
proofline_use_reader
exec wal-g backup-list --json
