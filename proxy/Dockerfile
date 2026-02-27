FROM oven/bun:1.3.10-alpine

WORKDIR /app

# docker-cli + docker-cli-compose: needed for `docker exec`, `docker compose run`, etc.
# tmux: required for the local-tmux bind feature (exec into this container and attach a session).
# su-exec: lightweight Alpine privilege-drop so entrypoint runs as root then execs as bun.
RUN apk add --no-cache docker-cli docker-cli-compose tmux su-exec

COPY package.json tsconfig.json ./
RUN bun install --frozen-lockfile || bun install

COPY src ./src

# Entrypoint runs as root to fix Docker socket group membership at runtime,
# then drops to the bun user via su-exec.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Override oven/bun's default USER bun so the entrypoint can call addgroup.
USER root

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
