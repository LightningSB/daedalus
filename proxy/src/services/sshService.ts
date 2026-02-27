import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import { posix as pathPosix } from "node:path";
import { Client, type ClientChannel, type ConnectConfig, type OpenMode, type SFTPWrapper, type Stats } from "ssh2";
import socksv5 from "socksv5";
import { MinioStore, type AuditEvent, type KnownHostsMap, type StoredSecret } from "../storage/minioStore";
import { VaultService } from "./vaultService";
import {
  parseSshCommand,
  type DynamicForward,
  type LocalForward,
  type RemoteForward,
} from "../utils/sshCommandParser";
import type { TmuxStatus, TmuxSession, WsSessionData } from "../types/docker";

export type SessionSummary = {
  id: string;
  userId: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
  connected: boolean;
};

type SessionSocketData = {
  userId: string;
  sessionId: string;
};

type Session = {
  id: string;
  userId: string;
  host: string;
  port: number;
  username: string;
  createdAt: string;
  connected: boolean;
  conn: Client;
  shell: ClientChannel;
  localServers: net.Server[];
  dynamicServers: net.Server[];
  remoteMappings: Array<RemoteForward>;
  sockets: Set<Bun.ServerWebSocket<SessionSocketData>>;
  sftp?: SFTPWrapper;
  sftpPromise?: Promise<SFTPWrapper>;
};

export type CreateSessionInput = {
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
  vaultToken?: string;
};

export type SftpEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  mode: number;
  target?: string;
};

export type SftpStat = {
  path: string;
  resolvedPath?: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
  mtimeMs: number;
  mode: number;
  isSymlink: boolean;
  target?: string;
};

export type SftpPreview = {
  path: string;
  size: number;
  offset: number;
  limit: number;
  bytesRead: number;
  truncated: boolean;
  kind: "text" | "binary";
  encoding?: "utf-8";
  data?: string;
};

export type SftpDownload = {
  filename: string;
  size: number;
  mimeType: string;
  stream: ReadableStream<Uint8Array>;
};

const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_LIST_ENTRIES = 5000;
const MAX_SYMLINK_DEPTH = 12;
const MAX_DELETE_DEPTH = 24;

type SftpDirEntry = { filename: string; longname: string; attrs: Stats };

function normalizeRemotePath(input: string | undefined | null): string {
  const raw = (input ?? "").trim();
  if (!raw) {
    return ".";
  }
  if (raw.includes("\0")) {
    throw new Error("Invalid path");
  }
  const sanitized = raw.replace(/\\/g, "/");
  if (sanitized.startsWith("~")) {
    return sanitized;
  }
  const normalized = pathPosix.normalize(sanitized);
  return normalized.length ? normalized : ".";
}

function statKind(stats: Stats): "file" | "dir" | "symlink" | "other" {
  if (stats.isDirectory()) {
    return "dir";
  }
  if (stats.isFile()) {
    return "file";
  }
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

function toMtimeMs(stats: Stats): number {
  if (typeof stats.mtime === "number") {
    return stats.mtime * 1000;
  }
  return 0;
}

function isProbablyText(buffer: Buffer): boolean {
  if (!buffer.length) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 2048));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
    if (byte < 7 || (byte > 14 && byte < 32)) {
      suspicious += 1;
    }
  }
  return suspicious / sample.length < 0.15;
}

function guessMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt") || lower.endsWith(".log")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  return "application/octet-stream";
}

function sftpStat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(path, (error, stats) => {
      if (error || !stats) {
        reject(error ?? new Error("Stat failed"));
        return;
      }
      resolve(stats);
    });
  });
}

function sftpLstat(sftp: SFTPWrapper, path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.lstat(path, (error, stats) => {
      if (error || !stats) {
        reject(error ?? new Error("Lstat failed"));
        return;
      }
      resolve(stats);
    });
  });
}

function sftpReadlink(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.readlink(path, (error, target) => {
      if (error || !target) {
        reject(error ?? new Error("Readlink failed"));
        return;
      }
      resolve(target);
    });
  });
}

function sftpReaddir(sftp: SFTPWrapper, path: string): Promise<SftpDirEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (error, list) => {
      if (error || !list) {
        reject(error ?? new Error("Readdir failed"));
        return;
      }
      resolve(list as SftpDirEntry[]);
    });
  });
}

