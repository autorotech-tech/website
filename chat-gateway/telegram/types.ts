export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type BotRole = "support" | "sales";

export type ChatAgentRow = {
  id: string;
  status: string;
  default_lang: string;
  data_region: string;
  n8n_webhook_url: string;
  telegram_bot_token: string;
  bot_role: BotRole;
};

export type BotIdentity = {
  id: string;
  username: string;
};

export type TelegramUser = {
  id?: number | string;
  is_bot?: boolean;
  username?: string;
  language_code?: string;
};

export type TelegramEntity = {
  type?: string;
  offset?: number;
  length?: number;
  user?: TelegramUser;
};

export type TelegramChat = {
  id?: number | string;
  type?: string;
};

export type TelegramMessage = {
  message_id?: number;
  text?: string;
  caption?: string;
  chat?: TelegramChat;
  from?: TelegramUser;
  entities?: TelegramEntity[];
  caption_entities?: TelegramEntity[];
  reply_to_message?: TelegramMessage;
};

export type TelegramUpdate = {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export type ChatMessageRow = {
  role: string;
  content: string;
  created_at?: string;
};

export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type RagChunk = {
  content: string;
  source?: string;
  similarity?: number;
};

export type RagResult = {
  chunks: RagChunk[];
  degraded: boolean;
  source: "pquoc" | "pgvector" | "chroma" | "empty" | "mock";
};

export type TelegramPayload = {
  bot_id: string;
  session_id: string;
  session: string;
  message: string;
  text: string;
  chat_id: string;
  telegram_chat_id: string;
  platform: "telegram";
  lang: string;
  detected_language: string;
  reply_to_text: string;
  reply_to_message: TelegramMessage | null;
  message_id: number | undefined;
  received_at: string;
};

export type GatewayHooks = {
  getChatAgent: (botId: string) => Promise<ChatAgentRow | null>;
  patchChatAgent?: (botId: string, fields: Record<string, string | null>) => Promise<boolean>;
  insertChatMessage: (row: {
    botId: string;
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: string;
    platform: string;
  }) => Promise<boolean>;
  isPquocRagBot: (botId: string) => boolean;
  forwardToPquocInternal: (payload: TelegramPayload) => Promise<{
    ok: boolean;
    data?: { reply?: string };
  }>;
  forwardToN8n: (webhookUrl: string, payload: TelegramPayload) => Promise<unknown>;
  fixBrokenPquocUrls: (text: string, lang: string) => string;
  n8nWebhookUrlDefault: string;
  widgetPublicUrl: string;
  telegramWebhookSecret: string;
};

export type HttpText = (
  res: import("node:http").ServerResponse,
  status: number,
  body: string,
  extraHeaders?: Record<string, string>,
) => void;

export type HttpJson = (
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) => void;
