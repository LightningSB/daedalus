#!/bin/sh
set -e

# Runtime Docker integration bootstrap:
# 1) Align bun user's groups with the docker socket GID
# 2) Export DOCKER_HOST for docker CLI/compose
# 3) Auto-fill SELF_CONTAINER_ID when possible (best effort)
SOCKET_PATH="${DOCKER_SOCKET_PATH:-/var/run/docker.sock}"

if [ -S "$SOCKET_PATH" ]; then
  export DOCKER_HOST="unix://$SOCKET_PATH"

  DOCKER_GID=$(stat -c '%g' "$SOCKET_PATH" 2>/dev/null || echo "")
  if [ -n "$DOCKER_GID" ] && [ "$DOCKER_GID" != "0" ]; then
    addgroup -g "$DOCKER_GID" dockersock 2>/dev/null || true
    addgroup bun dockersock 2>/dev/null || true
  fi

  if [ -z "$SELF_CONTAINER_ID" ]; then
    SELF_FROM_MOUNT=$(grep -oE '/var/lib/docker/containers/[a-f0-9]{64}/' /proc/self/mountinfo 2>/dev/null | head -n1 | cut -d/ -f6)

    if [ -n "$SELF_FROM_MOUNT" ]; then
      export SELF_CONTAINER_ID="$SELF_FROM_MOUNT"
    elif [ -n "$HOSTNAME" ] && echo "$HOSTNAME" | grep -Eq '^[a-f0-9]{12,64}$'; then
      # Fallback to Docker-style hostname (short/full container id)
      export SELF_CONTAINER_ID="$HOSTNAME"
    fi
  fi
fi

exec su-exec bun "$@"
