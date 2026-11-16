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
    SOCKET_GID="$(stat -c %g "$SOCKET")"
    if [ "$SOCKET_GID" = "0" ]; then
      # Group 0 is root's group: joining it would give SafeHub access to
      # every root-group file in the container. Leave Docker off instead.
      echo "Warning: $SOCKET belongs to group 0 (root), so SafeHub does not join it and cannot use it: Docker stays hidden (Check setup shows this too)." >&2
      echo "  Give the socket a non-root group on the host, e.g. 'sudo chgrp docker /var/run/docker.sock' (on Synology, create the group first: 'sudo synogroup --add docker'), then restart SafeHub." >&2
    else
      GROUPS_ARG="--groups=$SOCKET_GID"
    fi
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" "$GROUPS_ARG" -- "$@"
fi

# Already started as a non-root user (e.g. compose "user:"): run as is.
exec "$@"