function sftpOpen(sftp: SFTPWrapper, path: string, flags: OpenMode): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(path, flags, (error, handle) => {
      if (error || !handle) {
        reject(error ?? new Error("Open failed"));
        return;
      }
      resolve(handle);
    });
  });
}

function sftpRead(
  sftp: SFTPWrapper,
  handle: Buffer,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
): Promise<number> {
  return new Promise((resolve, reject) => {
    sftp.read(handle, buffer, offset, length, position, (error, bytesRead) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(bytesRead ?? 0);
    });
  });
}

function sftpWrite(
  sftp: SFTPWrapper,
  handle: Buffer,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buffer, offset, length, position, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function sftpClose(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve) => {
    sftp.close(handle, () => resolve());
  });
}

async function resolveSymlinkChain(
  sftp: SFTPWrapper,
  inputPath: string,
): Promise<{ resolvedPath: string; lstat: Stats; target?: string }> {
  let current = inputPath;
  let lstat = await sftpLstat(sftp, current);
  if (!lstat.isSymbolicLink()) {
    return { resolvedPath: current, lstat };
  }

  const visited = new Set<string>();
  let firstTarget: string | undefined;

  for (let depth = 0; depth < MAX_SYMLINK_DEPTH; depth += 1) {
    if (!lstat.isSymbolicLink()) {
      return { resolvedPath: current, lstat, target: firstTarget };
    }

    if (visited.has(current)) {
      throw new Error("Symlink loop detected");
    }
    visited.add(current);

    const target = await sftpReadlink(sftp, current);
    if (!firstTarget) {
      firstTarget = target;
    }

    if (target.startsWith("/") || target.startsWith("~")) {
      current = normalizeRemotePath(target);
    } else {
      current = normalizeRemotePath(pathPosix.resolve(pathPosix.dirname(current), target));
    }
    lstat = await sftpLstat(sftp, current);
  }

  throw new Error("Symlink resolution depth exceeded");
}

function toFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64")}`;
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function isLoopback(bindHost: string): boolean {
  return bindHost === "127.0.0.1" || bindHost === "localhost" || bindHost === "::1";
}

function normalizeLoopbackHost(bindHost: string): string {
  if (bindHost === "localhost" || bindHost === "::1") {
    return "127.0.0.1";
  }
  return bindHost;
}

function isLoopbackAddress(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1" || ip === "localhost";
}

function getBindAddress(server: net.Server): string {
  const address = server.address();
  if (typeof address === "string") {
    return address;
  }
  if (!address) {
    return "127.0.0.1:0";
  }
  const ai = address as AddressInfo;
  return `${ai.address}:${ai.port}`;
}

function parseTmuxOutput(stdout: string, stderr: string, code: number): TmuxStatus {
  const combined = (stdout + stderr).toLowerCase();

  if (
    code === 127 ||
    combined.includes("command not found") ||
    combined.includes("executable file not found") ||
    combined.includes("no such file")
  ) {
    return { available: false, status: "not-installed", sessions: [] };
  }

  if (
    code !== 0 &&
    (combined.includes("no server running") ||
      combined.includes("no sessions") ||
      combined.includes("error connecting"))
  ) {
    return { available: true, status: "no-server", sessions: [] };
  }

  if (code !== 0) {
    return {
      available: true,
      status: "error",
      sessions: [],
      error: (stdout + stderr).trim().slice(0, 300),
    };
  }

  const sessions: TmuxSession[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    sessions.push({
      name: (parts[0] ?? "").trim(),
      windows: parseInt((parts[1] ?? "0").trim(), 10) || 0,
      attached: (parts[2] ?? "0").trim() === "1",
      raw: line,
    });
  }

  return { available: true, status: "ok", sessions };
}

export class SshService {
  private readonly sessions = new Map<string, Session>();
  private readonly execChannels = new Map<string, ClientChannel>();

  constructor(
    private readonly store: MinioStore,
    private readonly vault: VaultService,
    private readonly allowedHosts: Set<string>,
  ) {}

