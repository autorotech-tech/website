const sourceText = String($json.original_text || $json.text || '').trim();
const replyToText = String($json.reply_to_text || '').trim();
const callbackMessageText = String($json.callback_message_text || '').trim();

function compact(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function escapeMdV2(text) {
  return String(text || '').replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function buildMarkdownMessage(title, lines = []) {
  const safeTitle = `*${escapeMdV2(title)}*`;
  const safeLines = lines.map((line) => escapeMdV2(line));
  return [safeTitle, '', ...safeLines].join('\n');
}

function parseControlCommands(text) {
  const t = text.trim();
  const l = t.toLowerCase();

  if (/^\/(help|start)\b/i.test(t) || /^(помощь|хелп|что умеешь)/i.test(l)) {
    return { type: 'help' };
  }

  if (/^\/(clear_context|clear|reset_context)\b/i.test(t) || /^(очисти|сбрось)\s+контекст/i.test(l)) {
    return { type: 'clear_context' };
  }

  // Хвост после числа: подпись, тире и т.п. (regex без жёсткой границы слова после числа).
  const ctxSlash = t.match(/^\/context\s+(\d{1,3})(?:\s|[—–\-:.,]|$)/i);
  if (ctxSlash) return { type: 'set_context', depth: Math.max(0, Math.min(50, Number(ctxSlash[1]))) };

  const ctxRu = l.match(/^контекст\s+(\d{1,3})\b/i);
  if (ctxRu) return { type: 'set_context', depth: Math.max(0, Math.min(50, Number(ctxRu[1]))) };

  if (/^\/(status|ctx|monitor)\b/i.test(t) || /^(статус|мониторинг|покажи\s+контекст)/i.test(l)) {
    return { type: 'status' };
  }

  if (/^\/(obsidian_test|obs_test)\b/i.test(t) || /^(тест\s+обсидиан|проверка\s+обсидиан)/i.test(l)) {
    return { type: 'obsidian_test' };
  }

  if (/^cmd:save$/i.test(t)) {
    return { type: 'save_selection' };
  }

  return null;
}

function detectCommand(text) {
  const t = text.trim();
  const l = t.toLowerCase();

  if (/^cmd:deepen$/i.test(t)) {
    const promptBase = callbackMessageText || replyToText || 'предыдущий ответ';
    return {
      detected: true,
      mode: 'ask',
      prompt: `Углуби предыдущий ответ, выдели риски и дай следующий план действий:\n${promptBase}`,
      forceAssistant: false,
    };
  }

  if (/^cmd:json$/i.test(t)) {
    const selected = callbackMessageText || replyToText || '';
    return {
      detected: true,
      mode: 'json',
      prompt: compact(selected),
      forceAssistant: true,
    };
  }

  if (/^cmd:optimize$/i.test(t)) {
    const selected = callbackMessageText || replyToText || '';
    return {
      detected: true,
      mode: 'optimize',
      prompt: compact(selected),
      forceAssistant: true,
    };
  }

  const hermesMatch = t.match(/^\/hermes(?:\s+|$)([\s\S]*)/i);
  if (hermesMatch) {
    const rest = compact(hermesMatch[1] || '');
    const prompt =
      rest || compact(replyToText || callbackMessageText || 'Ответь по контексту переписки.');
    return {
      detected: true,
      mode: 'ask',
      prompt,
      forceAssistant: false,
    };
  }

  const cursorMatch = t.match(/^\/cursor(?:\s+|$)([\s\S]*)/i);
  if (cursorMatch) {
    const rest = compact(cursorMatch[1] || '');
    const prompt =
      rest || compact(replyToText || callbackMessageText || 'Выполни задачу в Cursor CLI по контексту переписки.');
    return {
      detected: true,
      mode: 'cursor',
      prompt,
      forceAssistant: false,
    };
  }

  const patterns = [
    // Встроенный ассистент (OpenRouter/OpenAI), если Hermes настроен но нужен локальный пайплайн
    { mode: 'ask', regex: /^\/assistant(?:\s+|$)([\s\S]*)/i, forceAssistant: true },
    { mode: 'research', regex: /^\/research(?:\s+|$)([\s\S]*)/i },
    { mode: 'ask', regex: /^\/ask(?:\s+|$)([\s\S]*)/i },
    { mode: 'json', regex: /^\/(json|tojson)(?:\s+|$)([\s\S]*)/i, group: 2 },
    { mode: 'optimize', regex: /^\/(optimize|prompt_optimize)(?:\s+|$)([\s\S]*)/i, group: 2 },
    { mode: 'research', regex: /^ресерч[:\s-]+([\s\S]*)/i },
    { mode: 'research', regex: /^(исследуй|проанализируй|сравни)\s+([\s\S]*)/i, group: 2 },
    { mode: 'ask', regex: /^вопрос[:\s-]+([\s\S]*)/i },
    { mode: 'ask', regex: /^(ответь|подскажи|объясни)\s+([\s\S]*)/i, group: 2 },
    { mode: 'json', regex: /^(в\s+json|в\s+джейсон|json)\s+([\s\S]*)/i, group: 2 },
    { mode: 'optimize', regex: /^(оптимизируй\s+промпт|улучши\s+промпт|промпт\s+оптимизируй)\s*[:\-]?\s*([\s\S]*)/i, group: 2 },
  ];

  for (const p of patterns) {
    const m = t.match(p.regex);
    if (m) {
      const idx = p.group || 1;
      return {
        detected: true,
        mode: p.mode,
        prompt: compact(m[idx] || ''),
        forceAssistant: Boolean(p.forceAssistant),
      };
    }
  }

  if (l.includes('сделай ресерч') || l.includes('проведи ресерч')) {
    const prompt = compact(t.replace(/сделай\s+ресерч|проведи\s+ресерч/ig, ''));
    return { detected: true, mode: 'research', prompt, forceAssistant: false };
  }

  // Fallback: любой непустой текст считаем диалоговым запросом к ИИ.
  if (t) {
    return { detected: true, mode: 'ask', prompt: compact(t), forceAssistant: false };
  }

  return { detected: false, mode: null, prompt: '', forceAssistant: false };
}

function resolveObsidianBranch(kind) {
  switch (kind) {
    case 'task': return 'Inbox/Tasks';
    case 'plan': return 'Inbox/Plans';
    case 'instruction': return 'Inbox/Instructions';
    case 'research': return 'Inbox/Research';
    case 'json': return 'Inbox/JSON';
    case 'idea':
    default: return 'Inbox/Ideas';
  }
}

function classifyLlmTierByMode(mode) {
  const m = String(mode || '').toLowerCase();
  if (m === 'research') return 'reasoning';
  if (m === 'optimize') return 'fast';
  return 'general';
}

function normalizeRoutingConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === 'object' ? raw : {};
}

function pickRouteFromRouting(tier, routing, fallbackModel) {
  const t = String(tier || 'general').toLowerCase();
  const r = normalizeRoutingConfig(routing);
  const chain = Array.isArray(r?.tiers?.[t]) ? r.tiers[t] : [];
  const first = chain.find((x) => x && typeof x === 'object') || null;
  const provider = String(first?.provider || '').trim() || 'openrouter';
  const model = String(first?.model || '').trim() || String(fallbackModel || '').trim() || 'google/gemini-2.5-pro';
  return { provider, model };
}

const ROUTING_PROVIDERS = new Set(['openrouter', 'groq', 'glm', 'openai', 'gemini', 'api_key_groups', 'env_openai']);

function coerceRoutingSteps(val) {
  if (!Array.isArray(val)) return [];
  return val
    .filter((x) => x && typeof x === 'object')
    .map((x) => ({
      provider: String(x.provider || '').trim().toLowerCase(),
      model: String(x.model || '').trim(),
    }))
    .filter((x) => ROUTING_PROVIDERS.has(x.provider));
}

function buildRoutingChain(tier, routing) {
  const r = normalizeRoutingConfig(routing);
  const t = String(tier || 'general').toLowerCase();
  const defaults = {
    code: [
      { provider: 'openrouter', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'openai', model: '' },
    ],
    reasoning: [
      { provider: 'openrouter', model: '' },
      { provider: 'openai', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
    ],
    fast: [
      { provider: 'groq', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'openrouter', model: '' },
      { provider: 'openai', model: '' },
    ],
    general: [
      { provider: 'openrouter', model: '' },
      { provider: 'glm', model: '' },
      { provider: 'groq', model: '' },
      { provider: 'openai', model: '' },
    ],
  };
  const tierSteps = coerceRoutingSteps(r?.tiers?.[t]);
  const fbSteps = coerceRoutingSteps(r?.fallback);
  const base = tierSteps.length ? tierSteps : (defaults[t] || defaults.general);
  return [...base, ...fbSteps];
}

function resolveStepModel(provider, stepModel, settings) {
  const m = String(stepModel || '').trim();
  if (m) return m;
  const p = String(provider || '').toLowerCase();
  if (p === 'openrouter') return String(settings.openrouter_default_model || 'google/gemini-2.5-pro').trim();
  if (p === 'openai') return 'gpt-4.1-mini';
  if (p === 'groq') return 'llama-3.3-70b-versatile';
  if (p === 'glm') return 'glm-4-flash';
  return 'google/gemini-2.5-pro';
}

async function tryRoutingStep(step, ctx) {
  const prov = String(step.provider || '').toLowerCase();
  const modelUse = resolveStepModel(prov, step.model, ctx.settings);
  const {
    answerMessages,
    answerMaxTokens,
    answerTemperature,
    openrouterPool,
    openrouterQwenKeys,
    openaiPool,
    groqPool,
    glmPool,
    settings,
  } = ctx;

  if (prov === 'openrouter') {
    const r = await callOpenRouterChat(
      openrouterPool,
      'openrouter_pool',
      modelUse,
      answerMessages,
      answerMaxTokens,
      answerTemperature,
    );
    if (r.content) return { content: r.content, provider: r.provider, model: modelUse };
    if (openrouterQwenKeys.length) {
      const qwenModel = String(settings.openrouter_qwen_model || 'qwen/qwen3.6-plus-preview:free').trim();
      const rq = await callOpenRouterChat(
        openrouterQwenKeys,
        'openrouter_qwen_keys',
        qwenModel,
        answerMessages,
        answerMaxTokens,
        answerTemperature,
      );
      if (rq.content) return { content: rq.content, provider: 'openrouter-qwen', model: qwenModel };
      if (rq.lastErrors?.length) ctx.llmFailures.push(...rq.lastErrors);
    }
    if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    return null;
  }

  if (prov === 'openai') {
    const r = await callOpenAiCompatibleChat(
      openaiPool,
      'openai_pool',
      'https://api.openai.com/v1',
      modelUse,
      answerMessages,
      answerMaxTokens,
      answerTemperature,
    );
    if (r.content) return { content: r.content, provider: r.provider, model: modelUse };
    if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    return null;
  }

  if (prov === 'groq') {
    const r = await callOpenAiCompatibleChat(
      groqPool,
      'groq_pool',
      'https://api.groq.com/openai/v1',
      modelUse,
      answerMessages,
      answerMaxTokens,
      answerTemperature,
    );
    if (r.content) return { content: r.content, provider: r.provider, model: modelUse };
    if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    return null;
  }

  if (prov === 'glm') {
    const r = await callOpenAiCompatibleChat(
      glmPool,
      'glm_pool',
      'https://open.bigmodel.cn/api/paas/v4',
      modelUse,
      answerMessages,
      answerMaxTokens,
      answerTemperature,
    );
    if (r.content) return { content: r.content, provider: r.provider, model: modelUse };
    if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    return null;
  }

  if (prov === 'api_key_groups') {
    if (openrouterPool.length) {
      const orModel = String(settings.openrouter_default_model || 'google/gemini-2.5-pro').trim();
      const r = await callOpenRouterChat(
        openrouterPool,
        'api_key_groups_or',
        orModel,
        answerMessages,
        answerMaxTokens,
        answerTemperature,
      );
      if (r.content) return { content: r.content, provider: 'api_key_groups', model: orModel };
      if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    }
    if (openaiPool.length) {
      const oaModel = 'gpt-4.1-mini';
      const r = await callOpenAiCompatibleChat(
        openaiPool,
        'api_key_groups_oa',
        'https://api.openai.com/v1',
        oaModel,
        answerMessages,
        answerMaxTokens,
        answerTemperature,
      );
      if (r.content) return { content: r.content, provider: 'api_key_groups', model: oaModel };
      if (r.lastErrors?.length) ctx.llmFailures.push(...r.lastErrors);
    }
    return null;
  }

  return null;
}

function optimizePromptLocally(mode, prompt, context) {
  const p = compact(prompt);
  const c = compact(context || '');

  if (mode === 'json') {
    return [
      'Верни строго валидный JSON без markdown и комментариев.',
      'Требуемые поля: summary, intent, category, priority, entities, action_items, risks.',
      'Если данных недостаточно — оставь пустые массивы/строки, но сохрани схему.',
      'TEXT: ' + p,
    ].join('\n');
  }

  if (mode === 'research') {
    return [
      'Задача: подготовить практичный ресеч-ответ.',
      'Формат: 1) краткий вывод 2) факты/сравнение 3) риски 4) следующие шаги.',
      c ? ('Контекст: ' + c.slice(0, 1200)) : '',
      'Запрос: ' + p,
    ].filter(Boolean).join('\n');
  }

  return [
    'Задача: дать краткий, прикладной и структурированный ответ.',
    'Формат: буллеты + конкретные шаги.',
    c ? ('Контекст: ' + c.slice(0, 1200)) : '',
    'Запрос: ' + p,
  ].filter(Boolean).join('\n');
}

async function fetchShim(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  let body = init.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  }

  const opts = { method, url, headers, json: true, returnFullResponse: true };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') opts.body = body;

  try {
    const full = await this.helpers.httpRequest(opts);
    const statusCode = full.statusCode ?? full.status ?? 200;
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      async json() { return full.body; },
      async text() { return typeof full.body === 'string' ? full.body : JSON.stringify(full.body || ''); },
    };
  } catch (err) {
    const statusCode = err.statusCode ?? err.response?.status ?? err.status ?? 500;
    const raw = err.response?.body ?? err.error ?? err.message ?? '';
    return {
      ok: false,
      status: statusCode,
      async json() { return raw; },
      async text() { return typeof raw === 'string' ? raw : JSON.stringify(raw || ''); },
    };
  }
}

