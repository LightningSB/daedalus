import { randomUUID } from "node:crypto";
import { loadConfig } from "./config";
import { MinioStore, type StoredHost } from "./storage/minioStore";
import { VaultService } from "./services/vaultService";
import { SshService } from "./services/sshService";
import { getVaultToken, json, readJson } from "./utils/http";

const config = loadConfig();
const store = new MinioStore(config.minio);
await store.init();

const vault = new VaultService(store, config.vaultIdleTimeoutMs);
const sshService = new SshService(store, vault, config.sshAllowedHosts);

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-vault-token",
  };
}

function withCors(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

function ok(request: Request, body: unknown, status = 200): Response {
  return withCors(json(body, status), request);
}

function bad(request: Request, error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : "Unknown error";
  return withCors(json({ error: message }, status), request);
}

async function handleHosts(request: Request, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const hosts = await store.getHosts(userId);
    return ok(request, { hosts });
  }

  if (request.method === "POST") {
    const body = await readJson<{
      id?: string;
      label: string;
      host: string;
      port?: number;
      username: string;
      secretId?: string;
      credentials?: {
        id?: string;
        password?: string;
        privateKey?: string;
        passphrase?: string;
      };
    }>(request);

    const hosts = await store.getHosts(userId);

    let secretId = body.secretId;
    if (body.credentials) {
      const token = getVaultToken(request);
      if (!token) {
        return bad(request, new Error("Vault token required for credentials"), 401);
      }

      secretId = body.credentials.id ?? `secret-${randomUUID()}`;
      await vault.withSecrets(token, userId, async (secrets) => {
        secrets[secretId!] = {
          password: body.credentials?.password,
          privateKey: body.credentials?.privateKey,
          passphrase: body.credentials?.passphrase,
        };
      });
    }

    const now = new Date().toISOString();
    const host: StoredHost = {
      id: body.id ?? `host-${randomUUID()}`,
      label: body.label,
      host: body.host,
      port: body.port ?? 22,
      username: body.username,
      secretId,
      createdAt: now,
      updatedAt: now,
    };

    hosts.push(host);
    await store.putHosts(userId, hosts);
    return ok(request, { host }, 201);
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleHostById(request: Request, userId: string, hostId: string): Promise<Response> {
  const hosts = await store.getHosts(userId);
  const index = hosts.findIndex((item) => item.id === hostId);

  if (index < 0) {
    return bad(request, new Error("Host not found"), 404);
  }

  if (request.method === "DELETE") {
    hosts.splice(index, 1);
    await store.putHosts(userId, hosts);
    return ok(request, { ok: true });
  }

  if (request.method === "PUT") {
    const body = await readJson<{
      label?: string;
      host?: string;
      port?: number;
      username?: string;
      secretId?: string;
      credentials?: {
        id?: string;
        password?: string;
        privateKey?: string;
        passphrase?: string;
      };
    }>(request);

    let secretId = body.secretId ?? hosts[index].secretId;

    if (body.credentials) {
      const token = getVaultToken(request);
      if (!token) {
        return bad(request, new Error("Vault token required for credentials"), 401);
      }

      secretId = body.credentials.id ?? secretId ?? `secret-${randomUUID()}`;
      await vault.withSecrets(token, userId, async (secrets) => {
        secrets[secretId!] = {
          password: body.credentials?.password,
          privateKey: body.credentials?.privateKey,
          passphrase: body.credentials?.passphrase,
        };
      });
    }

    hosts[index] = {
      ...hosts[index],
      label: body.label ?? hosts[index].label,
      host: body.host ?? hosts[index].host,
      port: body.port ?? hosts[index].port,
      username: body.username ?? hosts[index].username,
      secretId,
      updatedAt: new Date().toISOString(),
    };

    await store.putHosts(userId, hosts);
    return ok(request, { host: hosts[index] });
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleKnownHosts(request: Request, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const knownHosts = await store.getKnownHosts(userId);
    return ok(request, { knownHosts });
  }

  if (request.method === "POST") {
    const body = await readJson<{ host: string; fingerprint: string }>(request);
    const knownHosts = await store.getKnownHosts(userId);
    knownHosts[body.host] = body.fingerprint;
    await store.putKnownHosts(userId, knownHosts);
    return ok(request, { knownHosts });
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleKnownHostByName(request: Request, userId: string, host: string): Promise<Response> {
  if (request.method !== "DELETE") {
    return bad(request, new Error("Method not allowed"), 405);
  }

  const knownHosts = await store.getKnownHosts(userId);
  delete knownHosts[host];
  await store.putKnownHosts(userId, knownHosts);
  return ok(request, { knownHosts });
}

async function handleVault(request: Request, userId: string, action: string): Promise<Response> {
  if (request.method === "GET" && action === "status") {
    const status = await vault.status(userId);
    return ok(request, status);
  }

  if (request.method !== "POST") {
    return bad(request, new Error("Method not allowed"), 405);
  }

  if (action === "init") {
    const body = await readJson<{ passphrase: string; recoveryPhrase?: string }>(request);
    const out = await vault.init(userId, body.passphrase, body.recoveryPhrase);
    return ok(request, out, 201);
  }

  if (action === "unlock") {
    const body = await readJson<{ passphrase: string }>(request);
    const out = await vault.unlockWithPassphrase(userId, body.passphrase);
    return ok(request, out);
  }

  if (action === "lock") {
    const token = getVaultToken(request);
    if (!token) {
      return bad(request, new Error("Vault token is required"), 401);
    }

    await vault.lock(token);
    return ok(request, { ok: true });
  }

  if (action === "recover") {
    const body = await readJson<{
      recoveryPhrase: string;
      newPassphrase: string;
      nextRecoveryPhrase?: string;
    }>(request);

    const out = await vault.recover(userId, body.recoveryPhrase, body.newPassphrase, body.nextRecoveryPhrase);
    return ok(request, out);
  }

  return bad(request, new Error("Unknown vault action"), 404);
}

async function handleSshSessions(request: Request, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const sessions = await sshService.listSessions(userId);
    return ok(request, { sessions });
  }

  if (request.method === "POST") {
    const body = await readJson<{
      command?: string;
      hostId?: string;
      host?: string;
      port?: number;
      username?: string;
      secretId?: string;
      password?: string;
      privateKey?: string;
      passphrase?: string;
      cols?: number;
      rows?: number;
    }>(request);

    const summary = await sshService.createSession(userId, {
      ...body,
      vaultToken: getVaultToken(request) ?? undefined,
    });

    return ok(request, { session: summary }, 201);
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleSshSessionDetail(
  request: Request,
  userId: string,
  sessionId: string,
  action?: "resize" | "close",
): Promise<Response> {
  if (!action && request.method === "DELETE") {
    await sshService.closeSession(userId, sessionId);
    return ok(request, { ok: true });
  }

  if (action === "close" && request.method === "DELETE") {
    await sshService.closeSession(userId, sessionId);
    return ok(request, { ok: true });
  }

  if (action === "resize" && request.method === "POST") {
    const body = await readJson<{ cols: number; rows: number }>(request);
    sshService.resizeSession(userId, sessionId, body.cols, body.rows);
    return ok(request, { ok: true });
  }

  return bad(request, new Error("Method not allowed"), 405);
}

const server = Bun.serve<{ userId: string; sessionId: string }>({
  port: config.port,
  fetch: async (request, serverInstance) => {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), request);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (pathname === "/api/health" && request.method === "GET") {
        return ok(request, { status: "ok" });
      }

      let match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/hosts$/);
      if (match) {
        return await handleHosts(request, decodeURIComponent(match[1]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/hosts\/([^/]+)$/);
      if (match) {
        return await handleHostById(request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/known-hosts$/);
      if (match) {
        return await handleKnownHosts(request, decodeURIComponent(match[1]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/known-hosts\/([^/]+)$/);
      if (match) {
        return await handleKnownHostByName(request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/vault\/(status|init|unlock|lock|recover)$/);
      if (match) {
        return await handleVault(request, decodeURIComponent(match[1]), match[2]);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions$/);
      if (match) {
        return await handleSshSessions(request, decodeURIComponent(match[1]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/ws$/);
      if (match) {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const upgraded = serverInstance.upgrade(request, {
          data: { userId, sessionId },
        });

        if (upgraded) {
          return undefined;
        }

        return bad(request, new Error("WebSocket upgrade failed"), 400);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/(resize|close)$/);
      if (match) {
        return await handleSshSessionDetail(
          request,
          decodeURIComponent(match[1]),
          decodeURIComponent(match[2]),
          match[3] as "resize" | "close",
        );
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)$/);
      if (match) {
        return await handleSshSessionDetail(request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      return bad(request, new Error("Not found"), 404);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const status = message.includes("not found") || message.includes("Not found") ? 404 : 400;
      return bad(request, error, status);
    }
  },
  websocket: {
    open(ws) {
      const { userId, sessionId } = ws.data;
      try {
        sshService.attachWebsocket(userId, sessionId, ws);
      } catch (error: unknown) {
        ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Open failed" }));
        ws.close();
      }
    },
    message(ws, message) {
      const { userId, sessionId } = ws.data;
      try {
        const raw = typeof message === "string" ? message : Buffer.from(message);
        sshService.onWebsocketMessage(userId, sessionId, raw);
      } catch (error: unknown) {
        ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Message failed" }));
      }
    },
    close(ws) {
      const { userId, sessionId } = ws.data;
      sshService.detachWebsocket(userId, sessionId, ws);
    },
  },
});

console.log(`proxy listening on ${server.hostname}:${server.port}`);
