#!/usr/bin/env bash
# backup-postgres.sh - Create a timestamped pg_dump of the CK UNI database.
#
# Usage:
#   ./backup-postgres.sh [backup-dir]
#
# The backup directory defaults to ./backups (relative to the script).
# Database names are read inside the postgres container, so credentials are
# never sourced into this shell or included on the command line.
#
# The dump is written to:
#   <backup-dir>/ckuni_YYYYMMDD_HHMMSS_PID.dump
#
# Restore with:
#   pg_restore --clean --if-exists -d <DATABASE_URL> <file.dump>
# or via podman Compose:
#   podman compose exec -T postgres pg_restore --clean --if-exists \
#     -U $POSTGRES_USER -d $POSTGRES_DB < <file.dump>

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${CKUNI_REPO:-${SCRIPT_DIR}}"
BACKUP_DIR="${1:-${REPO}/backups}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/ckuni_${TIMESTAMP}_${BASHPID}.dump"
TEMP_DUMP=""

cleanup() {
  if [[ -n "${TEMP_DUMP}" ]]; then
    rm -f "${TEMP_DUMP}"
  fi
}

trap cleanup EXIT

mkdir -p "${BACKUP_DIR}"
TEMP_DUMP="$(mktemp "${BACKUP_DIR}/.ckuni_${TIMESTAMP}.XXXXXX.tmp")"
cd "${REPO}"

printf 'Backing up CK UNI PostgreSQL to %s\n' "${DUMP_FILE}"

# Write and validate a private temporary archive before publishing the backup.
podman compose exec -T postgres \
  sh -c 'exec pg_dump -U "${POSTGRES_USER:-ckuni}" -d "${POSTGRES_DB:-ckuni}" -Fc' \
  > "${TEMP_DUMP}"

if [[ ! -s "${TEMP_DUMP}" ]]; then
  printf 'Backup failed: pg_dump produced an empty archive\n' >&2
  exit 1
fi

podman compose exec -T postgres pg_restore --list < "${TEMP_DUMP}" > /dev/null
mv "${TEMP_DUMP}" "${DUMP_FILE}"
TEMP_DUMP=""

printf 'Backup complete: %s\n' "${DUMP_FILE}"
