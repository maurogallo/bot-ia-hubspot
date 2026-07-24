#!/bin/sh
set -e

rm -rf /tmp/org.chromium.Chromium.* 2>/dev/null
find /app/whatsapp-session -name 'Singleton*' -delete 2>/dev/null
find /app/whatsapp-session -name 'LOCK' -delete 2>/dev/null

exec node src/server.js
