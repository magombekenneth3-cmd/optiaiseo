#!/bin/sh
set -e

echo "[start.sh] Running prisma migrate deploy..."
if ! npx prisma migrate deploy; then
  echo "[start.sh] FATAL: prisma migrate deploy failed. Aborting startup to prevent running against a broken schema."
  exit 1
fi

echo "[start.sh] Migrations applied successfully. Starting server..."
exec node server.js
