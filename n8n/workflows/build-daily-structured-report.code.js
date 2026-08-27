// n8n Code node: Build Daily Structured Report — fetch shim для task runner

async function fetchShim(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  let body = init.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      /* строка как есть */
    }
  }
  const opts = {
    method,
    url,
    headers,
    json: true,
    returnFullResponse: true,
  };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    opts.body = body;
  }
  try {
    const full = await this.helpers.httpRequest(opts);
    const statusCode = full.statusCode ?? full.status ?? 200;
    return buildFetchLikeResponse(statusCode, full.body);
  } catch (err) {
    const statusCode =
      err.statusCode ??
      err.response?.status ??
      err.status ??
      err.cause?.statusCode ??
      0;
    const raw =
      err.response?.body ??
      err.error ??
      err.message ??
      '';
    if (raw && typeof raw === 'object') {
      return buildFetchLikeResponse(statusCode || 500, raw);
    }
    return buildFetchLikeResponse(statusCode || 500, String(raw));
  }
}

function buildFetchLikeResponse(statusCode, rawBody) {
  const ok = statusCode >= 200 && statusCode < 300;
  let parsed = rawBody;
  if (typeof rawBody === 'string') {
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }
  return {
    ok,
    status: statusCode,
    async json() {
      return parsed;
    },
    async text() {
      return typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? '');
    },
  };
}

const fetch = fetchShim.bind(this);

const data = $json;
const settingsRows = Array.isArray(data['Get Swoop Settings']) ? data['Get Swoop Settings'] : (Array.isArray(data) ? data : []);
const snapshots = Array.isArray(data['Get Project Snapshots']) ? data['Get Project Snapshots'] : [];
const memory = Array.isArray(data['Get Memory Records']) ? data['Get Memory Records'] : [];
const healthSwoop = data['Health Swoop'] || {};
const healthAutoro = data['Health Autoro'] || {};

const settings = Array.isArray(settingsRows) && settingsRows.length ? settingsRows[0] : (Array.isArray(data) && data[0] ? data[0] : {});
const keysRaw = settings?.openrouter_keys;
const keys = Array.isArray(keysRaw)
  ? keysRaw.map((x) => String(x || '').trim()).filter(Boolean)
  : [];

const staticData = $getWorkflowStaticData('global');
if (!staticData.keyRotation) staticData.keyRotation = {};
const keyIndex = keys.length ? (Number(staticData.keyRotation.openrouter || 0) % keys.length) : -1;
const key = keyIndex >= 0 ? keys[keyIndex] : null;

const today = new Date();
const dayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
const memoryLast24h = memory.filter((x) => new Date(x.created_at).getTime() >= dayAgo.getTime()).length;

const baseSteps = [];
for (const p of snapshots.slice(0, 5)) {
  if (p.next_step) baseSteps.push(`${p.name}: ${p.next_step}`);
}
if (!baseSteps.length) {
  baseSteps.push('Обновить статусы проектов в snapshot-таблице.');
  baseSteps.push('Проверить новые сообщения в Telegram-памяти.');
  baseSteps.push('Сверить риски и блокеры по активным проектам.');
}

let llmSteps = [];
if (key) {
  const model = settings?.openrouter_default_model || 'openai/gpt-4o-mini';
  const prompt = [
    'Сформируй 3 коротких следующих шага для операционного ассистента.',
    'Контекст проектов:',
    ...snapshots.slice(0, 8).map((p) => `- ${p.name}: ${p.progress_percent}% | ${p.stage} | ${p.next_step || 'n/a'}`),
    `Сообщений в памяти за 24ч: ${memoryLast24h}`
  ].join('\n');

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'Верни только 3 пункта списка, каждый с новой строки, без заголовков.'
          },
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    if (resp.ok) {
      const body = await resp.json();
      const content = body?.choices?.[0]?.message?.content || '';
      llmSteps = content
        .split('\n')
        .map((x) => x.replace(/^[\-\d\.\)\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 3);
    } else {
      const txt = await resp.text();
      if (resp.status === 429 || resp.status === 402 || /rate|quota|limit/i.test(txt)) {
        if (keys.length) staticData.keyRotation.openrouter = (keyIndex + 1) % keys.length;
      }
    }
  } catch (e) {
    // silent fallback
  }
}

const nextSteps = llmSteps.length ? llmSteps : baseSteps.slice(0, 3);
const dateStr = today.toISOString().slice(0, 10);
const swCode = healthSwoop.statusCode || healthSwoop.code || 'n/a';
const auCode = healthAutoro.statusCode || healthAutoro.code || 'n/a';

const lines = [
  `🤖 *Autoro Personal Assistant* \\(${dateStr}\\)`,
  '',
  '*1\\. Общие показатели состояния сервера*',
  `• swoop status: \\`${swCode}\\``,
  `• autoro status: \\`${auCode}\\``,
  `• memory items \\(24h\\): \\`${memoryLast24h}\\``,
  '',
  '*2\\. Процент/этап проектов \\(Swoop/Obsidian\\)*'
];

if (snapshots.length) {
  for (const p of snapshots.slice(0, 8)) {
    lines.push(`• \\`${String(p.name).replace(/`/g, '')}\\`: \\`${p.progress_percent}%\\` \\| stage: \\`${String(p.stage).replace(/`/g, '')}\\``);
  }
} else {
  lines.push('• \\`n/a\\` нет данных в personal_assistant_project_snapshots');
}

lines.push('', '*3\\. Краткий план дальнейших шагов*');
for (let i = 0; i < nextSteps.length; i++) {
  lines.push(`${i + 1}\\) ${nextSteps[i].replace(/([_\*\[\]\(\)~`>#+\-=|{}\.\!])/g, '\\\\$1')}`);
}

return [{
  report_text: lines.join('\n'),
  chat_id: String(settings?.telegram_report_chat_id || settings?.telegram_chat_id || '51564804'),
  key_slot: keyIndex + 1,
  key_total: keys.length
}];
