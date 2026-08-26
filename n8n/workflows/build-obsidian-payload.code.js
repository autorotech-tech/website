const iso = new Date().toISOString();
const date = iso.slice(0, 10);
const title = String($json.memory_topic || 'general').replace(/\s*\/\s*/g, ' - ').trim();

const originalText = String($json.original_text || $json.text || '').trim();
const normalizedText = String($json.normalized_text || $json.text || '').trim();
const aiAnswer = String($json.ai_answer || '').trim();
const username = String($json.username || '').trim();
const sender = username ? `@${username}` : String($json.sender_id || '').trim();
const kind = String($json.memory_kind || 'idea').trim();
const branch = String($json.obsidian_branch || 'Inbox/Ideas').trim();
const notePath = String($json.obsidian_note_path || '').trim();
const commandMode = String($json.command_mode || 'none').trim();
const provider = String($json.command_provider || 'none').trim();
const model = String($json.command_model || 'none').trim();
const topic = String($json.memory_topic || 'общий контекст').trim();

const urlMatch = originalText.match(/https?:\/\/[^\s]+/i);
const sourceUrl = urlMatch ? urlMatch[0] : '';

const topicTags = topic
  .split(/\s*\/\s*/)
  .map((s) => s.trim())
  .filter(Boolean)
  .slice(0, 6);

const tags = ['telegram', 'assistant', 'autoro', kind, commandMode, provider]
  .concat(topicTags)
  .filter(Boolean)
  .map((t) => String(t).toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '-'))
  .filter(Boolean);

const aiContextBlock = aiAnswer
  ? aiAnswer
  : (normalizedText || 'Контекст не был сгенерирован.');

const content = [
  '---',
  'source: \"Telegram\"',
  `original_sender: \"${sender || 'unknown'}\"`,
  `url: \"${sourceUrl}\"`,
  `tags: [${tags.join(', ')}]`,
  `date: ${date}`,
  'status: \"to_process\"',
  `kind: \"${kind}\"`,
  `chat_id: \"${String($json.chat_id || '')}\"`,
  `message_id: \"${String($json.message_id || '')}\"`,
  `update_id: \"${String($json.update_id || '')}\"`,
  `branch: \"${branch}\"`,
  `path: \"${notePath}\"`,
  `category: \"${kind}\"`,
  `command_mode: \"${commandMode}\"`,
  `provider: \"${provider}\"`,
  `model: \"${model}\"`,
  `created: \"${iso}\"`,
  '---',
  '',
  `# ${title || 'Telegram Note'}`,
  '',
  '### Краткий контекст (AI Generated):',
  aiContextBlock,
  '',
  '### Оригинальное сообщение:',
  `"${originalText || normalizedText}"`,
].filter(Boolean).join('\n');

return [{
  ...$json,
  obsidian_sync_enabled: true,
  obsidian_sync_webhook: String($env.OBSIDIAN_SYNC_WEBHOOK_URL || 'http://autoro-obsidian-relay:8787/sync').trim(),
  obsidian_sync_secondary_enabled: Boolean(String($env.OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY || $env.OBSIDIAN_SYNC_WEBHOOK_URL || '').trim()),
  obsidian_sync_webhook_secondary: String($env.OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY || $env.OBSIDIAN_SYNC_WEBHOOK_URL || 'http://autoro-obsidian-relay:8787/sync').trim(),
  obsidian_sync_token_secondary: String($env.OBSIDIAN_SYNC_TOKEN_SECONDARY || $env.OBSIDIAN_SYNC_TOKEN || 'autoro_obsidian_sync_v1').trim(),
  obsidian_sync_payload: {
    file_path: String($json.obsidian_note_path || '').trim(),
    branch: String($json.obsidian_branch || 'Inbox/Ideas').trim(),
    mode: 'append_or_create',
    content,
    metadata: {
      kind,
      category: kind,
      topic,
      tags,
      chat_id: $json.chat_id || '',
      message_id: $json.message_id || null,
      update_id: $json.update_id || null,
      command_mode: commandMode || null,
      provider,
      model,
    },
  },
  obsidian_sync_payload_secondary: {
    file_path: String($json.obsidian_note_path || '').trim(),
    branch: String($json.obsidian_branch || 'Inbox/Ideas').trim(),
    mode: 'append_or_create',
    content,
    metadata: {
      kind,
      category: kind,
      topic,
      tags,
      chat_id: $json.chat_id || '',
      message_id: $json.message_id || null,
      update_id: $json.update_id || null,
      command_mode: commandMode || null,
      provider,
      model,
      target: 'secondary',
    },
  },
}];
