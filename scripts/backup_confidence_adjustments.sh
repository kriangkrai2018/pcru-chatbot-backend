#!/usr/bin/env bash
# Backup ConfidenceAdjustments table to SQL file
# Usage: DB_HOST=project.3bbddns.com DB_USER=root DB_PASSWORD=pass DB_NAME=pcru_chatbot ./backup_confidence_adjustments.sh
set -euo pipefail
OUTDIR="./db_backups"
mkdir -p "$OUTDIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTFILE="$OUTDIR/confidence_adjustments_$TIMESTAMP.sql"

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PASSWORD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "Please set DB_HOST, DB_USER, DB_PASSWORD and DB_NAME environment variables before running. Example:"
  echo "DB_HOST=project.3bbddns.com DB_USER=root DB_PASSWORD=secret DB_NAME=pcru_chatbot ./backup_confidence_adjustments.sh"
  exit 2
fi

echo "Backing up ConfidenceAdjustments to $OUTFILE ..."
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" ConfidenceAdjustments > "$OUTFILE"

echo "Backup complete: $OUTFILE"
