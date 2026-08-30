import type { LlmMessage } from "./types.js";
import { fallbackReply } from "./prompt.js";

const LLM_TIMEOUT_MS = Number(process.env.CHAT_AGENT_LLM_TIMEOUT_MS || 15_000);
const DEFAULT_MODEL = process.env.CHAT_AGENT_LLM_MODEL || "openai/gpt-4o-mini";

function swoopBase(): string {
  return String(process.env.SWOOP_API_BASE || process.env.AGENT_API_BASE || "https://swoop.autoro.tech").replace(
    /\/$/,
    "",
  );
}

function swoopKey(): string {
  return String(process.env.SWOOP_API_KEY || process.env.AUTORO_SCRAPE_API_KEY || "").trim();
}

export async function completeChat(messages: LlmMessage[], lang: string): Promise<string> {
  const key = swoopKey();
  const base = swoopBase();
  if (!key) return fallbackReply(lang);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/api/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.35,
        max_tokens: 700,
        messages,
      }),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    const content = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!res.ok || !content) return fallbackReply(lang);
    return content;
  } catch {
    return fallbackReply(lang);
  } finally {
    clearTimeout(timer);
  }
}
