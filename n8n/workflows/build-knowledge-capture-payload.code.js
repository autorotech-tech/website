const rawText = String(
  $json.body?.message?.text ||
  $json.body?.edited_message?.text ||
  $json.body?.callback_query?.data ||
  ''
).trim();

const chatId = String(
  $json.body?.message?.chat?.id ??
  $json.body?.edited_message?.chat?.id ??
  $json.body?.callback_query?.message?.chat?.id ??
  ''
).trim();

const senderUsername = String(
  $json.body?.message?.from?.username ||
  $json.body?.edited_message?.from?.username ||
  $json.body?.callback_query?.from?.username ||
  ''
).trim();

const sender = senderUsername ? `@${senderUsername}` : String(
  $json.body?.message?.from?.id ??
  $json.body?.edited_message?.from?.id ??
  $json.body?.callback_query?.from?.id ??
  ''
).trim();

const updateId = Number($json.body?.update_id || 0);
const messageId = Number(
  $json.body?.message?.message_id ??
  $json.body?.edited_message?.message_id ??
  $json.body?.callback_query?.message?.message_id ??
  0
);

const compact = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

const extractUrl = (s) => {
  const m = String(s || '').match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : '';
};

const detectCategory = (text) => {
  const t = text.toLowerCase();
  if (/(ai|llm|gpt|gemini|anthropic|prompt)/i.test(t)) return 'ai-ml';
  if (/(api|sdk|typescript|javascript|python|docker|dev)/i.test(t)) return 'dev-tools';
  if (/(seo|ads|marketing|growth|lead)/i.test(t)) return 'marketing';
  return 'general';
};

const buildTags = (text, category) => {
  const t = text.toLowerCase();
  const candidates = ['ai', 'llm', 'api', 'automation', 'n8n', 'telegram', 'seo', 'marketing', 'dev'];
  const tags = candidates.filter((tag) => t.includes(tag));
  if (!tags.includes(category)) tags.unshift(category);
  return Array.from(new Set(tags)).slice(0, 8);
};

const text = compact(rawText);
const url = extractUrl(text);
const title = compact(text.split('\n')[0] || text).slice(0, 180) || 'Telegram message';
const category = detectCategory(text);
const tags = buildTags(text, category);
const aiSummary = text.length > 280 ? `${text.slice(0, 277)}...` : text;

return [
  {
    ...$json,
    has_text: Boolean(text),
    extracted: {
      chat_id: chatId,
      sender,
      update_id: updateId || null,
      message_id: messageId || null,
      source: 'telegram',
      url,
      title,
      text,
      ai_summary: aiSummary,
      category,
      tags,
      captured_at: new Date().toISOString(),
    },
    knowledge_capture_payload: {
      workspaceId: String($env.KNOWLEDGE_WORKSPACE_ID || '1'),
      source: 'telegram',
      originalSender: sender || null,
      url: url || null,
      title,
      text,
      aiSummary,
      category,
      tags,
      status: 'to_process',
      capturedAt: new Date().toISOString(),
    },
  },
];
