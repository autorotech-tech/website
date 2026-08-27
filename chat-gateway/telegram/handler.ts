import type { IncomingMessage, ServerResponse } from "node:http";
import { shouldReplyToTelegramMessage, stripBotMentions } from "./addressing.js";
import { getTelegramBotIdentity, getTelegramWebhookInfo, sendChatAction, sendTelegramMessage, setTelegramWebhook, webhookSecretForBot } from "./botApi.js";
import { loadChatHistory, sessionKeyForMessage, toLlmMessages } from "./history.js";
import { completeChat } from "./llm.js";
import { buildTenantSystemPrompt, classifyIntent, fallbackReply, resolveRolePrompt } from "./prompt.js";
import { formatKnowledgeBlock, getRagContext } from "./rag.js";
import type { GatewayHooks, HttpJson, HttpText, TelegramPayload, TelegramUpdate } from "./types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBotIdFromPath(pathname: string): string {
  const webhook = pathname.match(/^\/v1\/telegram\/webhook\/([^/]+)\/?$/);
  if (webhook && UUID_RE.test(webhook[1])) return webhook[1];
  const setup = pathname.match(/^\/v1\/telegram\/setup\/([^/]+)\/?$/);
  if (setup && UUID_RE.test(setup[1])) return setup[1];
  const status = pathname.match(/^\/v1\/telegram\/status\/([^/]+)\/?$/);
  if (status && UUID_RE.test(status[1])) return status[1];
  return "";
}

