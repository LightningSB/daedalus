import { randomUUID } from "node:crypto";
import { loadConfig } from "./config";
import { MinioStore, type StoredHost } from "./storage/minioStore";
import { VaultService } from "./services/vaultService";
import { SshService } from "./services/sshService";
import * as dockerService from "./services/dockerService";
import * as dockerComposeService from "./services/dockerComposeService";
import { SshDockerService } from "./services/sshDockerService";
import { MagicLinkService } from "./services/magicLinkService";
import { getVaultToken, json, readJson } from "./utils/http";
import { verifyTelegramInitData } from "./utils/telegramAuth";
import type { WsSessionData } from "./types/docker";
import type { TmuxBind } from './types/tmuxBind';

const config = loadConfig();
const store = new MinioStore(config.minio);
await store.init();

const vault = new VaultService(store, config.vaultIdleTimeoutMs);
const sshService = new SshService(store, vault, config.sshAllowedHosts);
const sshDockerService = new SshDockerService(sshService);
const magicLinkService = new MagicLinkService(store, config);

// Log-once flags to prevent repeated noise for persistent infra failures.
let selfContainerSuccessLogged = false;
let selfContainerFailureLogged = false;

// User-scoped event subscribers (for realtime push)
const userEventSockets = new Map<string, Set<Bun.ServerWebSocket<unknown>>>();

function broadcastUserEvent(userId: string, event: unknown): void {
  const sockets = userEventSockets.get(userId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    try { ws.send(payload); } catch { /* ignore closed */ }
  }
}

/**
 * Verifies the x-telegram-init-data header against the path :userId.
 * Returns null if verification passes or if no bot token is configured (development mode).
 * Returns an error Response if the userId does not match the verified identity.
 */
function requireTelegramUserId(request: Request, pathUserId: string): Response | null {
  const botToken = config.telegram.botToken;
  if (!botToken) {
    // No bot token configured — skip verification (development mode)
    return null;
  }

  const initData = request.headers.get("x-telegram-init-data");
  if (!initData) {
    // No initData header — for now allow (graceful degradation for CLI callers)
    return null;
  }

  const result = verifyTelegramInitData(initData, botToken);
  if (!result.ok) {
    return withCors(json({ error: `Unauthorized: ${result.reason}` }, 401), request);
  }

  if (result.userId !== pathUserId) {
    return withCors(json({ error: "Forbidden: userId mismatch" }, 403), request);
  }

  return null;
}

function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin") ?? "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-vault-token,x-telegram-init-data",
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