const staticData = $getWorkflowStaticData('global');
if (!staticData.commandContext) staticData.commandContext = {};
if (!staticData.commandStats) staticData.commandStats = { total: 0, ask: 0, research: 0, json: 0, optimize: 0, control: 0, optimized: 0, optimizationFallback: 0 };

const chatId = String($json.chat_id || '');
if (!staticData.commandContext[chatId]) {
  staticData.commandContext[chatId] = { depth: 10, resetAt: null, updatedAt: null };
}
const chatContext = staticData.commandContext[chatId];

const control = parseControlCommands(sourceText);
if (control) {
  staticData.commandStats.total += 1;
  staticData.commandStats.control += 1;

  let answer = '';
  if (control.type === 'help') {
    answer = buildMarkdownMessage('Справка по командам', [
      '/ask <вопрос> — через agent-api Hermes (если HERMES_AGENT_API_URL оканчивается на /api/v1/hermes/run)',
      '/assistant <вопрос> — только встроенный ассистент (OpenRouter/OpenAI), минуя Hermes',
      '/hermes <запрос> — явный вызов Hermes',
      '/cursor <задача> — запустить Cursor CLI через Hermes',
      '/research <тема> — разбор темы (agent-api Hermes или inline LLM с ротацией ключей Swoop)',
      '/json <текст> — извлечение структуры в JSON',
      '/optimize <промпт> — улучшение промпта',
      '/status — статистика ассистента и режима',
      '/context 10 — глубина истории для ИИ (0..50)',
      '/clear_context — сброс контекста текущего чата',
      '/obsidian_test — проверка синхронизации в Obsidian',
      'Также можно нажимать inline-кнопки под ответом ИИ.',
    ]);
  } else if (control.type === 'clear_context') {
    chatContext.resetAt = new Date().toISOString();
    answer = buildMarkdownMessage('Контекст очищен', [
      'Следующие команды начнутся с чистой истории.',
    ]);
  } else if (control.type === 'set_context') {
    chatContext.depth = control.depth;
    chatContext.updatedAt = new Date().toISOString();
    answer = buildMarkdownMessage('Контекст обновлён', [
      `Глубина: ${control.depth} сообщений`,
    ]);
  } else if (control.type === 'obsidian_test') {
    const relayToken = String($env.OBSIDIAN_SYNC_TOKEN || 'autoro_obsidian_sync_v1').trim();
    const relayUrl = String($env.OBSIDIAN_SYNC_WEBHOOK_URL || 'http://autoro-obsidian-relay:8787/sync').trim();
    const testPath = `Inbox/Research/obsidian-test-${new Date().toISOString().slice(0,10)}.md`;
    const testPayload = {
      file_path: testPath,
      mode: 'append_or_create',
      content: `# Obsidian test\ncreated: ${new Date().toISOString()}\nsource: telegram /obsidian_test`,
    };

    const testResp = await fetchShim.call(this, relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-obsidian-token': relayToken,
      },
      body: JSON.stringify(testPayload),
    });

    if (testResp.ok) {
      const b = await testResp.json();
      answer = buildMarkdownMessage('Obsidian relay OK', [
        `Файл: ${b.file_path || testPath}`,
      ]);
    } else {
      const t = await testResp.text();
      answer = buildMarkdownMessage('Obsidian relay ERROR', [
        `HTTP: ${testResp.status}`,
        String(t).slice(0, 280),
      ]);
    }
  } else if (control.type === 'save_selection') {
    const selected = callbackMessageText || replyToText || sourceText;
    answer = buildMarkdownMessage('Сохранение в Obsidian', [
      'Выбранный фрагмент будет сохранён в ветку Research.',
      `Текст: ${compact(selected).slice(0, 160)}`,
    ]);
  } else {
    answer = buildMarkdownMessage('Статус ассистента', [
      `context depth: ${chatContext.depth}`,
      `resetAt: ${chatContext.resetAt || 'not set'}`,
      `total commands: ${staticData.commandStats.total}`,
      `ask: ${staticData.commandStats.ask}`,
      `research: ${staticData.commandStats.research}`,
      `json: ${staticData.commandStats.json}`,
      `optimize: ${staticData.commandStats.optimize || 0}`,
      `control: ${staticData.commandStats.control}`,
      `optimized: ${staticData.commandStats.optimized || 0}`,
      `optimization fallback: ${staticData.commandStats.optimizationFallback || 0}`,
    ]);
  }

  const memoryKind = control.type === 'save_selection' ? 'research' : 'instruction';
  const memoryTopic = control.type === 'save_selection' ? 'saved selection' : 'управление контекстом';
  const obsidianBranch = resolveObsidianBranch(memoryKind);

  return [{
    ...$json,
    command_detected: true,
    command_mode: control.type,
    command_prompt: sourceText,
    ai_answer: answer,
    ai_answer_markdown: answer,
    command_provider: 'local-control',
    command_model: 'none',
    command_history_count: 0,
    memory_kind: memoryKind,
    memory_topic: memoryTopic,
    normalized_text: `Системная команда: ${control.type}.`,
    text: `Системная команда: ${control.type}.`,
    original_text: sourceText,
    obsidian_branch: obsidianBranch,
    obsidian_note_path: `${obsidianBranch}/${new Date().toISOString().slice(0,10)}-context-control.md`,
  }];
}

