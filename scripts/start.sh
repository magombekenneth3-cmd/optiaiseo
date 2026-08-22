#!/bin/sh
npx prisma migrate deploy || echo "[start.sh] WARNING: prisma migrate deploy failed, proceeding with server startup..."
exec node server.js
