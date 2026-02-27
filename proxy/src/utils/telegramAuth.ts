/**
 * Telegram WebApp initData verification.
 * Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
import { createHmac } from "node:crypto";

export type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramInitDataResult =
  | { ok: true; userId: string; user: TelegramUser }
  | { ok: false; reason: string };

/**
 * Verifies the Telegram WebApp initData string using HMAC-SHA256.
 * Returns the verified userId on success, or an error reason on failure.
 *
 * @param initData - The raw `window.Telegram.WebApp.initData` string from the browser
 * @param botToken - The Telegram bot token used to derive the secret key
 */
export function verifyTelegramInitData(
  initData: string,
  botToken: string,
): TelegramInitDataResult {
  if (!initData) {
    return { ok: false, reason: "initData is empty" };
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) {
    return { ok: false, reason: "hash missing from initData" };
  }

  // Build the data-check string: alphabetically sorted key=value pairs (excluding hash), joined by \n
  const dataCheckArr: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      dataCheckArr.push(`${key}=${value}`);
    }
  }
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join("\n");

  // secret_key = HMAC-SHA256(bot_token, "WebAppData")
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  // expected_hash = HMAC-SHA256(data_check_string, secret_key)
  const expectedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (expectedHash !== receivedHash) {
    return { ok: false, reason: "hash mismatch" };
  }

  // Check expiry: auth_date must be within 1 hour
  const authDateStr = params.get("auth_date");
  if (authDateStr) {
    const authDate = Number(authDateStr) * 1000;
    const now = Date.now();
    if (now - authDate > 60 * 60 * 1000) {
      return { ok: false, reason: "initData expired" };
    }
  }

  // Parse user
  const userStr = params.get("user");
  if (!userStr) {
    return { ok: false, reason: "user field missing" };
  }

  let user: TelegramUser;
  try {
    user = JSON.parse(userStr) as TelegramUser;
  } catch {
    return { ok: false, reason: "user field is not valid JSON" };
  }

  if (!user.id) {
    return { ok: false, reason: "user.id missing" };
  }

  return { ok: true, userId: String(user.id), user };
}