const cmd = detectCommand(sourceText);
/** Подтягиваем тему для /research без аргумента (как у /optimize через reply). */
let resolvedPrompt = cmd.prompt;
if (cmd.detected && cmd.mode === 'research' && !resolvedPrompt) {
  resolvedPrompt = compact(replyToText || callbackMessageText || 'Краткий research по последнему контексту чата.');
}
const cmdEffective = cmd.detected ? { ...cmd, prompt: resolvedPrompt } : cmd;

if (!cmdEffective.detected || (!cmdEffective.prompt && cmdEffective.mode !== 'json' && cmdEffective.mode !== 'optimize')) {
  return [{ ...$json, command_detected: false }];
}

const cmd = cmdEffective;

staticData.commandStats.total += 1;
if (cmd.mode === 'research') staticData.commandStats.research += 1;
if (cmd.mode === 'ask') staticData.commandStats.ask += 1;
if (cmd.mode === 'json') staticData.commandStats.json += 1;
if (cmd.mode === 'optimize') staticData.commandStats.optimize += 1;

const supabaseUrl = String($env.SUPABASE_URL || 'https://swoop.autoro.tech/supabase').replace(/\/$/, '');
const serviceRoleKey = String($env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!supabaseUrl || !serviceRoleKey) {
  const err = buildMarkdownMessage('Ошибка окружения', ['SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы']);
  return [{
    ...$json,
    command_detected: true,
    command_mode: cmd.mode,
    command_prompt: cmd.prompt,
    ai_answer: err,
    ai_answer_markdown: err,
    command_provider: 'none',
    command_model: 'none',
    defer_hermes: false,
    routing_force_assistant: Boolean(cmd.forceAssistant),
  }];
}

