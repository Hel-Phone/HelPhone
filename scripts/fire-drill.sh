#!/usr/bin/env bash
# ==============================================================================
# fire-drill.sh
# Backup/restore fire-drill harness (ISP-129). Restores into an isolated clone
# and never touches production.
#
# Usage:
#   CLONE_DATABASE_URL=postgres://.../helphone_clone scripts/fire-drill.sh --plan
#   CLONE_DATABASE_URL=postgres://.../helphone_drill scripts/fire-drill.sh --run --i-understand-this-wipes
# ==============================================================================

set -euo pipefail

MODE="plan"
WIPE_ACK="no"

for arg in "$@"; do
  case "$arg" in
    --plan) MODE="plan" ;;
    --run) MODE="run" ;;
    --i-understand-this-wipes) WIPE_ACK="yes" ;;
    *)
      echo "[fire-drill] unknown argument: ${arg}" >&2
      exit 2
      ;;
  esac
done

CLONE_DATABASE_URL="${CLONE_DATABASE_URL:-}"

if [ -z "${CLONE_DATABASE_URL}" ]; then
  echo "[fire-drill] CLONE_DATABASE_URL is required. Refusing to guess a target." >&2
  exit 1
fi

# Database name is the last path segment, without any query string.
DB_NAME="${CLONE_DATABASE_URL%%\?*}"
DB_NAME="${DB_NAME##*/}"

# Guard 1: the target must be explicitly a clone or drill database.
case "${DB_NAME}" in
  *_clone | *_drill) ;;
  *)
    echo "[fire-drill] refusing target database '${DB_NAME}': name must end in _clone or _drill." >&2
    exit 1
    ;;
esac

# Guard 2: refuse anything that looks like production, even with a clone suffix.
if printf '%s' "${CLONE_DATABASE_URL}" | grep -qiE '(prod|production|live)'; then
  echo "[fire-drill] refusing target: URL contains a production-like marker." >&2
  exit 1
fi

# Guard 3: destructive mode needs an explicit acknowledgement flag.
if [ "${MODE}" = "run" ] && [ "${WIPE_ACK}" != "yes" ]; then
  echo "[fire-drill] --run wipes the clone. Re-run with --i-understand-this-wipes." >&2
  exit 1
fi

echo "[fire-drill] target database: ${DB_NAME} (mode: ${MODE})"
echo "[fire-drill] ordered plan:"
echo "  1. restore PostgreSQL to target time on clone"
echo "  2. reset indexer cursor to restored high-water mark"
echo "  3. restore Redis RDB with backlog quarantine (no refire)"
echo "  4. import field kits (IDB export)"
echo "  5. reconcile contract truth vs PG projections"
echo "  6. emit cutover signal"

if [ "${MODE}" = "plan" ]; then
  echo "[fire-drill] plan only; no changes made."
  exit 0
fi

REPORT="${FIRE_DRILL_REPORT:-fire-drill-report.json}"
PG_DUMP_FILE="${PG_DUMP_FILE:-}"
BACKUP_BUNDLE="${BACKUP_BUNDLE:-}"
RESTORE_LEDGER="${RESTORE_LEDGER:-0}"

if [ -n "${BACKUP_BUNDLE}" ]; then npm run bundle:verify -- "${BACKUP_BUNDLE}"; fi
if [ -z "${PG_DUMP_FILE}" ] || [ ! -f "${PG_DUMP_FILE}" ]; then
  echo "[fire-drill] PG_DUMP_FILE must name an existing backup." >&2; exit 1
fi

STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
START_SECONDS="$(date +%s)"
step() {
  local number="$1" name="$2"; shift 2
  local before after
  before="$(date +%s)"
  echo "[fire-drill] step ${number}: ${name}"
  "$@"
  after="$(date +%s)"
  printf '%s|%s|%s\n' "${number}" "${name}" "$((after-before))" >> "${REPORT}.steps"
}

step 1 "restore PostgreSQL" pg_restore --clean --if-exists --no-owner --dbname "${CLONE_DATABASE_URL}" "${PG_DUMP_FILE}"
step 2 "reset indexer cursor" psql "${CLONE_DATABASE_URL}" -v ON_ERROR_STOP=1 -v ledger="${RESTORE_LEDGER}" -c 'UPDATE indexer_cursor SET ledger = :ledger;'
step 3 "restore Redis backlog quarantine" bash -ceu '${REDIS_RESTORE_COMMAND:-:}'
step 4 "import field kits" bash -ceu '${FIELD_KIT_IMPORT_COMMAND:-:}'
step 5 "reconcile projections" bash -ceu '${RECONCILE_COMMAND:-:}'
step 6 "emit cutover signal" bash -ceu '${CUTOVER_COMMAND:-:}'

ENDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DURATION="$(( $(date +%s) - START_SECONDS ))"
DUMP_SHA="$(sha256sum "${PG_DUMP_FILE}" | cut -d' ' -f1)"
node -e 'const fs=require("fs"); const [out,steps,started,ended,duration,dump,sha,target]=process.argv.slice(1); const parsed=fs.readFileSync(steps,"utf8").trim().split("\n").map(x=>{const [number,name,seconds]=x.split("|");return {number:Number(number),name,seconds:Number(seconds)}}); fs.writeFileSync(out,JSON.stringify({startedAt:started,endedAt:ended,durationSeconds:Number(duration),target,dump:{path:dump,sha256:sha},steps:parsed},null,2)+"\n")' "${REPORT}" "${REPORT}.steps" "${STARTED_AT}" "${ENDED_AT}" "${DURATION}" "${PG_DUMP_FILE}" "${DUMP_SHA}" "${DB_NAME}"
rm -f "${REPORT}.steps"
echo "[fire-drill] completed; report: ${REPORT}"
