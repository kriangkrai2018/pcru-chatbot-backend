#!/usr/bin/env bash
# Backup specified tables to SQL files in ./db_backups
# Usage: DB_HOST=project.3bbddns.com DB_USER=root DB_PASSWORD=pass DB_NAME=pcru_chatbot ./backup_tables.sh ConfidenceHistory VerificationLog
set -euo pipefail
OUTDIR="./db_backups"
mkdir -p "$OUTDIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ $# -lt 1 ]; then
  echo "Usage: $0 <Table1> [Table2 ...]"
  exit 2
fi

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "Please set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME environment variables. Example:"
  echo "DB_HOST=project.3bbddns.com DB_USER=root DB_PASSWORD=secret DB_NAME=pcru_chatbot ./backup_tables.sh ConfidenceHistory VerificationLog"
  exit 2
fi

for table in "$@"; do
  OUTFILE="$OUTDIR/${table}_$TIMESTAMP.sql"
  echo "Backing up $table to $OUTFILE ..."
  mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" "$table" > "$OUTFILE" || {
    echo "Warning: failed to dump $table (it may not exist). Skipping.";
    rm -f "$OUTFILE"
  }
done

echo "Done. Backups (if any) are in $OUTDIR" 
