import type { ChatMessageRow, LlmMessage, TelegramMessage } from "./types.js";
import { asChatType } from "./addressing.js";

export const HISTORY_LIMIT = 16;

export function sessionKeyForMessage(message: TelegramMessage | undefined): string {
  const type = asChatType(String(message?.chat?.type || ""));
  switch (type) {
    case "private":
      return String(message?.from?.id || message?.chat?.id || "");
    case "group":
    case "supergroup":
      return String(message?.chat?.id || "");
    case "channel":
    case "unknown":
      return String(message?.chat?.id || "");
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export function toLlmMessages(rows: ChatMessageRow[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const row of rows) {
    const role = String(row.role || "");
    const content = String(row.content || "").trim();
    if (!content) continue;
    if (role === "user" || role === "assistant") {
      out.push({ role, content });
    }
  }
  return out;
}

export async function loadChatHistory(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  botId: string;
  sessionId: string;
  limit?: number;
}): Promise<ChatMessageRow[]> {
  const { supabaseUrl, serviceRoleKey, botId, sessionId, limit = HISTORY_LIMIT } = opts;
  if (!supabaseUrl || !serviceRoleKey || !botId || !sessionId) return [];
  const url = new URL("/rest/v1/chat_messages", supabaseUrl);
  url.searchParams.set("select", "role,content,created_at");
  url.searchParams.set("bot_id", `eq.${botId}`);
  url.searchParams.set("session_id", `eq.${sessionId}`);
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", String(limit));
  try {
    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    if (!res.ok) return [];
    const rows = (await res.json().catch(() => null)) as ChatMessageRow[] | null;
    if (!Array.isArray(rows)) return [];
    return rows.reverse();
  } catch {
    return [];
  }
}
