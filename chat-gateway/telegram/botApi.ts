import { createHmac } from "node:crypto";
import type { BotIdentity } from "./types.js";

const TELEGRAM_TEXT_LIMIT = 4096;
const BOT_IDENTITY_TTL_MS = 6 * 60 * 60 * 1000;

const botIdentityCache = new Map<string, { id: string; username: string; at: number }>();

async function telegramApi<T>(botToken: string, method: string, body?: unknown): Promise<{ ok: boolean; result?: T; description?: string }> {
  const url = `https://api.telegram.org/bot${botToken}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!data) return { ok: false, description: `telegram_${method}_invalid_json` };
  return { ok: Boolean(data.ok), result: data.result, description: data.description };
}

export async function getTelegramBotIdentity(botToken: string, fallbackUsername = ""): Promise<BotIdentity> {
  const fallback: BotIdentity = { id: "", username: fallbackUsername };
  if (!botToken) return fallback;
  const cached = botIdentityCache.get(botToken);
  if (cached && Date.now() - cached.at < BOT_IDENTITY_TTL_MS) {
    return { id: cached.id, username: cached.username };
  }
  try {
    const data = await telegramApi<{ id?: number; username?: string }>(botToken, "getMe", {});
    if (data.ok && data.result) {
      const ident = {
        id: String(data.result.id || ""),
        username: String(data.result.username || fallback.username),
        at: Date.now(),
      };
      botIdentityCache.set(botToken, ident);
      return { id: ident.id, username: ident.username };
    }
  } catch {
    // keep fallback aliases
  }
  return fallback;
}

export async function sendChatAction(botToken: string, chatId: string, action = "typing"): Promise<boolean> {
  if (!botToken || !chatId) return false;
  try {
    const data = await telegramApi(botToken, "sendChatAction", { chat_id: chatId, action });
    return data.ok;
  } catch {
    return false;
  }
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  options?: { retry?: boolean },
): Promise<boolean> {
  if (!botToken || !chatId || !text) return false;
  const trimmed = text.length > TELEGRAM_TEXT_LIMIT ? text.slice(0, TELEGRAM_TEXT_LIMIT) : text;
  const payload = {
    chat_id: chatId,
    text: trimmed,
    disable_web_page_preview: true,
  };
  try {
    const first = await telegramApi(botToken, "sendMessage", payload);
    if (first.ok) return true;
    if (options?.retry === false) return false;
    await new Promise((r) => setTimeout(r, 400));
    const second = await telegramApi(botToken, "sendMessage", payload);
    return second.ok;
  } catch {
    if (options?.retry === false) return false;
    try {
      await new Promise((r) => setTimeout(r, 400));
      const second = await telegramApi(botToken, "sendMessage", payload);
      return second.ok;
    } catch {
      return false;
    }
  }
}

export async function getTelegramWebhookInfo(
  botToken: string,
): Promise<{ ok: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string }; description?: string }> {
  if (!botToken) return { ok: false, description: "missing_token" };
  try {
    return await telegramApi(botToken, "getWebhookInfo", {});
  } catch (e) {
    return { ok: false, description: String((e as Error)?.message || e) };
  }
}

export async function setTelegramWebhook(
  botToken: string,
  url: string,
  secretToken?: string,
): Promise<{ ok: boolean; description?: string }> {
  if (!botToken || !url) return { ok: false, description: "missing_token_or_url" };
  const body: Record<string, unknown> = {
    url,
    allowed_updates: ["message", "edited_message"],
    drop_pending_updates: false,
  };
  if (secretToken) body.secret_token = secretToken;
  try {
    return await telegramApi(botToken, "setWebhook", body);
  } catch (e) {
    return { ok: false, description: String((e as Error)?.message || e) };
  }
}

export function webhookSecretForBot(botId: string, masterSecret: string): string {
  if (!masterSecret || !botId) return "";
  return createHmac("sha256", masterSecret).update(botId).digest("hex");
}
