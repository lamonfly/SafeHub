#!/bin/sh
# Starts SafeHub as an unprivileged user (PUID/PGID, default 1000:1000).
# Runs as root only long enough to make /app/data writable, so a ./data
# folder that Docker just created as root works without a manual chown.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown -R "$PUID:$PGID" /app/data
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups -- "$@"
fi

# Already started as a non-root user (e.g. compose "user:"): run as is.
exec "$@"