const settingsRespEarly = await fetchShim.call(this, `${supabaseUrl}/rest/v1/service_settings?id=eq.1&select=openai_keys,openrouter_keys,openrouter_default_model,openrouter_qwen_keys,openrouter_qwen_model,glm_keys,groq_keys,api_key_groups,agent_llm_routing`, {
  method: 'GET',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});

let settings = {};
if (settingsRespEarly.ok) {
  const rows = await settingsRespEarly.json();
  settings = Array.isArray(rows) && rows[0] ? rows[0] : {};
}

/** Hermes: только agent-api /api/v1/hermes/run (ротация ключей Swoop). Старый Hermes с 3 retry на одном ключе — inline LLM. */
const hermesUrl = String($env.HERMES_AGENT_API_URL || '').trim().replace(/\/+$/, '');
const hermesUsesSwoopRouting =
  /\/api\/v1\/hermes\/run$/i.test(hermesUrl) ||
  String($env.TELEGRAM_HERMES_USE_AGENT_API || '').trim() === '1';
const forceAssistantFlag = Boolean(cmd.forceAssistant);
const resolvedTier = classifyLlmTierByMode(cmd.mode);
const route = pickRouteFromRouting(resolvedTier, settings.agent_llm_routing, settings.openrouter_default_model);
const swoopUserEmail = String($env.SWOOP_LLM_USER_EMAIL || 'autoro.tech@gmail.com').trim();

