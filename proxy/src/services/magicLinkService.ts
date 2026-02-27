import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "../config";
import type { MagicLinkRecord, MinioStore } from "../storage/minioStore";

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function createToken(): string {
  const entropy = randomBytes(24).toString("hex");
  return `${Date.now().toString(36)}.${entropy}`;
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string): Promise<void> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Telegram send failed (${response.status}): ${payload}`);
  }

  const data = (await response.json()) as { ok?: boolean };
  if (!data.ok) {
    throw new Error("Telegram send failed");
  }
}

export class MagicLinkService {
  constructor(private readonly store: MinioStore, private readonly config: AppConfig) {}

  normalizeEmail(email: string): string {
    return normalizeEmail(email);
  }

  async getUserEmail(userId: string): Promise<{ email: string | null; updatedAt?: string }> {
    const profile = await this.store.getUserProfile(userId);
    if (!profile?.email) {
      return { email: null, updatedAt: profile?.updatedAt };
    }
    return {
      email: profile.email,
      updatedAt: profile.updatedAt,
    };
  }

  async setUserEmail(userId: string, email: string): Promise<{ email: string; updatedAt: string }> {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes("@")) {
      throw new Error("Valid email is required");
    }

    const profile = await this.store.getUserProfile(userId);
    const existingNormalized = profile?.emailNormalized;

    const index = await this.store.getEmailIndex();
    const linkedUserId = index[normalized];
    if (linkedUserId && linkedUserId !== userId) {
      throw new Error("Email is already linked to another account");
    }

    if (existingNormalized && existingNormalized !== normalized) {
      delete index[existingNormalized];
    }

    index[normalized] = userId;

    const updatedAt = new Date().toISOString();
    await this.store.putUserProfile(userId, {
      ...profile,
      email,
      emailNormalized: normalized,
      emailVerifiedAt: updatedAt,
      updatedAt,
    });
    await this.store.putEmailIndex(index);

    return { email, updatedAt };
  }

  async sendMagicLinkToTelegram(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    if (!normalized || !normalized.includes("@")) {
      throw new Error("Valid email is required");
    }

    const userId = (await this.store.getEmailIndex())[normalized];
    if (!userId) {
      // Intentionally silent to prevent email enumeration.
      return;
    }

    const botToken = this.config.telegram.botToken;
    if (!botToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }

    const token = createToken();
    const tokenHash = hashToken(token);

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + MAGIC_LINK_TTL_MS);

    const record: MagicLinkRecord = {
      userId,
      emailNormalized: normalized,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await this.store.putMagicLink(tokenHash, record);

    const base = this.config.appOrigin.replace(/\/$/, "");
    const link = `${base}/?magicToken=${encodeURIComponent(token)}`;

    const text = [
      "🔐 Daedalus sign-in link",
      "",
      "Tap to sign in on web:",
      link,
      "",
      "This link expires in 15 minutes and can only be used once.",
      "If you didn’t request this, ignore this message.",
    ].join("\n");

    await sendTelegramMessage(botToken, userId, text);
  }

  async verifyMagicLink(token: string): Promise<{ userId: string }> {
    if (!token || token.length < 24) {
      throw new Error("Invalid magic link token");
    }

    const tokenHash = hashToken(token);
    const record = await this.store.getMagicLink(tokenHash);
    if (!record) {
      throw new Error("Magic link is invalid or expired");
    }

    if (record.usedAt) {
      throw new Error("Magic link already used");
    }

    if (Date.now() > Date.parse(record.expiresAt)) {
      throw new Error("Magic link has expired");
    }

    await this.store.putMagicLink(tokenHash, {
      ...record,
      usedAt: new Date().toISOString(),
    });

    return { userId: record.userId };
  }
}
