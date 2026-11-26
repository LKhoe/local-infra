#!/bin/sh
# Snapshots Garage's (S3) metadata into $BACKUP_ROOT/garage/daily/<timestamp>/
#   db.sqlite                  the metadata DB (buckets, keys, object index), integrity-checked
#   node_key, node_key.pub,    the node identity and layout: with db.sqlite they rebuild a lost
#   cluster_layout, ...        or corrupt metadata folder (the objects stay in blocks/)
# The snapshot is taken here, not by Garage: Garage names its snapshots with ":" in the time,
# which the exFAT drive refuses. "VACUUM INTO" is what Garage's own snapshot runs: a consistent
# copy of the live DB while Garage keeps running. Everything is written to the drive only.
# Same layout and retention as backup.sh: on the 1st of the month the set is also copied to
# monthly/, and old sets are pruned after BACKUP_KEEP_DAYS / BACKUP_KEEP_MONTHS.
set -eu

ROOT="${BACKUP_ROOT:-/backups}"
MARKER="$ROOT/.localinfra-backup-target"
META="${S3_DATA_DIR:?S3_DATA_DIR must be set}/meta"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
KEEP_MONTHS="${BACKUP_KEEP_MONTHS:-6}"

log() { echo "[backup-garage $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

STATUS_JOB=garage
. /usr/local/lib/backup-status.sh
TMP=""
trap 'rc=$?; [ -z "$TMP" ] || rm -rf "$TMP"; write_status "$rc"; exit "$rc"' EXIT

# If the external drive is not mounted, Docker silently creates an empty folder on
# the SD card / system disk instead. The marker file only exists on the real drive.
if [ ! -f "$MARKER" ]; then
  STATUS_ERROR="external drive not mounted (no .localinfra-backup-target in the backup folder)"
  log "ERROR: $MARKER not found - is the external drive mounted? Not writing anything."
  exit 1
fi
if [ ! -f "$META/db.sqlite" ] || [ ! -f "$META/node_key" ]; then
  STATUS_ERROR="no Garage metadata (db.sqlite, node_key) in S3_DATA_DIR/meta"
  log "ERROR: $META/db.sqlite or $META/node_key not found - is S3_DATA_DIR right?"
  exit 1
fi

umask 077
STAMP=$(date +%Y-%m-%d_%H%M)
DAILY="$ROOT/garage/daily"
MONTHLY="$ROOT/garage/monthly"
TMP="$ROOT/garage/.tmp-$STAMP"
DEST="$DAILY/$STAMP"

mkdir -p "$DAILY" "$MONTHLY"
rm -rf "$TMP"
mkdir -p "$TMP"

STATUS_STEP="snapshotting the metadata DB"
log "snapshotting $META/db.sqlite"
# .timeout: wait (up to 30 s) instead of failing if Garage holds a write lock at that moment.
sqlite3 -bail -cmd ".timeout 30000" "$META/db.sqlite" "VACUUM INTO '$TMP/db.sqlite';"

STATUS_STEP="checking the snapshot"
check=$(sqlite3 -readonly "$TMP/db.sqlite" 'PRAGMA integrity_check;' 2>&1 || true)
if [ "$check" != "ok" ]; then
  STATUS_ERROR="the Garage metadata snapshot failed sqlite's integrity check"
  log "ERROR: integrity check: $check"
  exit 1
fi

STATUS_STEP="copying the node identity and layout"
for f in node_key node_key.pub cluster_layout data_layout; do
  [ ! -f "$META/$f" ] || cp "$META/$f" "$TMP/$f"   # plain copy: exFAT/NTFS drives reject ownership changes
done

STATUS_STEP="moving the set into place"
rm -rf "$DEST"
mv "$TMP" "$DEST"
TMP=""

if [ "$(date +%d)" = "01" ]; then
  rm -rf "$MONTHLY/$STAMP"
  cp -R "$DEST" "$MONTHLY/$STAMP"
  log "monthly copy kept: $MONTHLY/$STAMP"
fi

STATUS_STEP="pruning old sets"
find "$DAILY" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$MONTHLY" -mindepth 1 -maxdepth 1 -type d -mtime +"$((KEEP_MONTHS * 31))" -exec rm -rf {} +

date '+%Y-%m-%dT%H:%M:%S%z' > "$ROOT/garage/last_success"
STATUS_SET="daily/$STAMP"
log "done: $DEST ($(du -sh "$DEST" | cut -f1))"