const deferHermes =
  hermesUrl !== '' &&
  hermesUsesSwoopRouting &&
  (cmd.mode === 'ask' || cmd.mode === 'research' || cmd.mode === 'cursor') &&
  !forceAssistantFlag;

if (deferHermes) {
  const effectivePromptEarly = cmd.prompt;
  const topicEarly = effectivePromptEarly
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' / ') || 'общий контекст';
  const memoryKindEarly = cmd.mode === 'research' ? 'research' : 'instruction';
  const obsidianBranchEarly = resolveObsidianBranch(memoryKindEarly);

  const holdMarkdown = buildMarkdownMessage('Hermes обрабатывает запрос…', [
    `Режим: ${cmd.mode}`,
    `(ответ подставится после ответа сервиса Hermes)`,
  ]);

  const normalizedTextHermes = [
    `Диалог (${cmd.mode}) → Hermes`,
    `Запрос: ${effectivePromptEarly}`,
  ].join('\n');

  const depthPeek = Math.max(0, Number(chatContext.depth || 10));

  return [{
    ...$json,
    command_detected: true,
    command_mode: cmd.mode,
    command_prompt: effectivePromptEarly,
    llm_tier: resolvedTier,
    llm_route_provider: route.provider,
    llm_route_model: route.model,
    swoop_user_email: swoopUserEmail,
    defer_hermes: true,
    routing_force_assistant: false,
    ai_answer: '',
    ai_answer_markdown: holdMarkdown,
    command_provider: 'hermes-queue',
    command_model: route.model || 'hermes',
    command_history_count: 0,
    command_context_depth: depthPeek,
    memory_kind: memoryKindEarly,
    memory_topic: topicEarly,
    normalized_text: normalizedTextHermes,
    text: normalizedTextHermes,
    original_text: sourceText,
    obsidian_branch: obsidianBranchEarly,
    obsidian_note_path: `${obsidianBranchEarly}/${new Date().toISOString().slice(0, 10)}-${topicEarly.replace(/\s*\/\s*/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 60) || 'general'}.md`,
  }];
}

const fetch = fetchShim.bind(this);

const normalizeKeys = (value) => {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const arr = JSON.parse(value);
      if (Array.isArray(arr)) return arr.map((x) => String(x || '').trim()).filter(Boolean);
    } catch {}
    return [value.trim()];
  }
  return [];
};

const openrouterKeys = normalizeKeys(settings.openrouter_keys);
const openrouterQwenKeys = normalizeKeys(settings.openrouter_qwen_keys);
const openaiKeys = normalizeKeys(settings.openai_keys);
const glmKeys = normalizeKeys(settings.glm_keys);
const groqKeys = normalizeKeys(settings.groq_keys);
const apiKeyGroupsRaw = settings.api_key_groups;
const apiKeyGroups = Array.isArray(apiKeyGroupsRaw)
  ? apiKeyGroupsRaw
  : typeof apiKeyGroupsRaw === 'string' && apiKeyGroupsRaw.trim()
    ? (() => {
        try {
          const p = JSON.parse(apiKeyGroupsRaw);
          return Array.isArray(p) ? p : [];
        } catch {
          return [];
        }
      })()
    : [];

