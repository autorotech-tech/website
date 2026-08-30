import type { BotIdentity, TelegramChatType, TelegramEntity, TelegramMessage } from "./types.js";

export const DEFAULT_BOT_USERNAMES = ["AskPQuoc_bot", "AskPQuoc"];

export function escapeRegExp(s: string): string {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeBotUsername(raw: unknown): string {
  return String(raw || "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
}

export function botUsernameSet(bot: BotIdentity | null | undefined, extraAliases: string[] = []): Set<string> {
  const names = new Set<string>();
  const own = normalizeBotUsername(bot?.username);
  if (own) names.add(own);
  const aliases =
    own === "askpquoc_bot" || own === "askpquoc" ? [...DEFAULT_BOT_USERNAMES, ...extraAliases] : extraAliases;
  for (const u of aliases) {
    const n = normalizeBotUsername(u);
    if (n) names.add(n);
  }
  return names;
}

export function entityFragment(text: string, entity: TelegramEntity | undefined): string {
  const start = Number(entity?.offset) || 0;
  const len = Number(entity?.length) || 0;
  return String(text || "").substring(start, start + len);
}

export function asChatType(raw: string): TelegramChatType | "unknown" {
  switch (raw) {
    case "private":
    case "group":
    case "supergroup":
    case "channel":
      return raw;
    default:
      return "unknown";
  }
}

/** Group/supergroup: reply only if @mentioned, /cmd@bot, or reply-to-bot. Private: always. Channel: never. */
export function isAddressedToBot(
  message: TelegramMessage | undefined,
  bot: BotIdentity | null | undefined,
  extraAliases: string[] = [],
): boolean {
  const usernames = botUsernameSet(bot, extraAliases);
  const botId = bot?.id != null ? String(bot.id) : "";
  const text = String(message?.text || message?.caption || "");

  for (const u of usernames) {
    const re = new RegExp(`(^|[^\\w])@${escapeRegExp(u)}\\b`, "i");
    if (re.test(text)) return true;
  }

  const entities = [...(message?.entities || []), ...(message?.caption_entities || [])];
  for (const e of entities) {
    const type = String(e?.type || "");
    if (type === "mention") {
      const frag = normalizeBotUsername(entityFragment(text, e));
      if (usernames.has(frag)) return true;
    }
    if (type === "text_mention" && e.user) {
      if (botId && String(e.user.id) === botId) return true;
      if (usernames.has(normalizeBotUsername(e.user.username))) return true;
    }
    if (type === "bot_command") {
      const cmd = entityFragment(text, e);
      const at = cmd.match(/^\/\w+@([A-Za-z0-9_]+)/);
      if (at && usernames.has(normalizeBotUsername(at[1]))) return true;
    }
  }

  const replyFrom = message?.reply_to_message?.from;
  if (replyFrom?.is_bot) {
    if (botId && String(replyFrom.id) === botId) return true;
    if (usernames.has(normalizeBotUsername(replyFrom.username))) return true;
  }

  return false;
}

export function shouldReplyToTelegramMessage(
  message: TelegramMessage | undefined,
  bot: BotIdentity | null | undefined,
  extraAliases: string[] = [],
): boolean {
  const type = asChatType(String(message?.chat?.type || ""));
  switch (type) {
    case "private":
      return true;
    case "group":
    case "supergroup":
      return isAddressedToBot(message, bot, extraAliases);
    case "channel":
    case "unknown":
      return false;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function stripBotMentions(
  text: string,
  bot: BotIdentity | null | undefined,
  extraAliases: string[] = [],
): string {
  let out = String(text || "");
  for (const u of botUsernameSet(bot, extraAliases)) {
    out = out.replace(new RegExp(`@${escapeRegExp(u)}\\b`, "ig"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}
