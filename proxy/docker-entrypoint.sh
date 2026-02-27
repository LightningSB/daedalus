#!/bin/sh
set -e

# Dynamically join the host Docker group so the bun user can access the socket
# without hardcoding a GID that varies across machines.
SOCKET_PATH="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

if [ -S "$SOCKET_PATH" ]; then
  DOCKER_GID=$(stat -c '%g' "$SOCKET_PATH" 2>/dev/null || echo "")
  if [ -n "$DOCKER_GID" ] && [ "$DOCKER_GID" != "0" ]; then
    # Create a group matching the socket GID (ignore error if it already exists)
    # then add the bun user to it.
    addgroup -g "$DOCKER_GID" dockersock 2>/dev/null || true
    addgroup bun dockersock 2>/dev/null || true
  fi
fi

# Drop from root to the bun user for the actual process.
exec su-exec bun "$@"
