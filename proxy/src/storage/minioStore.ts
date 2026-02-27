import { Client as MinioClient } from "minio";
import { Readable } from "node:stream";
import type { AppConfig } from "../config";
import type { TmuxBind } from "../types/tmuxBind";

export type StoredVault = {
  version: 1;
  passphraseWrapper: EncryptedBlob;
  recoveryWrapper: EncryptedBlob;
  encryptedSecrets: EncryptedBlob;
  createdAt: string;
  updatedAt: string;
};

export type EncryptedBlob = {
  salt: string;
  nonce: string;
  ciphertext: string;
  authTag: string;
};

export type StoredSecret = {
  password?: string;
  privateKey?: string;
  passphrase?: string;
};

export type StoredHost = {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  secretId?: string;
  createdAt: string;
  updatedAt: string;
};

export type KnownHostsMap = Record<string, string>;

export type AuditEvent = {
  ts: string;
  userId: string;
  sessionId: string;
  event: "connect" | "disconnect";
  host: string;
  port: number;
};

export type ClientLogEvent = {
  ts: string;
  userId: string;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  message: string;
  meta?: Record<string, unknown>;
};

export type UserProfile = {
  email?: string;
  emailNormalized?: string;
  emailVerifiedAt?: string;
  updatedAt: string;
};

export type EmailIndex = Record<string, string>;

export type MagicLinkRecord = {
  userId: string;
  emailNormalized: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function streamToText(stream: Readable): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? textEncoder.encode(chunk) : chunk);
  }

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);

  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }

  return textDecoder.decode(out);
}

export class MinioStore {
  private readonly client: MinioClient;
  private readonly bucket: string;

  constructor(config: AppConfig["minio"]) {
    this.client = new MinioClient({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucket = config.bucket;
  }

  async init(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket, "us-east-1");
    }
  }

  async getJson<T>(key: string): Promise<T | null> {
    try {
      const stream = await this.client.getObject(this.bucket, key);
      const raw = await streamToText(stream as Readable);
      return JSON.parse(raw) as T;
    } catch (error: unknown) {
      if (isObjectNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async putJson(key: string, value: unknown): Promise<void> {
    const payload = JSON.stringify(value);
    const bytes = Buffer.from(payload, "utf8");
    await this.client.putObject(this.bucket, key, bytes, bytes.length, {
      "Content-Type": "application/json",
    });
  }

  userVaultKey(userId: string): string {
    return `users/${encodeURIComponent(userId)}/vault.json`;
  }

  userHostsKey(userId: string): string {
    return `users/${encodeURIComponent(userId)}/ssh-hosts.json`;
  }

  userKnownHostsKey(userId: string): string {
    return `users/${encodeURIComponent(userId)}/known-hosts.json`;
  }

  userProfileKey(userId: string): string {
    return `users/${encodeURIComponent(userId)}/profile.json`;
  }

  emailIndexKey(): string {
    return "auth/email-index.json";
  }

  magicLinkKey(tokenHash: string): string {
    return `auth/magic-links/${tokenHash}.json`;
  }

  async getVault(userId: string): Promise<StoredVault | null> {
    return this.getJson<StoredVault>(this.userVaultKey(userId));
  }

  async putVault(userId: string, vault: StoredVault): Promise<void> {
    await this.putJson(this.userVaultKey(userId), vault);
  }

  async getHosts(userId: string): Promise<StoredHost[]> {
    return (await this.getJson<StoredHost[]>(this.userHostsKey(userId))) ?? [];
  }

  async putHosts(userId: string, hosts: StoredHost[]): Promise<void> {
    await this.putJson(this.userHostsKey(userId), hosts);
  }

  async getKnownHosts(userId: string): Promise<KnownHostsMap> {
    return (await this.getJson<KnownHostsMap>(this.userKnownHostsKey(userId))) ?? {};
  }

  async putKnownHosts(userId: string, knownHosts: KnownHostsMap): Promise<void> {
    await this.putJson(this.userKnownHostsKey(userId), knownHosts);
  }

  async getUserProfile(userId: string): Promise<UserProfile | null> {
    return this.getJson<UserProfile>(this.userProfileKey(userId));
  }

  async putUserProfile(userId: string, profile: UserProfile): Promise<void> {
    await this.putJson(this.userProfileKey(userId), profile);
  }

  async getEmailIndex(): Promise<EmailIndex> {
    return (await this.getJson<EmailIndex>(this.emailIndexKey())) ?? {};
  }

  async putEmailIndex(index: EmailIndex): Promise<void> {
    await this.putJson(this.emailIndexKey(), index);
  }

  async getMagicLink(tokenHash: string): Promise<MagicLinkRecord | null> {
    return this.getJson<MagicLinkRecord>(this.magicLinkKey(tokenHash));
  }

  async putMagicLink(tokenHash: string, record: MagicLinkRecord): Promise<void> {
    await this.putJson(this.magicLinkKey(tokenHash), record);
  }

  async appendAuditEvent(event: AuditEvent): Promise<void> {
    const day = event.ts.slice(0, 10);
    const key = `audit/${day}.jsonl`;
    await this.appendJsonLine(key, event);
  }

  tmuxBindsKey(userId: string): string {
    return `users/${encodeURIComponent(userId)}/tmux-binds.json`;
  }

  async getTmuxBinds(userId: string): Promise<TmuxBind[]> {
    return (await this.getJson<TmuxBind[]>(this.tmuxBindsKey(userId))) ?? [];
  }

  async putTmuxBinds(userId: string, binds: TmuxBind[]): Promise<void> {
    await this.putJson(this.tmuxBindsKey(userId), binds);
  }

  async appendClientLogEvent(event: ClientLogEvent): Promise<void> {
    const day = event.ts.slice(0, 10);
    const key = `users/${encodeURIComponent(event.userId)}/client-logs/${day}.jsonl`;
    await this.appendJsonLine(key, event);
  }

  private async appendJsonLine(key: string, event: unknown): Promise<void> {
    let existing = "";

    try {
      const stream = await this.client.getObject(this.bucket, key);
      existing = await streamToText(stream as Readable);
    } catch (error: unknown) {
      if (!isObjectNotFound(error)) {
        throw error;
      }
    }

    const line = `${JSON.stringify(event)}\n`;
    const bytes = Buffer.from(existing + line, "utf8");
    await this.client.putObject(this.bucket, key, bytes, bytes.length, {
      "Content-Type": "application/x-ndjson",
    });
  }
}

function isObjectNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeCode = (error as { code?: string }).code;
  return maybeCode === "NoSuchKey" || maybeCode === "NotFound" || maybeCode === "NoSuchObject";
}