function mergeUniqueKeys(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const k of list || []) {
      const s = String(k || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/** Ключи из Swoop → Группы API-ключей (как в agent-api). */
function selectApiKeyGroupKeys(groups, desiredProvider = '', desiredTier = '', desiredModel = '', userEmail = '') {
  if (!Array.isArray(groups) || !groups.length) return [];
  const provNorm = String(desiredProvider || '').trim().toLowerCase();
  const tierNorm = String(desiredTier || '').trim().toLowerCase();
  const modelNorm = String(desiredModel || '').trim();
  const emailNorm = String(userEmail || '').trim().toLowerCase();
  const matches = [];
  const anyKeys = [];
  for (let idx = 0; idx < groups.length; idx++) {
    const item = groups[idx];
    if (!item || typeof item !== 'object') continue;
    const keys = (item.keys || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean);
    if (!keys.length) continue;
    anyKeys.push(...keys);
    const itemProvider = String(item.provider || '').trim().toLowerCase();
    if (provNorm && itemProvider && itemProvider !== provNorm) continue;
    const tiersNorm = (Array.isArray(item.tiers) ? item.tiers : [])
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean);
    if (tierNorm && tiersNorm.length && !tiersNorm.includes(tierNorm)) continue;
    const modelsNorm = (Array.isArray(item.models) ? item.models : [])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    if (modelNorm && modelsNorm.length && !modelsNorm.includes(modelNorm)) continue;
    const itemEmail = String(item.user_email || item.email || '').trim().toLowerCase();
    if (emailNorm && itemEmail && itemEmail !== emailNorm) continue;
    const priority = Number(item.priority || 0) || 0;
    matches.push({ priority, idx, keys });
  }
  if (!matches.length) {
    const flat = [];
    const seen = new Set();
    for (const k of anyKeys) {
      if (!seen.has(k)) {
        seen.add(k);
        flat.push(k);
      }
    }
    return flat;
  }
  matches.sort((a, b) => b.priority - a.priority || a.idx - b.idx);
  const out = [];
  const seen = new Set();
  for (const m of matches) {
    for (const k of m.keys) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

const groupOpenRouterKeys = selectApiKeyGroupKeys(
  apiKeyGroups,
  'openrouter',
  resolvedTier,
  route.model,
  swoopUserEmail,
);
const groupOpenAiKeys = selectApiKeyGroupKeys(apiKeyGroups, 'openai', resolvedTier, '', swoopUserEmail);
const groupGroqKeys = selectApiKeyGroupKeys(apiKeyGroups, 'groq', resolvedTier, '', swoopUserEmail);
const groupGlmKeys = selectApiKeyGroupKeys(apiKeyGroups, 'glm', resolvedTier, '', swoopUserEmail);

const openrouterPool = mergeUniqueKeys(openrouterKeys, groupOpenRouterKeys);
const openaiPool = mergeUniqueKeys(openaiKeys, groupOpenAiKeys);
const groqPool = mergeUniqueKeys(groqKeys, groupGroqKeys);
const glmPool = mergeUniqueKeys(glmKeys, groupGlmKeys);

if (!staticData.keyHealth) staticData.keyHealth = {};

function keyId(provider, key) {
  return `${provider}:${String(key || '').slice(0, 10)}`;
}

function isInactive(provider, key) {
  const s = staticData.keyHealth[keyId(provider, key)];
  if (!s || !s.inactiveUntil) return false;
  return Date.now() < Number(s.inactiveUntil);
}

function markSuccess(provider, key) {
  staticData.keyHealth[keyId(provider, key)] = { status: 'active', inactiveUntil: 0, lastError: '', at: Date.now() };
}

function markFailure(provider, key, status, bodyText) {
  const t = String(bodyText || '').toLowerCase();
  const retryable = [401, 402, 403, 408, 429].includes(Number(status)) || Number(status) >= 500 || /rate|quota|limit|insufficient|unauthorized|forbidden/.test(t);
  const cooldownMs = [401, 403].includes(Number(status)) ? 60 * 60 * 1000 : ([402, 429].includes(Number(status)) ? 20 * 60 * 1000 : 15 * 60 * 1000);
  staticData.keyHealth[keyId(provider, key)] = {
    status: retryable ? 'inactive' : 'unknown',
    inactiveUntil: retryable ? Date.now() + cooldownMs : 0,
    lastError: `${status}: ${String(bodyText || '').slice(0, 180)}`,
    at: Date.now(),
  };
}

function orderedKeys(provider, keys) {
  const list = Array.isArray(keys) ? keys : [];
  const active = [];
  const inactive = [];
  for (const k of list) {
    if (isInactive(provider, k)) inactive.push(k);
    else active.push(k);
  }
  return [...active, ...inactive];
}

function sanitizeLlmError(bodyText, status) {
  const t = String(bodyText || '')
    .replace(/sk-or-[a-zA-Z0-9_-]+/gi, 'sk-or-***')
    .replace(/sk-[a-zA-Z0-9._-]{12,}/gi, 'sk-***')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer ***')
    .replace(/https?:\/\/[^\s"']+/gi, '[url]');
  return `${status}: ${t.replace(/\s+/g, ' ').trim().slice(0, 200)}`;
}

function parseAffordMaxTokens(bodyText) {
  const m = String(bodyText || '').match(/can only afford\s+(\d+)/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, n - 64);
}

function shouldRotateKeyImmediately(status) {
  return [401, 402, 429].includes(Number(status));
}

async function callOpenRouterChat(keys, providerName, model, messages, maxTokens, temperature = 0.2) {
  const ordered = orderedKeys(providerName, keys);
  const lastErrors = [];
  for (const key of ordered) {
    let tokensTry = maxTokens;
    let affordRetried = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: tokensTry,
          messages,
        }),
      });
      if (resp.ok) {
        const body = await resp.json();
        const content = body?.choices?.[0]?.message?.content;
        if (typeof content === 'string' && content.trim()) {
          markSuccess(providerName, key);
          return { content: content.trim(), model, provider: 'openrouter', lastErrors };
        }
      }
      const status = resp.status;
      const bodyText = await resp.text();
      const affordN = status === 402 ? parseAffordMaxTokens(bodyText) : null;
      if (status === 402 && affordN != null && !affordRetried) {
        tokensTry = affordN;
        affordRetried = true;
        continue;
      }
      markFailure(providerName, key, status, bodyText);
      lastErrors.push(sanitizeLlmError(bodyText, status));
      break;
    }
  }
  return { content: null, model, provider: 'openrouter', lastErrors };
}

