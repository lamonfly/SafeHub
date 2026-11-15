#!/bin/sh
# Starts SafeHub as an unprivileged user (PUID/PGID, default 1000:1000).
# Runs as root only long enough to make /app/data writable, so a ./data
# folder that Docker just created as root works without a manual chown.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  # NFS/CIFS shares with root squash (e.g. on a NAS) refuse chown: warn and
  # go on; SafeHub reports clearly if it then cannot write its database.
  chown -R "$PUID:$PGID" /app/data || echo "Warning: could not chown /app/data to $PUID:$PGID; make it writable for that user." >&2
  # Mounted Docker socket: keep access to it through its group, whose ID
  # differs between machines.
  GROUPS_ARG="--clear-groups"
  SOCKET="${DOCKER_SOCKET:-/var/run/docker.sock}"
  if [ -S "$SOCKET" ]; then
    GROUPS_ARG="--groups=$(stat -c %g "$SOCKET")"
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" "$GROUPS_ARG" -- "$@"
fi

# Already started as a non-root user (e.g. compose "user:"): run as is.
exec "$@"
