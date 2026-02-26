import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import { Client, type ClientChannel, type ConnectConfig } from "ssh2";
import socksv5 from "socksv5";
import { MinioStore, type AuditEvent, type KnownHostsMap, type StoredSecret } from "../storage/minioStore";
import { VaultService } from "./vaultService";
import {
  parseSshCommand,
  type DynamicForward,
  type LocalForward,
  type RemoteForward,
} from "../utils/sshCommandParser";

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

function toFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64")}`;
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function isLoopback(bindHost: string): boolean {
  return bindHost === "127.0.0.1";
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

export class SshService {
  private readonly sessions = new Map<string, Session>();

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

  private async setupLocalForward(session: Session, forward: LocalForward): Promise<void> {
    if (!isLoopback(forward.bindHost)) {
      throw new Error(`Local forward bind host must be 127.0.0.1, got ${forward.bindHost}`);
    }

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
      server.listen(forward.bindPort, forward.bindHost, () => resolve());
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
    await new Promise<void>((resolve, reject) => {
      session.conn.forwardIn(forward.bindHost, forward.bindPort, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    session.remoteMappings.push(forward);
    this.sendAll(session, {
      type: "forward",
      mode: "R",
      bind: `${forward.bindHost}:${forward.bindPort}`,
      target: `${forward.targetHost}:${forward.targetPort}`,
    });
  }

  private async setupDynamicForward(session: Session, forward: DynamicForward): Promise<void> {
    if (!isLoopback(forward.bindHost)) {
      throw new Error(`Dynamic forward bind host must be 127.0.0.1, got ${forward.bindHost}`);
    }

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
      socksServer.listen(forward.bindPort, forward.bindHost, () => resolve());
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

        return candidate.bindHost === details.destIP || candidate.bindHost === "0.0.0.0";
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
}