async function callOpenAiCompatibleChat(keys, providerName, baseUrl, model, messages, maxTokens, temperature = 0.2) {
  const ordered = orderedKeys(providerName, keys);
  const lastErrors = [];
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`;
  const providerLabel = String(providerName || '').replace(/_keys$/, '') || 'openai';
  for (const key of ordered) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
    });
    if (resp.ok) {
      const body = await resp.json();
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content === 'string' && content.trim()) {
        markSuccess(providerName, key);
        return { content: content.trim(), model, provider: providerLabel, lastErrors };
      }
    }
    const status = resp.status;
    const bodyText = await resp.text();
    markFailure(providerName, key, status, bodyText);
    lastErrors.push(sanitizeLlmError(bodyText, status));
    if (shouldRotateKeyImmediately(status)) continue;
  }
  return { content: null, model, provider: providerLabel, lastErrors };
}

const depth = Math.max(0, Number(chatContext.depth || 10));
const resetIso = chatContext.resetAt;
let historyUrl = `${supabaseUrl}/rest/v1/personal_assistant_memory?source=eq.telegram&chat_id=eq.${encodeURIComponent(chatId)}&select=text,metadata,created_at&order=created_at.desc&limit=${Math.min(50, Math.max(depth || 1, 1) * 2)}`;
if (resetIso) {
  historyUrl += `&created_at=gte.${encodeURIComponent(resetIso)}`;
}

const historyResp = await fetch(historyUrl, {
  method: 'GET',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});

let historyRows = [];
if (historyResp.ok) {
  const rows = await historyResp.json();
  if (Array.isArray(rows)) historyRows = rows;
}

function historyLinesFromRow(r) {
  const md = r?.metadata && typeof r.metadata === 'object' ? r.metadata : {};
  const out = [];
  const userText = String(md.command_prompt || md.original_text || '').replace(/\s+/g, ' ').trim();
  const assistText = String(md.assistant_answer || '').replace(/\s+/g, ' ').trim();
  if (md.is_command && userText && assistText) {
    out.push(`user: ${userText.slice(0, 700)}`);
    out.push(`assistant: ${assistText.slice(0, 700)}`);
    return out;
  }
  const raw = String(r?.text || '').replace(/\s+/g, ' ').trim();
  const qm = raw.match(/Запрос:\s*([\s\S]*?)\s*Ответ:\s*([\s\S]*)/i);
  if (qm) {
    const u = compact(qm[1]);
    const a = compact(qm[2]);
    if (u) out.push(`user: ${u.slice(0, 700)}`);
    if (a) out.push(`assistant: ${a.slice(0, 700)}`);
    if (out.length) return out;
  }
  if (assistText && userText && assistText !== userText) {
    out.push(`user: ${userText.slice(0, 700)}`);
    out.push(`assistant: ${assistText.slice(0, 700)}`);
    return out;
  }
  const role = md.role || (assistText ? 'assistant' : 'user');
  const lineText = (role === 'assistant' && assistText) ? assistText : (userText || raw);
  if (!lineText) return [];
  return [`${role}: ${lineText.slice(0, 700)}`];
}

const historyLinesAll = historyRows
  .reverse()
  .flatMap((r) => historyLinesFromRow(r))
  .filter(Boolean);
const historyLines = depth === 0 ? [] : historyLinesAll.slice(-Math.min(historyLinesAll.length, depth * 2));

const contextBlock = historyLines.length
  ? historyLines.join('\n')
  : 'История отсутствует.';

let effectivePrompt = cmd.prompt;
if (cmd.mode === 'json') {
  if (!effectivePrompt) {
    effectivePrompt = replyToText || callbackMessageText || '';
  }
  if (!effectivePrompt) {
    const err = buildMarkdownMessage('JSON команда', [
      'Ответь на сообщение и отправь /json,',
      'или укажи текст после команды.',
    ]);
    return [{
      ...$json,
      command_detected: true,
      command_mode: 'json',
      command_prompt: '',
      ai_answer: err,
      ai_answer_markdown: err,
      command_provider: 'local-control',
      command_model: 'none',
      memory_kind: 'instruction',
      memory_topic: 'json преобразование',
      normalized_text: 'JSON команда без целевого текста.',
      text: 'JSON команда без целевого текста.',
    }];
  }
}

if (cmd.mode === 'optimize') {
  if (!effectivePrompt) {
    effectivePrompt = replyToText || callbackMessageText || '';
  }
  if (!effectivePrompt) {
    const err = buildMarkdownMessage('Оптимизация промпта', [
      'Ответь на сообщение и отправь /optimize,',
      'или укажи текст после команды.',
    ]);
    return [{
      ...$json,
      command_detected: true,
      command_mode: 'optimize',
      command_prompt: '',
      ai_answer: err,
      ai_answer_markdown: err,
      command_provider: 'local-control',
      command_model: 'none',
      memory_kind: 'instruction',
      memory_topic: 'оптимизация промпта',
      normalized_text: 'Команда optimize без целевого текста.',
      text: 'Команда optimize без целевого текста.',
    }];
  }
}

const systemPrompt = cmd.mode === 'research'
  ? 'Ты ассистент для ресеча. Дай структурированный и практичный ответ: краткий вывод, 3-7 пунктов, риски/ограничения, следующий шаг.'
  : cmd.mode === 'json'
    ? 'Преобразуй пользовательский текст в строгий JSON без комментариев и markdown. Верни только JSON объект с полями: summary, intent, category, priority, entities, action_items, risks.'
    : 'Ты практичный ассистент. Отвечай кратко и по делу, шагами, без воды.';

const basePrompt = cmd.mode === 'json'
  ? `Преобразуй в JSON:\n${effectivePrompt}`
  : `Контекст чата:\n${contextBlock}\n\nНовый запрос пользователя:\n${effectivePrompt}`;

let userPrompt = optimizePromptLocally(cmd.mode, effectivePrompt, contextBlock);
let promptOptimizationSource = 'local';

async function tryOptimizePromptWithAI() {
  const optimizerSystem = 'Ты оптимизатор промптов. Перепиши запрос так, чтобы ответ был максимально точным и структурированным. Верни только итоговый текст промпта.';
  const optimizerUser = `MODE: ${cmd.mode}\nBASE_PROMPT:\n${basePrompt}`;
  const optimizerMessages = [
    { role: 'system', content: optimizerSystem },
    { role: 'user', content: optimizerUser },
  ];

  if (openrouterPool.length) {
    const model = String(settings.openrouter_default_model || 'google/gemini-2.5-pro').trim();
    const r = await callOpenRouterChat(openrouterPool, 'openrouter_pool', model, optimizerMessages, 600, 0.1);
    if (r.content) return r.content;
  }

  if (openrouterQwenKeys.length) {
    const qwenModel = String(settings.openrouter_qwen_model || 'qwen/qwen3.6-plus-preview:free').trim();
    const r = await callOpenRouterChat(openrouterQwenKeys, 'openrouter_qwen_keys', qwenModel, optimizerMessages, 600, 0.1);
    if (r.content) return r.content;
  }

  if (openaiPool.length) {
    const r = await callOpenAiCompatibleChat(
      openaiPool,
      'openai_pool',
      'https://api.openai.com/v1',
      'gpt-4.1-mini',
      optimizerMessages,
      600,
      0.1,
    );
    if (r.content) return r.content;
  }

  return '';
}

const optimizedByAI = await tryOptimizePromptWithAI();
if (optimizedByAI) {
  userPrompt = optimizedByAI;
  promptOptimizationSource = 'ai';
  staticData.commandStats.optimized = Number(staticData.commandStats.optimized || 0) + 1;
} else {
  staticData.commandStats.optimizationFallback = Number(staticData.commandStats.optimizationFallback || 0) + 1;
}

let aiAnswer = '';
let provider = 'none';
let model = 'none';
const llmFailures = [];

if (cmd.mode === 'optimize') {
  aiAnswer = userPrompt;
  provider = promptOptimizationSource === 'ai' ? 'prompt-optimizer-ai' : 'prompt-optimizer-local';
  model = promptOptimizationSource === 'ai' ? 'optimizer' : 'local';
}

const answerMessages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userPrompt },
];
const answerMaxTokens = cmd.mode === 'research' ? 1800 : 1200;
const answerTemperature = cmd.mode === 'research' ? 0.3 : 0.2;

const routingChain = buildRoutingChain(resolvedTier, settings.agent_llm_routing);
const routingCtx = {
  answerMessages,
  answerMaxTokens,
  answerTemperature,
  openrouterPool,
  openrouterQwenKeys,
  openaiPool,
  groqPool,
  glmPool,
  settings,
  llmFailures,
};

for (const step of routingChain) {
  if (aiAnswer) break;
  const hit = await tryRoutingStep(step, routingCtx);
  if (hit?.content) {
    aiAnswer = hit.content;
    provider = hit.provider;
    model = hit.model;
  }
}

if (!aiAnswer) {
  const lastHint = llmFailures.length ? ` (${llmFailures[llmFailures.length - 1]})` : '';
  aiAnswer = `Не удалось получить ответ модели. Проверь ключи в Swoop → Service settings (OpenRouter, Qwen, OpenAI, GLM, Groq и группы API-ключей) и попробуй снова.${lastHint}`;
}

let aiAnswerMarkdown = '';
if (cmd.mode === 'optimize') {
  aiAnswerMarkdown = buildMarkdownMessage('Оптимизация промпта', [
    `source: ${effectivePrompt.slice(0, 900)}`,
    `optimized (${promptOptimizationSource}): ${userPrompt.slice(0, 1800)}`,
  ]);
} else if (cmd.mode === 'json') {
  aiAnswerMarkdown = [
    '*JSON результат*',
    '',
    '```json',
    aiAnswer,
    '```',
  ].join('\n');
} else if (cmd.mode === 'research') {
  aiAnswerMarkdown = buildMarkdownMessage('Research ответ', [aiAnswer]);
} else {
  aiAnswerMarkdown = buildMarkdownMessage('Ответ', [aiAnswer]);
}

