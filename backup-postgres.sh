#!/usr/bin/env bash
# backup-postgres.sh — Create a timestamped pg_dump of the CK UNI database.
#
# Usage:
#   ./backup-postgres.sh [backup-dir]
#
# The backup directory defaults to ./backups (relative to the script).
# The script reads the same .env file used by Docker Compose, so no
# credentials need to be specified on the command line.
#
# The dump is written to:
#   <backup-dir>/ckuni_YYYYMMDD_HHMMSS.dump
#
# Restore with:
#   pg_restore --clean --if-exists -d <DATABASE_URL> <file.dump>
# or via Docker Compose:
#   docker compose exec -T postgres pg_restore --clean --if-exists \
#     -U $POSTGRES_USER -d $POSTGRES_DB < <file.dump>

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${1:-${SCRIPT_DIR}/backups}"
ENV_FILE="${SCRIPT_DIR}/.env"

# Load .env if present (ignore missing vars)
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
fi

: "${POSTGRES_USER:=ckuni}"
: "${POSTGRES_DB:=ckuni}"

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/ckuni_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "Backing up database '${POSTGRES_DB}' to ${DUMP_FILE} …"

# Run pg_dump inside the running postgres container without stopping it.
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc \
  > "${DUMP_FILE}"

echo "Backup complete: ${DUMP_FILE}"
echo "Size: $(du -h "${DUMP_FILE}" | cut -f1)"