function safeParseJson(raw: string): TelegramUpdate | null {
  try {
    return JSON.parse(raw) as TelegramUpdate;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage, limitBytes = 256_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(Object.assign(new Error("Body too large"), { code: "BODY_TOO_LARGE" }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function secretHeader(req: IncomingMessage): string {
  const h = req.headers["x-telegram-bot-api-secret-token"];
  return Array.isArray(h) ? String(h[0] || "") : String(h || "");
}

export function createTelegramAdapter(hooks: GatewayHooks, http: { text: HttpText; json: HttpJson }) {
  async function handleWebhook(req: IncomingMessage, res: ServerResponse, botId: string): Promise<void> {
    if (!botId) {
      http.text(res, 400, "Missing bot_id");
      return;
    }

    const rawBody = await readBody(req).catch((e: { code?: string }) => {
      if (e?.code === "BODY_TOO_LARGE") return null;
      return "";
    });
    if (rawBody === null) {
      http.text(res, 413, "Body too large");
      return;
    }

    const body = safeParseJson(rawBody || "");
    if (!body) {
      http.text(res, 400, "Invalid JSON");
      return;
    }

    http.text(res, 200, "OK");

    processUpdate(botId, req, body).catch((err) => {
      console.error("telegram webhook process error", err);
    });
  }

  async function processUpdate(botId: string, req: IncomingMessage, body: TelegramUpdate): Promise<void> {
    const message = body.message || body.edited_message;
    const text = String(message?.text || message?.caption || "").trim();
    if (!message || !text) return;

    const agent = await hooks.getChatAgent(botId);
    if (!agent || (agent.status && agent.status !== "active")) return;

    if (hooks.telegramWebhookSecret) {
      const expected = webhookSecretForBot(botId, hooks.telegramWebhookSecret);
      const got = secretHeader(req);
      if (got && expected && got !== expected) return;
    }

    const extraAliases = hooks.isPquocRagBot(botId) ? ["AskPQuoc_bot", "AskPQuoc"] : [];
    const botIdent = await getTelegramBotIdentity(agent.telegram_bot_token || "");
    const sessionId = sessionKeyForMessage(message);
    const chatId = String(message.chat?.id || "");
    const lang = String(message.from?.language_code || agent.default_lang || "en").slice(0, 12);
    const query = stripBotMentions(text, botIdent, extraAliases) || text;

    await hooks.insertChatMessage({
      botId,
      sessionId,
      role: "user",
      content: text,
      platform: "telegram",
    });

    if (!shouldReplyToTelegramMessage(message, botIdent, extraAliases)) return;
    if (!chatId) return;

    const payload: TelegramPayload = {
      bot_id: botId,
      session_id: sessionId,
      session: sessionId,
      message: query,
      text: query,
      chat_id: chatId,
      telegram_chat_id: chatId,
      platform: "telegram",
      lang,
      detected_language: lang.slice(0, 2),
      reply_to_text: String(message.reply_to_message?.text || "").slice(0, 4000),
      reply_to_message: message.reply_to_message || null,
      message_id: message.message_id,
      received_at: new Date().toISOString(),
    };

    const token = agent.telegram_bot_token || "";
    if (token) {
      await sendChatAction(token, chatId, "typing");
    }

    // Official pquoc UUID only — tenant bots (even with @AskPQuoc_bot token) stay on isolated RAG.
    if (hooks.isPquocRagBot(botId)) {
      const out = await hooks.forwardToPquocInternal(payload);
      const reply = hooks.fixBrokenPquocUrls(String(out.data?.reply ?? "").trim(), lang);
      if (out.ok && reply) {
        if (token) await sendTelegramMessage(token, chatId, reply);
        await hooks.insertChatMessage({
          botId,
          sessionId,
          role: "assistant",
          content: reply,
          platform: "telegram",
        });
        return;
      }
    }

    let reply = "";
    try {
      const intent = classifyIntent(query);
      const skipKb = intent === "smalltalk";
      const rag = skipKb
        ? { chunks: [], degraded: false, source: "empty" as const }
        : await getRagContext(botId, query);
      const historyRows = await loadChatHistory({
        supabaseUrl: process.env.SUPABASE_URL || "",
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        botId,
        sessionId,
      });
      const history = toLlmMessages(historyRows).slice(0, -1);
      const override = hooks.getRolePrompt ? await hooks.getRolePrompt(agent.bot_role) : "";
      const basePrompt = resolveRolePrompt(agent.bot_role, override);
      const system = buildTenantSystemPrompt({
        basePrompt,
        role: agent.bot_role,
        lang: lang || agent.default_lang || "en",
        intent,
        knowledge: formatKnowledgeBlock(rag.chunks),
        degraded: rag.degraded,
        skipKbGrounding: skipKb,
      });
      reply = await completeChat(
        [
          { role: "system", content: system },
          ...history,
          { role: "user", content: query },
        ],
        lang,
      );
    } catch (err) {
      console.error("telegram rag/llm error", err);
      reply = fallbackReply(lang);
    }

    if (reply && token) {
      const sent = await sendTelegramMessage(token, chatId, reply);
      if (!sent) console.error("telegram sendMessage failed", { botId, chatId });
      await hooks.insertChatMessage({
        botId,
        sessionId,
        role: "assistant",
        content: reply,
        platform: "telegram",
      });
      return;
    }

    const n8nWebhookUrl = agent.n8n_webhook_url || hooks.n8nWebhookUrlDefault;
    if (n8nWebhookUrl) {
      hooks.forwardToN8n(n8nWebhookUrl, payload).catch((err) => console.error("telegram n8n fallback", err));
    }
  }

  async function handleSetup(req: IncomingMessage, res: ServerResponse, botId: string, extraHeaders: Record<string, string> = {}): Promise<void> {
    if (!botId) {
      http.json(res, 400, { ok: false, error: "Missing bot_id" }, extraHeaders);
      return;
    }
    const agent = await hooks.getChatAgent(botId);
    if (!agent) {
      http.json(res, 404, { ok: false, error: "Bot not found" }, extraHeaders);
      return;
    }
    if (!agent.telegram_bot_token) {
      http.json(res, 400, { ok: false, error: "telegram_bot_token is empty" }, extraHeaders);
      return;
    }

    const webhookUrl = `${hooks.widgetPublicUrl.replace(/\/$/, "")}/v1/chat-agent/telegram/webhook?bot_id=${encodeURIComponent(botId)}`;
    const secret = webhookSecretForBot(botId, hooks.telegramWebhookSecret);
    const result = await setTelegramWebhook(agent.telegram_bot_token, webhookUrl, secret || undefined);
    const ident = await getTelegramBotIdentity(agent.telegram_bot_token);
    if (result.ok && hooks.patchChatAgent) {
      await hooks.patchChatAgent(botId, {
        telegram_bot_username: ident.username || "",
        telegram_webhook_url: webhookUrl,
      }).catch(() => false);
    }
    http.json(
      res,
      result.ok ? 200 : 502,
      {
        ok: result.ok,
        connected: Boolean(result.ok && ident.username),
        webhook_url: webhookUrl,
        bot_username: ident.username || null,
        description: result.description || null,
      },
      extraHeaders,
    );
  }

  async function handleStatus(req: IncomingMessage, res: ServerResponse, botId: string, extraHeaders: Record<string, string> = {}): Promise<void> {
    if (!botId) {
      http.json(res, 400, { ok: false, connected: false, error: "Missing bot_id" }, extraHeaders);
      return;
    }
    const agent = await hooks.getChatAgent(botId);
    if (!agent) {
      http.json(res, 404, { ok: false, connected: false, error: "Bot not found" }, extraHeaders);
      return;
    }
    if (!agent.telegram_bot_token) {
      http.json(res, 200, { ok: true, connected: false, bot_username: null, webhook_url: null, pending_update_count: 0 }, extraHeaders);
      return;
    }
    const expectedUrl = `${hooks.widgetPublicUrl.replace(/\/$/, "")}/v1/chat-agent/telegram/webhook?bot_id=${encodeURIComponent(botId)}`;
    const ident = await getTelegramBotIdentity(agent.telegram_bot_token);
    const info = await getTelegramWebhookInfo(agent.telegram_bot_token);
    const currentUrl = String(info.result?.url || "");
    const connected = Boolean(ident.username && currentUrl && currentUrl.includes(botId));
    http.json(
      res,
      info.ok || ident.username ? 200 : 502,
      {
        ok: true,
        connected,
        bot_username: ident.username || null,
        webhook_url: currentUrl || null,
        expected_webhook_url: expectedUrl,
        pending_update_count: Number(info.result?.pending_update_count || 0),
        last_error: info.result?.last_error_message || info.description || null,
      },
      extraHeaders,
    );
  }

  return { handleWebhook, handleSetup, handleStatus };
}