async function logServerEvent(input: {
  userId?: string;
  level?: "debug" | "info" | "warn" | "error";
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await store.appendClientLogEvent({
      ts: new Date().toISOString(),
      userId: input.userId ?? "system",
      level: input.level ?? "info",
      category: input.category,
      message: input.message,
      meta: input.meta,
    });
  } catch {
    // best effort
  }
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

async function handleClientLogs(request: Request, userId: string): Promise<Response> {
  if (request.method === "POST") {
    const body = await readJson<{
      level?: "debug" | "info" | "warn" | "error";
      category?: string;
      message: string;
      meta?: Record<string, unknown>;
      ts?: string;
    }>(request);

    if (!body.message || typeof body.message !== "string") {
      return bad(request, new Error("message is required"), 400);
    }

    try {
      await store.appendClientLogEvent({
        ts: body.ts ?? new Date().toISOString(),
        userId,
        level: body.level ?? "info",
        category: body.category ?? "client",
        message: body.message,
        meta: body.meta,
      });
      return ok(request, { ok: true }, 201);
    } catch (error) {
      await logServerEvent({
        userId,
        level: "error",
        category: "client-logs",
        message: "append_client_log_failed",
        meta: {
          originalMessage: body.message,
          error: error instanceof Error ? error.message : "unknown",
        },
      });
      return bad(request, error, 500);
    }
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleUserEmailProfile(request: Request, userId: string): Promise<Response> {
  if (request.method === "GET") {
    const profile = await magicLinkService.getUserEmail(userId);
    return ok(request, profile);
  }

  if (request.method === "POST") {
    const body = await readJson<{ email?: string }>(request);
    if (!body.email) {
      return bad(request, new Error("email is required"), 400);
    }
    const profile = await magicLinkService.setUserEmail(userId, body.email);
    return ok(request, profile, 201);
  }

  return bad(request, new Error("Method not allowed"), 405);
}

async function handleMagicLinkSend(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return bad(request, new Error("Method not allowed"), 405);
  }

  const body = await readJson<{ email?: string }>(request);
  if (!body.email) {
    return bad(request, new Error("email is required"), 400);
  }

  await magicLinkService.sendMagicLinkToTelegram(body.email);
  return ok(request, { ok: true });
}

async function handleMagicLinkVerify(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return bad(request, new Error("Method not allowed"), 405);
  }

  const body = await readJson<{ token?: string }>(request);
  if (!body.token) {
    return bad(request, new Error("token is required"), 400);
  }

  const out = await magicLinkService.verifyMagicLink(body.token);
  return ok(request, out);
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

    try {
      const summary = await sshService.createSession(userId, {
        ...body,
        vaultToken: getVaultToken(request) ?? undefined,
      });
      await logServerEvent({
        userId,
        category: "ssh-session",
        message: "session_created",
        meta: { sessionId: summary.id, host: summary.host, port: summary.port },
      });
      return ok(request, { session: summary }, 201);
    } catch (error) {
      await logServerEvent({
        userId,
        level: "error",
        category: "ssh-session",
        message: "session_create_failed",
        meta: {
          hostId: body.hostId,
          host: body.host,
          command: body.command,
          error: error instanceof Error ? error.message : "unknown",
        },
      });
      throw error;
    }
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
    try {
      await sshService.closeSession(userId, sessionId);
      await logServerEvent({ userId, category: "ssh-session", message: "session_closed", meta: { sessionId } });
      return ok(request, { ok: true });
    } catch (error) {
      await logServerEvent({
        userId,
        level: "warn",
        category: "ssh-session",
        message: "session_close_failed",
        meta: { sessionId, error: error instanceof Error ? error.message : "unknown" },
      });
      throw error;
    }
  }

  if (action === "close" && request.method === "DELETE") {
    try {
      await sshService.closeSession(userId, sessionId);
      await logServerEvent({ userId, category: "ssh-session", message: "session_closed", meta: { sessionId } });
      return ok(request, { ok: true });
    } catch (error) {
      await logServerEvent({
        userId,
        level: "warn",
        category: "ssh-session",
        message: "session_close_failed",
        meta: { sessionId, error: error instanceof Error ? error.message : "unknown" },
      });
      throw error;
    }
  }

  if (action === "resize" && request.method === "POST") {
    const body = await readJson<{ cols: number; rows: number }>(request);
    try {
      sshService.resizeSession(userId, sessionId, body.cols, body.rows);
      return ok(request, { ok: true });
    } catch (error) {
      await logServerEvent({
        userId,
        level: "warn",
        category: "ssh-session",
        message: "session_resize_failed",
        meta: { sessionId, cols: body.cols, rows: body.rows, error: error instanceof Error ? error.message : "unknown" },
      });
      throw error;
    }
  }

  return bad(request, new Error("Method not allowed"), 405);
}

function tmuxSessionName(value: string): string {
  // Conservative allowlist for tmux session names.
  return value.replace(/[^a-zA-Z0-9_.:-]/g, "");
}