  async listSessions(userId: string): Promise<SessionSummary[]> {
    const out: SessionSummary[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        out.push({
          id: session.id,
          userId: session.userId,
          host: session.host,
          port: session.port,
          username: session.username,
          createdAt: session.createdAt,
          connected: session.connected,
        });
      }
    }
    return out;
  }

  private async loadKnownHosts(userId: string): Promise<KnownHostsMap> {
    return this.store.getKnownHosts(userId);
  }

  private async logAudit(event: AuditEvent): Promise<void> {
    await this.store.appendAuditEvent(event);
  }

  private sendAll(session: Session, payload: unknown): void {
    const encoded = JSON.stringify(payload);
    for (const ws of session.sockets) {
      try {
        ws.send(encoded);
      } catch {
        ws.close();
      }
    }
  }

  private async getSftp(session: Session): Promise<SFTPWrapper> {
    if (!session.connected) {
      throw new Error("Session is not connected");
    }
    if (session.sftp) {
      return session.sftp;
    }
    if (session.sftpPromise) {
      return session.sftpPromise;
    }

    session.sftpPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      session.conn.sftp((error, sftp) => {
        if (error || !sftp) {
          session.sftpPromise = undefined;
          reject(error ?? new Error("SFTP initialization failed"));
          return;
        }

        const clear = () => {
          if (session.sftp === sftp) {
            session.sftp = undefined;
          }
          if (session.sftpPromise) {
            session.sftpPromise = undefined;
          }
        };

        sftp.once("close", clear);
        sftp.once("end", clear);
        session.sftp = sftp;
        session.sftpPromise = undefined;
        resolve(sftp);
      });
    });

    return session.sftpPromise;
  }

  private async setupLocalForward(session: Session, forward: LocalForward): Promise<void> {
    if (!isLoopback(forward.bindHost)) {
      throw new Error(`Local forward bind host must be loopback (127.0.0.1/localhost/::1), got ${forward.bindHost}`);
    }

    const bindHost = normalizeLoopbackHost(forward.bindHost);

    const server = net.createServer((socket) => {
      session.conn.forwardOut(
        socket.remoteAddress ?? "127.0.0.1",
        socket.remotePort ?? 0,
        forward.targetHost,
        forward.targetPort,
        (error: Error | undefined, stream: NodeJS.ReadWriteStream) => {
          if (error || !stream) {
            socket.destroy(error ?? undefined);
            return;
          }

          socket.pipe(stream);
          stream.pipe(socket);
        },
      );
    });

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(forward.bindPort, bindHost, () => resolve());
    });

    session.localServers.push(server);
    this.sendAll(session, {
      type: "forward",
      mode: "L",
      bind: getBindAddress(server),
      target: `${forward.targetHost}:${forward.targetPort}`,
    });
  }

  private async setupRemoteForward(session: Session, forward: RemoteForward): Promise<void> {
    if (!isLoopback(forward.bindHost)) {
      throw new Error(`Remote forward bind host must be loopback (127.0.0.1/localhost/::1), got ${forward.bindHost}`);
    }

    const bindHost = normalizeLoopbackHost(forward.bindHost);

    await new Promise<void>((resolve, reject) => {
      session.conn.forwardIn(bindHost, forward.bindPort, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const normalizedForward: RemoteForward = {
      ...forward,
      bindHost,
    };

    session.remoteMappings.push(normalizedForward);
    this.sendAll(session, {
      type: "forward",
      mode: "R",
      bind: `${normalizedForward.bindHost}:${normalizedForward.bindPort}`,
      target: `${normalizedForward.targetHost}:${normalizedForward.targetPort}`,
    });
  }

  private async setupDynamicForward(session: Session, forward: DynamicForward): Promise<void> {
    if (!isLoopback(forward.bindHost)) {
      throw new Error(`Dynamic forward bind host must be loopback (127.0.0.1/localhost/::1), got ${forward.bindHost}`);
    }

    const bindHost = normalizeLoopbackHost(forward.bindHost);

    const socksServer = socksv5.createServer((info, accept, deny) => {
      session.conn.forwardOut(info.srcAddr, info.srcPort, info.dstAddr, info.dstPort, (error: Error | undefined, stream: NodeJS.ReadWriteStream) => {
        if (error || !stream) {
          deny();
          return;
        }

        const socket = accept(true);
        if (!socket) {
          stream.end();
          return;
        }

        socket.pipe(stream as NodeJS.ReadWriteStream);
        (stream as NodeJS.ReadWriteStream).pipe(socket);
      });
    });

    socksServer.useAuth(socksv5.auth.None());

    await new Promise<void>((resolve, reject) => {
      socksServer.once("error", reject);
      socksServer.listen(forward.bindPort, bindHost, () => resolve());
    });

    session.dynamicServers.push(socksServer);
    this.sendAll(session, {
      type: "forward",
      mode: "D",
      bind: getBindAddress(socksServer),
    });
  }

  private attachRemoteForwardListener(session: Session): void {
    session.conn.on("tcp connection", (details: any, accept: () => ClientChannel, reject: () => void) => {
      const mapping = session.remoteMappings.find((candidate) => {
        if (candidate.bindPort !== details.destPort) {
          return false;
        }

        if (candidate.bindHost === details.destIP) {
          return true;
        }

        return isLoopback(candidate.bindHost) && isLoopbackAddress(details.destIP);
      });

      if (!mapping) {
        reject();
        return;
      }

      const channel = accept();
      const socket = net.createConnection(
        {
          host: mapping.targetHost,
          port: mapping.targetPort,
        },
        () => {
          channel.pipe(socket);
          socket.pipe(channel);
        },
      );

      socket.on("error", () => channel.end());
      channel.on("error", () => socket.end());
    });
  }

  async createSession(userId: string, input: CreateSessionInput): Promise<SessionSummary> {
    const parsed = parseSshCommand(input.command);

    let host = input.host ?? parsed.host;
    let port = input.port ?? parsed.port ?? 22;
    let username = input.username ?? parsed.username;
    let secretId = input.secretId;
    let password = input.password;
    let privateKey = input.privateKey;
    let passphrase = input.passphrase;

    if (input.hostId) {
      const hosts = await this.store.getHosts(userId);
      const found = hosts.find((item) => item.id === input.hostId);
      if (!found) {
        throw new Error("SSH host not found");
      }

      host = found.host;
      port = found.port;
      username = found.username;
      secretId = found.secretId ?? secretId;
    }

    if (!host || !username) {
      throw new Error("host and username are required");
    }

    if (!this.allowedHosts.has(host)) {
      throw new Error(`Host ${host} is not in SSH_ALLOWED_HOSTS`);
    }

    if (secretId) {
      if (!input.vaultToken) {
        throw new Error("vault token is required to read secretId");
      }

      const secret = await this.vault.withSecrets(input.vaultToken, userId, async (secrets) => {
        return secrets[secretId!] ?? null;
      });

      if (!secret) {
        throw new Error("secretId not found in vault");
      }

      password = password ?? secret.password;
      privateKey = privateKey ?? secret.privateKey;
      passphrase = passphrase ?? secret.passphrase;
    }

    if (!password && !privateKey) {
      throw new Error("Either password or privateKey auth is required");
    }

    if (parsed.identityFile && !privateKey) {
      privateKey = await readFile(parsed.identityFile, "utf8");
    }

    const knownHosts = await this.loadKnownHosts(userId);
    const knownFingerprint = knownHosts[host] ?? null;
    let observedFingerprint: string | null = null;
    let shouldPersistFingerprint = false;

    const conn = new Client();
    const connectConfig: ConnectConfig = {
      host,
      port,
      username,
      password,
      privateKey,
      passphrase,
      hostVerifier: (key: Buffer) => {
        observedFingerprint = toFingerprint(key);

        if (!knownFingerprint) {
          shouldPersistFingerprint = true;
          return true;
        }

        return VaultService.safeCompare(knownFingerprint, observedFingerprint);
      },
    };

    await new Promise<void>((resolve, reject) => {
      conn.once("ready", () => resolve());
      conn.once("error", reject);
      conn.connect(connectConfig);
    });

    if (!observedFingerprint) {
      conn.end();
      throw new Error("Failed to verify SSH host key fingerprint");
    }

    if (knownFingerprint && knownFingerprint !== observedFingerprint) {
      conn.end();
      throw new Error("SSH host key mismatch detected");
    }

    if (shouldPersistFingerprint) {
      knownHosts[host] = observedFingerprint;
      await this.store.putKnownHosts(userId, knownHosts);
    }

    const shell = await new Promise<ClientChannel>((resolve, reject) => {
      conn.shell(
        {
          term: "xterm-256color",
          cols: input.cols ?? 120,
          rows: input.rows ?? 40,
        },
        (error: Error | undefined, stream: ClientChannel) => {
          if (error || !stream) {
            reject(error ?? new Error("shell stream unavailable"));
            return;
          }
          resolve(stream);
        },
      );
    });

    const sessionId = randomUUID();
    const createdAt = new Date().toISOString();
    const session: Session = {
      id: sessionId,
      userId,
      host,
      port,
      username,
      createdAt,
      connected: true,
      conn,
      shell,
      localServers: [],
      dynamicServers: [],
      remoteMappings: [],
      sockets: new Set(),
    };

    this.sessions.set(sessionId, session);

    this.attachRemoteForwardListener(session);

    for (const forward of parsed.localForwards) {
      await this.setupLocalForward(session, forward);
    }

    for (const forward of parsed.remoteForwards) {
      await this.setupRemoteForward(session, forward);
    }

    for (const forward of parsed.dynamicForwards) {
      await this.setupDynamicForward(session, forward);
    }

    shell.on("data", (chunk: Buffer | string) => {
      this.sendAll(session, { type: "output", data: chunk.toString() });
    });

    shell.on("close", () => {
      this.sendAll(session, { type: "closed" });
    });

    conn.on("close", async () => {
      if (!session.connected) {
        return;
      }
      await this.closeSession(userId, sessionId);
    });

    conn.on("error", (error: Error) => {
      this.sendAll(session, { type: "error", message: error.message });
    });

    await this.logAudit({
      ts: new Date().toISOString(),
      userId,
      sessionId,
      event: "connect",
      host,
      port,
    });

    return {
      id: session.id,
      userId: session.userId,
      host: session.host,
      port: session.port,
      username: session.username,
      createdAt: session.createdAt,
      connected: session.connected,
    };
  }

  getSession(userId: string, sessionId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Session not found");
    }
    return session;
  }

  attachWebsocket(userId: string, sessionId: string, ws: Bun.ServerWebSocket<SessionSocketData>): void {
    const session = this.getSession(userId, sessionId);
    session.sockets.add(ws);
    ws.send(JSON.stringify({ type: "ready", sessionId }));
  }

  detachWebsocket(userId: string, sessionId: string, ws: Bun.ServerWebSocket<SessionSocketData>): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) {
      return;
    }

    session.sockets.delete(ws);
  }

  onWebsocketMessage(userId: string, sessionId: string, rawMessage: string | Buffer): void {
    const session = this.getSession(userId, sessionId);
    const text = rawMessage.toString();

    try {
      const parsed = JSON.parse(text) as { type?: string; data?: string; cols?: number; rows?: number };
      if (parsed.type === "input" && typeof parsed.data === "string") {
        session.shell.write(parsed.data);
        return;
      }

      if (parsed.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
        session.shell.setWindow(parsed.rows, parsed.cols, parsed.rows, parsed.cols);
        return;
      }
    } catch {
      // fall through to raw write
    }

    session.shell.write(text);
  }

  resizeSession(userId: string, sessionId: string, cols: number, rows: number): void {
    const session = this.getSession(userId, sessionId);
    session.shell.setWindow(rows, cols, rows, cols);
  }

  /** Run a single non-interactive command on the SSH connection and return output. */
  execCommand(
    userId: string,
    sessionId: string,
    command: string,
    timeoutMs = 5000,
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const session = this.getSession(userId, sessionId);
    if (!session.connected) {
      return Promise.reject(new Error("Session is not connected"));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Command timed out"));
      }, timeoutMs);

      session.conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });

        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, code: code ?? -1 });
        });

        stream.on("error", (error: Error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    });
  }

  async getTmuxSessions(userId: string, sessionId: string): Promise<TmuxStatus> {
    try {
      const { stdout, stderr, code } = await this.execCommand(
        userId,
        sessionId,
        "tmux list-sessions -F '#{session_name}\t#{session_windows}\t#{session_attached}'",
        6000,
      );
      return parseTmuxOutput(stdout, stderr, code);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return { available: false, status: "error", sessions: [], error: msg };
    }
  }

  async listDirectory(userId: string, sessionId: string, rawPath: string | null): Promise<{ path: string; resolvedPath?: string; entries: SftpEntry[]; truncated: boolean }> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);

    let resolvedPath = path;
    const lstat = await sftpLstat(sftp, path);
    if (lstat.isSymbolicLink()) {
      const resolved = await resolveSymlinkChain(sftp, path);
      resolvedPath = resolved.resolvedPath;
    }

    const stats = await sftpStat(sftp, resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error("Path is not a directory");
    }

    const list = await sftpReaddir(sftp, resolvedPath);
    const entries: SftpEntry[] = list.slice(0, MAX_LIST_ENTRIES).map((entry) => {
      const entryPath = normalizeRemotePath(pathPosix.join(resolvedPath, entry.filename));
      return {
        name: entry.filename,
        path: entryPath,
        type: statKind(entry.attrs),
        size: entry.attrs.size ?? 0,
        mtimeMs: toMtimeMs(entry.attrs),
        mode: entry.attrs.mode ?? 0,
      };
    });

    return {
      path,
      resolvedPath: resolvedPath !== path ? resolvedPath : undefined,
      entries,
      truncated: list.length > MAX_LIST_ENTRIES,
    };
  }

  async statPath(userId: string, sessionId: string, rawPath: string | null): Promise<SftpStat> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);

    const lstat = await sftpLstat(sftp, path);
    if (!lstat.isSymbolicLink()) {
      return {
        path,
        type: statKind(lstat),
        size: lstat.size ?? 0,
        mtimeMs: toMtimeMs(lstat),
        mode: lstat.mode ?? 0,
        isSymlink: false,
      };
    }

    const resolved = await resolveSymlinkChain(sftp, path);
    let resolvedStats: Stats | null = null;
    try {
      resolvedStats = await sftpStat(sftp, resolved.resolvedPath);
    } catch {
      resolvedStats = null;
    }

    const stats = resolvedStats ?? lstat;

    return {
      path,
      resolvedPath: resolved.resolvedPath,
      type: resolvedStats ? statKind(stats) : "symlink",
      size: stats.size ?? 0,
      mtimeMs: toMtimeMs(stats),
      mode: stats.mode ?? 0,
      isSymlink: true,
      target: resolved.target,
    };
  }

  async readPreview(
    userId: string,
    sessionId: string,
    rawPath: string | null,
    offset: number,
    limit: number,
  ): Promise<SftpPreview> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);

    const resolved = await resolveSymlinkChain(sftp, path);
    const stats = await sftpStat(sftp, resolved.resolvedPath);
    if (!stats.isFile()) {
      throw new Error("Path is not a file");
    }

    const size = stats.size ?? 0;
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.max(0, Math.min(limit || MAX_PREVIEW_BYTES, MAX_PREVIEW_BYTES));
    const remaining = Math.max(0, size - safeOffset);
    const length = Math.min(safeLimit, remaining);

    if (length === 0) {
      return {
        path,
        size,
        offset: safeOffset,
        limit: safeLimit,
        bytesRead: 0,
        truncated: safeOffset < size,
        kind: "text",
        encoding: "utf-8",
        data: "",
      };
    }

    const handle = await sftpOpen(sftp, resolved.resolvedPath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const bytesRead = await sftpRead(sftp, handle, buffer, 0, length, safeOffset);
      const data = buffer.subarray(0, bytesRead);
      const isText = isProbablyText(data);
      const truncated = safeOffset + bytesRead < size;

      if (!isText) {
        return {
          path,
          size,
          offset: safeOffset,
          limit: safeLimit,
          bytesRead,
          truncated,
          kind: "binary",
        };
      }

      return {
        path,
        size,
        offset: safeOffset,
        limit: safeLimit,
        bytesRead,
        truncated,
        kind: "text",
        encoding: "utf-8",
        data: data.toString("utf8"),
      };
    } finally {
      await sftpClose(sftp, handle);
    }
  }

  async createDownload(
    userId: string,
    sessionId: string,
    rawPath: string | null,
  ): Promise<SftpDownload> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);
    const resolved = await resolveSymlinkChain(sftp, path);
    const stats = await sftpStat(sftp, resolved.resolvedPath);
    if (!stats.isFile()) {
      throw new Error("Path is not a file");
    }
    const size = stats.size ?? 0;
    if (size > MAX_DOWNLOAD_BYTES) {
      throw new Error(`File exceeds download limit (${Math.round(MAX_DOWNLOAD_BYTES / (1024 * 1024))}MB)`);
    }

    const filename = pathPosix.basename(resolved.resolvedPath);
    const mimeType = guessMimeType(filename);
    const nodeStream = sftp.createReadStream(resolved.resolvedPath);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        nodeStream.on("end", () => controller.close());
        nodeStream.on("error", (error: Error) => controller.error(error));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return {
      filename,
      size,
      mimeType,
      stream,
    };
  }

  async uploadFile(userId: string, sessionId: string, rawPath: string | null, data: ArrayBuffer): Promise<{ size: number }> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);
    const buffer = Buffer.from(data);
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(`Upload exceeds limit (${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB)`);
    }

    const handle = await sftpOpen(sftp, path, "w");
    try {
      await sftpWrite(sftp, handle, buffer, 0, buffer.length, 0);
      return { size: buffer.length };
    } finally {
      await sftpClose(sftp, handle);
    }
  }

  async mkdir(userId: string, sessionId: string, rawPath: string | null): Promise<void> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(path, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async rename(userId: string, sessionId: string, fromPath: string | null, toPath: string | null): Promise<void> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const from = normalizeRemotePath(fromPath);
    const to = normalizeRemotePath(toPath);
    await new Promise<void>((resolve, reject) => {
      sftp.rename(from, to, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  async deletePath(userId: string, sessionId: string, rawPath: string | null, recursive: boolean): Promise<void> {
    const session = this.getSession(userId, sessionId);
    const sftp = await this.getSftp(session);
    const path = normalizeRemotePath(rawPath);
    await this.deletePathInternal(sftp, path, recursive, 0);
  }

  private async deletePathInternal(sftp: SFTPWrapper, path: string, recursive: boolean, depth: number): Promise<void> {
    if (depth > MAX_DELETE_DEPTH) {
      throw new Error("Delete depth exceeded");
    }

    const lstat = await sftpLstat(sftp, path);
    if (lstat.isSymbolicLink() || lstat.isFile()) {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(path, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      return;
    }

    if (lstat.isDirectory()) {
      if (!recursive) {
        await new Promise<void>((resolve, reject) => {
          sftp.rmdir(path, (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
        return;
      }

      const entries = await sftpReaddir(sftp, path);
      for (const entry of entries) {
        const child = normalizeRemotePath(pathPosix.join(path, entry.filename));
        await this.deletePathInternal(sftp, child, true, depth + 1);
      }
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(path, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      return;
    }

    throw new Error("Unsupported path type");
  }

  async closeSession(userId: string, sessionId: string): Promise<void> {
    const session = this.getSession(userId, sessionId);
    session.connected = false;

    for (const ws of session.sockets) {
      try {
        ws.send(JSON.stringify({ type: "closed" }));
        ws.close();
      } catch {
        // ignore
      }
    }

    session.sockets.clear();

    for (const server of session.localServers) {
      await closeServer(server);
    }

    for (const server of session.dynamicServers) {
      await closeServer(server);
    }

    for (const forward of session.remoteMappings) {
      await new Promise<void>((resolve) => {
        session.conn.unforwardIn(forward.bindHost, forward.bindPort, () => resolve());
      });
    }

    if (session.sftp) {
      try {
        session.sftp.end();
      } catch {
        // ignore sftp close errors
      }
    }
    session.sftp = undefined;
    session.sftpPromise = undefined;

    session.shell.end();
    session.conn.end();
    this.sessions.delete(sessionId);

    await this.logAudit({
      ts: new Date().toISOString(),
      userId,
      sessionId,
      event: "disconnect",
      host: session.host,
      port: session.port,
    });
  }

  /**
   * Run a command on the SSH host and stream stdout/stderr line-by-line to callbacks.
   * Returns the exit code when the command completes.
   */
  execStream(
    userId: string,
    sessionId: string,
    command: string,
    onStdout: (data: string) => void,
    onStderr: (data: string) => void,
    signal?: AbortSignal,
  ): Promise<number> {
    const session = this.getSession(userId, sessionId);
    if (!session.connected) {
      return Promise.reject(new Error("Session is not connected"));
    }

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("Aborted"));
        return;
      }

      session.conn.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        let closed = false;

        const onAbort = () => {
          if (!closed) {
            closed = true;
            try { stream.end(); } catch { /* ignore */ }
            resolve(-1);
          }
        };

        signal?.addEventListener("abort", onAbort);

        stream.on("data", (data: Buffer) => {
          onStdout(data.toString("utf8"));
        });

        stream.stderr.on("data", (data: Buffer) => {
          onStderr(data.toString("utf8"));
        });

        stream.on("close", (code: number | null) => {
          closed = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(code ?? -1);
        });

        stream.on("error", (error: Error) => {
          closed = true;
          signal?.removeEventListener("abort", onAbort);
          reject(error);
        });
      });
    });
  }

  /**
   * Open an interactive exec channel over SSH for a docker container shell.
   * Streams I/O through the provided WebSocket in the same base64 wire format
   * as the local Docker exec WebSocket.
   */
  async attachSshExecWebSocket(
    userId: string,
    sessionId: string,
    containerId: string,
    execSessionId: string,
    ws: Bun.ServerWebSocket<WsSessionData>,
    cols = 120,
    rows = 40,
  ): Promise<void> {
    const session = this.getSession(userId, sessionId);
    const safeId = containerId.replace(/[^a-zA-Z0-9_.-]/g, "");
    const cmd = `docker exec -it ${safeId} /bin/sh -c "(bash 2>/dev/null) || sh"`;

    try {
      const channel = await new Promise<ClientChannel>((resolve, reject) => {
        session.conn.exec(
          cmd,
          { pty: { term: "xterm-256color", rows, cols, height: rows, width: cols } } as Parameters<Client["exec"]>[1],
          (err: Error | undefined, stream: ClientChannel) => {
            if (err || !stream) {
              reject(err ?? new Error("Failed to open exec channel"));
              return;
            }
            resolve(stream);
          },
        );
      });

      this.execChannels.set(execSessionId, channel);

      ws.send(JSON.stringify({ type: "ready" }));

      channel.on("data", (chunk: Buffer) => {
        try {
          ws.send(JSON.stringify({ type: "output", data: Buffer.from(chunk).toString("base64") }));
        } catch {
          // ws might have closed
        }
      });

      channel.stderr?.on("data", (chunk: Buffer) => {
        try {
          ws.send(JSON.stringify({ type: "output", data: Buffer.from(chunk).toString("base64") }));
        } catch {
          // ws might have closed
        }
      });

      channel.on("close", () => {
        this.execChannels.delete(execSessionId);
        try {
          ws.send(JSON.stringify({ type: "closed" }));
          ws.close();
        } catch {
          // ignore
        }
      });

      channel.on("error", (err: Error) => {
        this.execChannels.delete(execSessionId);
        try {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
          ws.close();
        } catch {
          // ignore
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Exec failed";
      ws.send(JSON.stringify({ type: "error", message: msg }));
      ws.close();
    }
  }

  sendSshExecInput(execSessionId: string, data: string): void {
    const channel = this.execChannels.get(execSessionId);
    if (!channel) return;
    try {
      channel.write(data);
    } catch {
      // ignore write errors
    }
  }

  resizeSshExecTerminal(execSessionId: string, cols: number, rows: number): void {
    const channel = this.execChannels.get(execSessionId);
    if (!channel) return;
    try {
      channel.setWindow(rows, cols, rows, cols);
    } catch {
      // ignore resize errors
    }
  }

  detachSshExecWebSocket(execSessionId: string): void {
    const channel = this.execChannels.get(execSessionId);
    if (channel) {
      try {
        channel.end();
      } catch {
        // ignore
      }
      this.execChannels.delete(execSessionId);
    }
  }
}
