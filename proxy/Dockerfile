FROM oven/bun:1.3.10-alpine

WORKDIR /app

RUN apk add --no-cache docker-cli docker-cli-compose

COPY package.json tsconfig.json ./
RUN bun install --frozen-lockfile || bun install

COPY src ./src

EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]