async function cleanupTmuxBindTarget(userId: string, bind: TmuxBind): Promise<void> {
  // Best-effort cleanup on delete so a removed sidebar bind doesn't leave stale tmux sessions.
  if (bind.target.kind !== "local-tmux") return;

  const sessionName = tmuxSessionName(bind.target.tmuxSession || "");
  if (!sessionName) return;

  try {
    const proc = Bun.spawn(["tmux", "kill-session", "-t", sessionName], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    await logServerEvent({
      userId,
      category: "tmux-bind",
      message: "local_tmux_cleanup_attempted",
      meta: { bindId: bind.id, tmuxSession: sessionName },
    });
  } catch (error) {
    await logServerEvent({
      userId,
      level: "warn",
      category: "tmux-bind",
      message: "local_tmux_cleanup_failed",
      meta: {
        bindId: bind.id,
        tmuxSession: sessionName,
        error: error instanceof Error ? error.message : "unknown",
      },
    });
  }
}

async function handleSshSessionFs(
  request: Request,
  userId: string,
  sessionId: string,
  action: "list" | "stat" | "preview" | "download" | "upload" | "mkdir" | "rename" | "delete",
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get("path");

  if (action === "list" && request.method === "GET") {
    if (!path) {
      return bad(request, new Error("Path is required"), 400);
    }
    const data = await sshService.listDirectory(userId, sessionId, path);
    return ok(request, data);
  }

  if (action === "stat" && request.method === "GET") {
    if (!path) {
      return bad(request, new Error("Path is required"), 400);
    }
    const data = await sshService.statPath(userId, sessionId, path);
    return ok(request, data);
  }

  if (action === "preview" && request.method === "GET") {
    if (!path) {
      return bad(request, new Error("Path is required"), 400);
    }
    const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
    const limitRaw = Number(url.searchParams.get("limit") ?? 0);
    const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
    const limit = Number.isFinite(limitRaw) ? limitRaw : 0;
    const data = await sshService.readPreview(userId, sessionId, path, offset, limit);
    return ok(request, data);
  }

  if (action === "download" && request.method === "GET") {
    if (!path) {
      return bad(request, new Error("Path is required"), 400);
    }
    const inline = url.searchParams.get("inline") === "true" || url.searchParams.get("inline") === "1";
    const data = await sshService.createDownload(userId, sessionId, path);
    const headers = new Headers({
      "content-type": data.mimeType,
      "content-length": String(data.size),
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${data.filename.replace(/"/g, "")}"`,
    });
    return withCors(new Response(data.stream, { status: 200, headers }), request);
  }

  if (action === "upload" && request.method === "PUT") {
    if (!path) {
      return bad(request, new Error("Path is required"), 400);
    }
    if (!request.body) {
      return bad(request, new Error("Upload body required"), 400);
    }
    const data = await request.arrayBuffer();
    const out = await sshService.uploadFile(userId, sessionId, path, data);
    return ok(request, { ok: true, size: out.size }, 201);
  }

  if (action === "mkdir" && request.method === "POST") {
    const body = await readJson<{ path?: string }>(request);
    const target = body.path ?? path;
    if (!target) {
      return bad(request, new Error("Path is required"), 400);
    }
    await sshService.mkdir(userId, sessionId, target);
    return ok(request, { ok: true }, 201);
  }

  if (action === "rename" && request.method === "POST") {
    const body = await readJson<{ from?: string; to?: string }>(request);
    if (!body.from || !body.to) {
      return bad(request, new Error("Both from and to are required"), 400);
    }
    await sshService.rename(userId, sessionId, body.from, body.to);
    return ok(request, { ok: true });
  }

  if (action === "delete" && request.method === "DELETE") {
    const body = await readJson<{ path?: string; recursive?: boolean }>(request);
    const target = body.path ?? path;
    if (!target) {
      return bad(request, new Error("Path is required"), 400);
    }
    await sshService.deletePath(userId, sessionId, target, Boolean(body.recursive));
    return ok(request, { ok: true });
  }

  return bad(request, new Error("Method not allowed"), 405);
}

const server = Bun.serve<WsSessionData>({
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

      match = pathname.match(/^\/api\/users\/([^/]+)\/client-logs$/);
      if (match) {
        return await handleClientLogs(request, decodeURIComponent(match[1]));
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/profile\/email$/);
      if (match) {
        return await handleUserEmailProfile(request, decodeURIComponent(match[1]));
      }

      if (pathname === "/api/auth/magic-link/send") {
        return await handleMagicLinkSend(request);
      }

      if (pathname === "/api/auth/magic-link/verify") {
        return await handleMagicLinkVerify(request);
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
          data: { kind: "ssh" as const, userId, sessionId },
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

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/tmux$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const result = await sshService.getTmuxSessions(userId, sessionId);
        return ok(request, result);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/fs\/(list|stat|preview|download|upload|mkdir|rename|delete)$/);
      if (match) {
        return await handleSshSessionFs(
          request,
          decodeURIComponent(match[1]),
          decodeURIComponent(match[2]),
          match[3] as "list" | "stat" | "preview" | "download" | "upload" | "mkdir" | "rename" | "delete",
        );
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)$/);
      if (match) {
        return await handleSshSessionDetail(request, decodeURIComponent(match[1]), decodeURIComponent(match[2]));
      }

      // -----------------------------------------------------------------------
      // Docker routes
      // -----------------------------------------------------------------------

      if (pathname === "/api/docker/health" && request.method === "GET") {
        const available = await dockerService.isDockerAvailable();
        return ok(request, { available });
      }

      if (pathname === "/api/docker/self" && request.method === "GET") {
        try {
          const self = await dockerService.getSelfContainer();
          // Log only the first successful resolution per process lifetime.
          if (!selfContainerSuccessLogged) {
            selfContainerSuccessLogged = true;
            await logServerEvent({
              category: "docker-self",
              message: "resolved_self_container",
              meta: { containerId: self.containerId, name: self.name, hostname: process.env.HOSTNAME ?? null },
            });
          }
          return ok(request, self);
        } catch (error) {
          // Log only the first failure per process lifetime to avoid log storms.
          if (!selfContainerFailureLogged) {
            selfContainerFailureLogged = true;
            await logServerEvent({
              level: "error",
              category: "docker-self",
              message: "resolve_self_container_failed",
              meta: { hostname: process.env.HOSTNAME ?? null, error: error instanceof Error ? error.message : "unknown" },
            });
          }
          // 503 (not 400): this is an infrastructure/config issue, not a bad
          // client request.  The frontend can surface a more targeted message.
          return bad(request, error, 503);
        }
      }

      if (pathname === "/api/docker/compose/projects" && request.method === "GET") {
        const projects = await dockerComposeService.listComposeProjects();
        return ok(request, { projects });
      }

      if (pathname === "/api/docker/compose/run" && request.method === "POST") {
        const body = await readJson<{
          projectName: string;
          configFile: string;
          service: string;
          args?: string[];
        }>(request);

        if (!body.projectName || !body.configFile || !body.service) {
          return bad(request, new Error("projectName, configFile, service are required"), 400);
        }

        const corsHdrs = corsHeaders(request);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            const abortController = new AbortController();

            try {
              await dockerComposeService.runComposeTask(
                body.projectName,
                body.configFile,
                body.service,
                body.args ?? [],
                (event) => {
                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
                    );
                  } catch {
                    // stream closed
                  }
                },
                abortController.signal,
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : "Unknown error";
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
                ),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            ...corsHdrs,
          } as HeadersInit,
        });
      }

      if (pathname === "/api/docker/containers" && request.method === "GET") {
        const url = new URL(request.url);
        const all = url.searchParams.get("all") === "true" || url.searchParams.get("all") === "1";
        const containers = await dockerService.listContainers(all);
        return ok(request, { containers });
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/inspect$/);
      if (match && request.method === "GET") {
        const containerId = decodeURIComponent(match[1]);
        const info = await dockerService.inspectContainer(containerId);
        return ok(request, { info });
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/tmux$/);
      if (match && request.method === "GET") {
        const containerId = decodeURIComponent(match[1]);
        const tmux = await dockerService.getTmuxSessions(containerId);
        return ok(request, tmux);
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/fs\/list$/);
      if (match && request.method === "GET") {
        const containerId = decodeURIComponent(match[1]);
        const url = new URL(request.url);
        const path = url.searchParams.get("path") ?? "/";
        const entries = await dockerService.listContainerFiles(containerId, path);
        return ok(request, { entries, path });
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/fs\/preview$/);
      if (match && request.method === "GET") {
        const containerId = decodeURIComponent(match[1]);
        const url = new URL(request.url);
        const path = url.searchParams.get("path");
        if (!path) return bad(request, new Error("path is required"), 400);
        const limitRaw = Number(url.searchParams.get("limit") ?? 65536);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 65536;
        const preview = await dockerService.previewContainerFile(containerId, path, limit);
        return ok(request, preview);
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/exec\/ws$/);
      if (match) {
        const containerId = decodeURIComponent(match[1]);
        const execSessionId = randomUUID();
        const upgraded = serverInstance.upgrade(request, {
          data: { kind: "docker-exec" as const, containerId, execSessionId },
        });
        if (upgraded) return undefined;
        return bad(request, new Error("WebSocket upgrade failed"), 400);
      }

      match = pathname.match(/^\/api\/docker\/containers\/([^/]+)\/exec\/resize$/);
      if (match && request.method === "POST") {
        const body = await readJson<{ execSessionId: string; cols: number; rows: number }>(request);
        dockerService.resizeExecTerminal(body.execSessionId, body.cols, body.rows);
        return ok(request, { ok: true });
      }

      // -----------------------------------------------------------------------
      // SSH-scoped Docker routes
      // /api/users/:userId/ssh/sessions/:sessionId/docker/...
      // -----------------------------------------------------------------------

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/health$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const available = await sshDockerService.health(userId, sessionId);
        return ok(request, { available });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const all = url.searchParams.get("all") === "true" || url.searchParams.get("all") === "1";
        const containers = await sshDockerService.listContainers(userId, sessionId, all);
        return ok(request, { containers });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/inspect$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const containerId = decodeURIComponent(match[3]);
        const info = await sshDockerService.inspectContainer(userId, sessionId, containerId);
        return ok(request, { info });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/tmux$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const containerId = decodeURIComponent(match[3]);
        const tmux = await sshDockerService.getContainerTmux(userId, sessionId, containerId);
        return ok(request, tmux);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/fs\/list$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const containerId = decodeURIComponent(match[3]);
        const fsPath = url.searchParams.get("path") ?? "/";
        const entries = await sshDockerService.listContainerFiles(userId, sessionId, containerId, fsPath);
        return ok(request, { entries, path: fsPath });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/fs\/preview$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const containerId = decodeURIComponent(match[3]);
        const fsPath = url.searchParams.get("path");
        if (!fsPath) return bad(request, new Error("path is required"), 400);
        const limitRaw = Number(url.searchParams.get("limit") ?? 65536);
        const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 65536;
        const preview = await sshDockerService.previewContainerFile(userId, sessionId, containerId, fsPath, limit);
        return ok(request, preview);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/exec\/ws$/);
      if (match) {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const containerId = decodeURIComponent(match[3]);
        const execSessionId = randomUUID();
        const upgraded = serverInstance.upgrade(request, {
          data: { kind: "ssh-docker-exec" as const, userId, sessionId, containerId, execSessionId },
        });
        if (upgraded) return undefined;
        return bad(request, new Error("WebSocket upgrade failed"), 400);
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/containers\/([^/]+)\/exec\/resize$/);
      if (match && request.method === "POST") {
        const body = await readJson<{ execSessionId: string; cols: number; rows: number }>(request);
        sshService.resizeSshExecTerminal(body.execSessionId, body.cols, body.rows);
        return ok(request, { ok: true });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/compose\/projects$/);
      if (match && request.method === "GET") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const projects = await sshDockerService.listComposeProjects(userId, sessionId);
        return ok(request, { projects });
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/ssh\/sessions\/([^/]+)\/docker\/compose\/run$/);
      if (match && request.method === "POST") {
        const userId = decodeURIComponent(match[1]);
        const sessionId = decodeURIComponent(match[2]);
        const body = await readJson<{
          projectName: string;
          configFile: string;
          service: string;
          args?: string[];
        }>(request);

        if (!body.projectName || !body.configFile || !body.service) {
          return bad(request, new Error("projectName, configFile, service are required"), 400);
        }

        const corsHdrs = corsHeaders(request);
        const encoder = new TextEncoder();

        const stream = new ReadableStream({
          async start(controller) {
            const abortController = new AbortController();

            try {
              await sshDockerService.runComposeTask(
                userId,
                sessionId,
                body.projectName,
                body.configFile,
                body.service,
                body.args ?? [],
                (event) => {
                  try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                  } catch {
                    // stream closed
                  }
                },
                abortController.signal,
              );
            } catch (error) {
              const msg = error instanceof Error ? error.message : "Unknown error";
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "x-accel-buffering": "no",
            ...corsHdrs,
          } as HeadersInit,
        });
      }

      // -----------------------------------------------------------------------
      // Tmux Bind routes: /api/users/:userId/tmux/binds
      // -----------------------------------------------------------------------
      match = pathname.match(/^\/api\/users\/([^/]+)\/tmux\/binds$/);
      if (match) {
        const userId = decodeURIComponent(match[1]);
        const authErr = requireTelegramUserId(request, userId);
        if (authErr) return authErr;

        // GET - list all binds
        if (request.method === "GET") {
          const binds = await store.getTmuxBinds(userId);
          return ok(request, { binds });
        }

        // POST - create a new bind
        if (request.method === "POST") {
          const body = await readJson<{ title: string; target: TmuxBind['target']; autoFocus?: boolean }>(request);
          if (!body.title || !body.target) {
            return bad(request, new Error("title and target are required"), 400);
          }
          const binds = await store.getTmuxBinds(userId);
          const now = new Date().toISOString();
          const bind: TmuxBind = {
            id: `bind-${randomUUID()}`,
            title: body.title,
            createdAt: now,
            updatedAt: now,
            target: body.target,
            autoFocus: body.autoFocus,
          };
          binds.push(bind);
          await store.putTmuxBinds(userId, binds);
          const viewerUrl = `${config.appOrigin}/#/bind/${bind.id}`;
          broadcastUserEvent(userId, { type: "tmux-bind-created", bind });
          return ok(request, { bind, viewerUrl }, 201);
        }
      }

      match = pathname.match(/^\/api\/users\/([^/]+)\/tmux\/binds\/([^/]+)$/);
      if (match) {
        const userId = decodeURIComponent(match[1]);
        const bindId = decodeURIComponent(match[2]);
        const authErr = requireTelegramUserId(request, userId);
        if (authErr) return authErr;

        // DELETE - remove a bind
        if (request.method === "DELETE") {
          const binds = await store.getTmuxBinds(userId);
          const idx = binds.findIndex((b) => b.id === bindId);
          if (idx === -1) return bad(request, new Error("Bind not found"), 404);
          const [removed] = binds.splice(idx, 1);

          // Best-effort target cleanup before removing bind record.
          await cleanupTmuxBindTarget(userId, removed);

          await store.putTmuxBinds(userId, binds);
          broadcastUserEvent(userId, { type: "tmux-bind-deleted", bindId });
          return ok(request, { ok: true });
        }
      }

      // User events WebSocket: /api/users/:userId/events
      match = pathname.match(/^\/api\/users\/([^/]+)\/events$/);
      if (match) {
        const userId = decodeURIComponent(match[1]);
        const upgraded = serverInstance.upgrade(request, {
          data: { kind: "user-events" as const, userId },
        });
        if (upgraded) return undefined;
        return bad(request, new Error("WebSocket upgrade failed"), 400);
      }

      return bad(request, new Error("Not found"), 404);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      const status = message.includes("not found") || message.includes("Not found") ? 404 : 400;

      const userIdMatch = pathname.match(/^\/api\/users\/([^/]+)/);
      const sessionMatch = pathname.match(/\/ssh\/sessions\/([^/]+)/);
      await logServerEvent({
        userId: userIdMatch ? decodeURIComponent(userIdMatch[1]) : undefined,
        level: "error",
        category: "request-error",
        message: "request_failed",
        meta: {
          path: pathname,
          method: request.method,
          status,
          error: message,
          sessionId: sessionMatch ? decodeURIComponent(sessionMatch[1]) : undefined,
        },
      });

      return bad(request, error, status);
    }
  },
  websocket: {
    open(ws) {
      const data = ws.data;
      if (data.kind === "ssh") {
        try {
          // Cast: sshService expects ServerWebSocket with legacy data shape; runtime compatible.
          sshService.attachWebsocket(
            data.userId,
            data.sessionId,
            ws as unknown as Bun.ServerWebSocket<{ userId: string; sessionId: string }>,
          );
        } catch (error: unknown) {
          void logServerEvent({
            userId: data.userId,
            level: "warn",
            category: "ssh-ws",
            message: "attach_failed",
            meta: { sessionId: data.sessionId, error: error instanceof Error ? error.message : "unknown" },
          });
          ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Open failed" }));
          ws.close();
        }
      } else if (data.kind === "docker-exec") {
        void dockerService.attachExecWebSocket(data, ws);
      } else if (data.kind === "ssh-docker-exec") {
        void sshService.attachSshExecWebSocket(
          data.userId,
          data.sessionId,
          data.containerId,
          data.execSessionId,
          ws,
        ).catch((error: unknown) => {
          void logServerEvent({
            userId: data.userId,
            level: "warn",
            category: "ssh-docker-ws",
            message: "attach_failed",
            meta: {
              sessionId: data.sessionId,
              containerId: data.containerId,
              execSessionId: data.execSessionId,
              error: error instanceof Error ? error.message : "unknown",
            },
          });
          try {
            ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Open failed" }));
            ws.close();
          } catch {
            // ignore
          }
        });
      } else if (data.kind === "user-events") {
        const { userId } = data;
        if (!userEventSockets.has(userId)) {
          userEventSockets.set(userId, new Set());
        }
        userEventSockets.get(userId)!.add(ws);
      }
    },
    message(ws, message) {
      const data = ws.data;
      if (data.kind === "ssh") {
        try {
          const raw = typeof message === "string" ? message : Buffer.from(message);
          sshService.onWebsocketMessage(data.userId, data.sessionId, raw);
        } catch (error: unknown) {
          ws.send(JSON.stringify({ type: "error", message: error instanceof Error ? error.message : "Message failed" }));
        }
      } else if (data.kind === "docker-exec") {
        try {
          const parsed = JSON.parse(typeof message === "string" ? message : Buffer.from(message).toString()) as {
            type?: string;
            data?: string;
            cols?: number;
            rows?: number;
          };
          if (parsed.type === "input" && typeof parsed.data === "string") {
            dockerService.sendExecInput(data.execSessionId, parsed.data);
          } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            dockerService.resizeExecTerminal(data.execSessionId, parsed.cols, parsed.rows);
          }
        } catch {
          // ignore malformed messages
        }
      } else if (data.kind === "ssh-docker-exec") {
        try {
          const parsed = JSON.parse(typeof message === "string" ? message : Buffer.from(message).toString()) as {
            type?: string;
            data?: string;
            cols?: number;
            rows?: number;
          };
          if (parsed.type === "input" && typeof parsed.data === "string") {
            sshService.sendSshExecInput(data.execSessionId, parsed.data);
          } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
            sshService.resizeSshExecTerminal(data.execSessionId, parsed.cols, parsed.rows);
          }
        } catch {
          // ignore malformed messages
        }
      }
    },
    close(ws) {
      const data = ws.data;
      if (data.kind === "ssh") {
        sshService.detachWebsocket(
          data.userId,
          data.sessionId,
          ws as unknown as Bun.ServerWebSocket<{ userId: string; sessionId: string }>,
        );
      } else if (data.kind === "docker-exec") {
        dockerService.detachExecWebSocket(data.execSessionId);
      } else if (data.kind === "ssh-docker-exec") {
        sshService.detachSshExecWebSocket(data.execSessionId);
      } else if (data.kind === "user-events") {
        const sockets = userEventSockets.get(data.userId);
        if (sockets) {
          sockets.delete(ws);
          if (sockets.size === 0) userEventSockets.delete(data.userId);
        }
      }
    },
  },
});

console.log(`proxy listening on ${server.hostname}:${server.port}`);
