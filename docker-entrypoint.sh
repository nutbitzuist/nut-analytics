#!/bin/sh
# Runs as root: make the mounted volume writable for the app user, then drop
# privileges. Build-time chown can't cover the volume because the mount only
# exists at runtime (it arrives owned by root, which made SQLite read-only).
set -e
mkdir -p /app/data
chown -R nextjs:nodejs /app/data
export HOSTNAME=0.0.0.0
exec su-exec nextjs:nodejs node server.js
