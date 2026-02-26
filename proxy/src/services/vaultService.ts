import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import * as bip39 from "bip39";
import type { EncryptedBlob, StoredSecret, StoredVault } from "../storage/minioStore";
import { MinioStore } from "../storage/minioStore";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

type UnlockSession = {
  userId: string;
  masterKey: Buffer;
  lastActivityAt: number;
};

type VaultSecretsBlob = {
  version: 1;
  values: Record<string, StoredSecret>;
};

function encryptWithPassword(secret: Buffer, password: string): EncryptedBlob {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decryptWithPassword(blob: EncryptedBlob, password: string): Buffer {
  const salt = Buffer.from(blob.salt, "base64");
  const nonce = Buffer.from(blob.nonce, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const key = scryptSync(password, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function encryptWithMasterKey(plaintext: Buffer, masterKey: Buffer): EncryptedBlob {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    salt: "",
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

function decryptWithMasterKey(blob: EncryptedBlob, masterKey: Buffer): Buffer {
  const nonce = Buffer.from(blob.nonce, "base64");
  const ciphertext = Buffer.from(blob.ciphertext, "base64");
  const authTag = Buffer.from(blob.authTag, "base64");
  const decipher = createDecipheriv("aes-256-gcm", masterKey, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function defaultSecretsBlob(): VaultSecretsBlob {
  return {
    version: 1,
    values: {},
  };
}

export class VaultService {
  private readonly unlockSessions = new Map<string, UnlockSession>();

  constructor(
    private readonly store: MinioStore,
    private readonly idleTimeoutMs: number,
  ) {}

  private createUnlockToken(userId: string, masterKey: Buffer): string {
    const token = randomBytes(32).toString("hex");
    this.unlockSessions.set(token, {
      userId,
      masterKey,
      lastActivityAt: Date.now(),
    });
    return token;
  }

  private touch(token: string): UnlockSession {
    const session = this.unlockSessions.get(token);
    if (!session) {
      throw new Error("Invalid vault token");
    }

    if (Date.now() - session.lastActivityAt > this.idleTimeoutMs) {
      this.unlockSessions.delete(token);
      throw new Error("Vault token expired due to inactivity");
    }

    session.lastActivityAt = Date.now();
    return session;
  }

  async status(userId: string): Promise<{ initialized: boolean; unlocked: boolean }> {
    const vault = await this.store.getVault(userId);
    let unlocked = false;

    for (const session of this.unlockSessions.values()) {
      if (session.userId === userId && Date.now() - session.lastActivityAt <= this.idleTimeoutMs) {
        unlocked = true;
        break;
      }
    }

    return {
      initialized: Boolean(vault),
      unlocked,
    };
  }

  async init(userId: string, passphrase: string, recoveryPhrase?: string): Promise<{ recoveryPhrase: string }> {
    if (!passphrase) {
      throw new Error("Passphrase is required");
    }

    const existing = await this.store.getVault(userId);
    if (existing) {
      throw new Error("Vault already initialized");
    }

    const phrase = recoveryPhrase ?? bip39.generateMnemonic(256);
    const masterKey = randomBytes(32);
    const passphraseWrapper = encryptWithPassword(masterKey, passphrase);
    const recoveryWrapper = encryptWithPassword(masterKey, phrase);
    const encryptedSecrets = encryptWithMasterKey(
      Buffer.from(textEncoder.encode(JSON.stringify(defaultSecretsBlob()))),
      masterKey,
    );

    const now = new Date().toISOString();
    const vault: StoredVault = {
      version: 1,
      passphraseWrapper,
      recoveryWrapper,
      encryptedSecrets,
      createdAt: now,
      updatedAt: now,
    };

    await this.store.putVault(userId, vault);

    return { recoveryPhrase: phrase };
  }

  async unlockWithPassphrase(userId: string, passphrase: string): Promise<{ token: string; ttlMs: number }> {
    const vault = await this.store.getVault(userId);
    if (!vault) {
      throw new Error("Vault is not initialized");
    }

    const masterKey = decryptWithPassword(vault.passphraseWrapper, passphrase);
    const token = this.createUnlockToken(userId, masterKey);
    return { token, ttlMs: this.idleTimeoutMs };
  }

  async lock(token: string): Promise<void> {
    this.unlockSessions.delete(token);
  }

  async recover(
    userId: string,
    recoveryPhrase: string,
    newPassphrase: string,
    nextRecoveryPhrase?: string,
  ): Promise<{ recoveryPhrase: string; token: string; ttlMs: number }> {
    const vault = await this.store.getVault(userId);
    if (!vault) {
      throw new Error("Vault is not initialized");
    }

    if (!newPassphrase) {
      throw new Error("newPassphrase is required");
    }

    const masterKey = decryptWithPassword(vault.recoveryWrapper, recoveryPhrase);
    const replacementRecoveryPhrase = nextRecoveryPhrase ?? bip39.generateMnemonic(256);

    vault.passphraseWrapper = encryptWithPassword(masterKey, newPassphrase);
    vault.recoveryWrapper = encryptWithPassword(masterKey, replacementRecoveryPhrase);
    vault.updatedAt = new Date().toISOString();

    await this.store.putVault(userId, vault);

    const token = this.createUnlockToken(userId, masterKey);
    return {
      recoveryPhrase: replacementRecoveryPhrase,
      token,
      ttlMs: this.idleTimeoutMs,
    };
  }

  async withSecrets<T>(token: string, userId: string, run: (secrets: Record<string, StoredSecret>) => Promise<T>): Promise<T> {
    const session = this.touch(token);
    if (session.userId !== userId) {
      throw new Error("Vault token user mismatch");
    }

    const vault = await this.store.getVault(userId);
    if (!vault) {
      throw new Error("Vault is not initialized");
    }

    const decrypted = decryptWithMasterKey(vault.encryptedSecrets, session.masterKey);
    const parsed = JSON.parse(textDecoder.decode(decrypted)) as VaultSecretsBlob;

    if (parsed.version !== 1 || typeof parsed.values !== "object") {
      throw new Error("Invalid secrets blob");
    }

    const output = await run(parsed.values);

    const nextBlob: VaultSecretsBlob = {
      version: 1,
      values: parsed.values,
    };
    vault.encryptedSecrets = encryptWithMasterKey(
      Buffer.from(textEncoder.encode(JSON.stringify(nextBlob))),
      session.masterKey,
    );
    vault.updatedAt = new Date().toISOString();
    await this.store.putVault(userId, vault);

    return output;
  }

  static safeCompare(a: string, b: string): boolean {
    const aa = Buffer.from(a);
    const bb = Buffer.from(b);
    if (aa.length !== bb.length) {
      return false;
    }
    return timingSafeEqual(aa, bb);
  }
}