const compactAnswer = aiAnswer.replace(/\s+/g, ' ').trim();
const normalizedText = [
  `Диалог (${cmd.mode})`,
  `Запрос: ${effectivePrompt}`,
  `Ответ: ${compactAnswer.slice(0, 2000)}`,
].join('\n');

const topic = effectivePrompt
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 4)
  .join(' / ') || 'общий контекст';

const memoryKind = cmd.mode === 'research' ? 'research' : cmd.mode === 'json' ? 'json' : 'instruction';
const obsidianBranch = resolveObsidianBranch(memoryKind);

return [{
  ...$json,
  command_detected: true,
  command_mode: cmd.mode,
  command_prompt: effectivePrompt,
  ai_answer: aiAnswer,
  ai_answer_markdown: aiAnswerMarkdown,
  command_provider: provider,
  command_model: model,
  command_history_count: historyLines.length,
  command_context_depth: depth,
  prompt_optimization_source: promptOptimizationSource,
  memory_kind: memoryKind,
  memory_topic: topic,
  normalized_text: normalizedText,
  text: normalizedText,
  original_text: sourceText,
  obsidian_branch: obsidianBranch,
  obsidian_note_path: `${obsidianBranch}/${new Date().toISOString().slice(0,10)}-${topic.replace(/\s*\/\s*/g,'-').replace(/[^\p{L}\p{N}-]/gu,'').slice(0,60) || 'general'}.md`,
  defer_hermes: false,
  routing_force_assistant: forceAssistantFlag,
}];
