// n8n Code node: Vectorize With Key Rotation
// Использует this.helpers.httpRequest вместо fetch (в task runner fetch может быть недоступен).

const text = ($json.text || '').trim();
const supabaseUrl = String($env.SUPABASE_URL || 'https://swoop.autoro.tech/supabase').replace(/\/$/, '');
const serviceRoleKey = String($env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY не заданы в env');
}

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

const staticData = $getWorkflowStaticData('global');
if (!staticData.keyRotation) staticData.keyRotation = {};

const settingsUrl = `${supabaseUrl}/rest/v1/service_settings?id=eq.1&select=openai_keys,openrouter_keys,openrouter_default_model,api_key_groups`;
const settingsResp = await fetch(settingsUrl, {
  method: 'GET',
  headers: {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
  },
});
if (!settingsResp.ok) {
  const debugBody = await settingsResp.text();
  throw new Error(
    `Не удалось загрузить service_settings: HTTP ${settingsResp.status} | debug=${JSON.stringify({
      hasKey: Boolean(serviceRoleKey),
      keyLen: serviceRoleKey.length,
      looksJwt: serviceRoleKey.split('.').length === 3,
      keyPrefix: serviceRoleKey.slice(0, 12),
      urlHost: supabaseUrl.replace(/^https?:\/\//, '').split('/')[0],
      bodyPreview: String(debugBody).slice(0, 180),
    })}`,
  );
}
const settingsRows = await settingsResp.json();
const settings = Array.isArray(settingsRows) && settingsRows.length ? settingsRows[0] : {};

const normalizeKeys = (value) => {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x || '').trim()).filter(Boolean);
    } catch {}
    return [value.trim()];
  }
  return [];
};

const openaiKeys = normalizeKeys(settings.openai_keys);
const openrouterKeys = normalizeKeys(settings.openrouter_keys);

function flattenApiKeyGroups(groups) {
  if (!Array.isArray(groups)) return [];
  const out = [];
  const seen = new Set();
  for (const item of groups) {
    if (!item || typeof item !== 'object') continue;
    for (const k of item.keys || []) {
      const s = String(k || '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

const groupKeys = flattenApiKeyGroups(
  Array.isArray(settings.api_key_groups)
    ? settings.api_key_groups
    : typeof settings.api_key_groups === 'string'
      ? (() => {
          try {
            const p = JSON.parse(settings.api_key_groups);
            return Array.isArray(p) ? p : [];
          } catch {
            return [];
          }
        })()
      : [],
);

function mergeKeyPools(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const k of list) {
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

const openaiPool = mergeKeyPools(openaiKeys, groupKeys);
const openrouterPool = mergeKeyPools(openrouterKeys, groupKeys);

const rotateAndGet = (provider, keys) => {
  if (!keys.length) return { key: null, idx: -1 };
  const cur = Number(staticData.keyRotation[provider] || 0) % keys.length;
  return { key: keys[cur], idx: cur };
};
const advance = (provider, keys) => {
  if (!keys.length) return;
  const cur = Number(staticData.keyRotation[provider] || 0) % keys.length;
  staticData.keyRotation[provider] = (cur + 1) % keys.length;
};

async function embedWithOpenAI(keys) {
  const maxAttempts = Math.min(keys.length, 6);
  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    const { key, idx } = rotateAndGet('openai', keys);
    if (!key) break;
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });

    if (resp.ok) {
      const body = await resp.json();
      const emb = body?.data?.[0]?.embedding;
      if (!Array.isArray(emb) || emb.length === 0) throw new Error('OpenAI вернул пустой embedding');
      return { provider: 'openai', key_slot: idx + 1, total_keys: keys.length, embedding: emb };
    }

    const errText = await resp.text();
    lastErr = `openai slot ${idx + 1}: HTTP ${resp.status} ${errText.slice(0, 300)}`;
    if (resp.status === 429 || resp.status === 402 || /rate|quota|limit/i.test(errText)) {
      advance('openai', keys);
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Нет рабочих OpenAI ключей');
}

async function embedWithOpenRouter(keys, model) {
  const maxAttempts = Math.min(keys.length, 6);
  let lastErr = null;
  for (let i = 0; i < maxAttempts; i++) {
    const { key, idx } = rotateAndGet('openrouter', keys);
    if (!key) break;
    const resp = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
      model: model || 'openai/text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
    });

    if (resp.ok) {
      const body = await resp.json();
      const emb = body?.data?.[0]?.embedding;
      if (!Array.isArray(emb) || emb.length === 0) throw new Error('OpenRouter вернул пустой embedding');
      return { provider: 'openrouter', key_slot: idx + 1, total_keys: keys.length, embedding: emb };
    }

    const errText = await resp.text();
    lastErr = `openrouter slot ${idx + 1}: HTTP ${resp.status} | debug=${JSON.stringify({
      model: model || 'openai/text-embedding-3-small',
      inputLength: text.slice(0, 8000).length,
      keySlot: idx + 1,
      totalKeys: keys.length,
      bodyPreview: String(errText).slice(0, 300),
    })}`;
    if (resp.status === 429 || resp.status === 402 || /rate|quota|limit/i.test(errText)) {
      advance('openrouter', keys);
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'Нет рабочих OpenRouter ключей');
}

let embedResult;
if (openaiPool.length) {
  embedResult = await embedWithOpenAI(openaiPool);
} else if (openrouterPool.length) {
  // Для endpoint /embeddings нужен embedding model, а не chat default model.
  embedResult = await embedWithOpenRouter(openrouterPool, 'openai/text-embedding-3-small');
} else {
  throw new Error('В service_settings нет openai_keys/openrouter_keys/api_key_groups для векторизации');
}

const vectorLiteral = `[${embedResult.embedding.map((v) => Number(v).toFixed(7)).join(',')}]`;

return [
  {
    ...$json,
    vector_literal: vectorLiteral,
    embedding_provider: embedResult.provider,
    embedding_key_slot: embedResult.key_slot,
    embedding_total_keys: embedResult.total_keys,
  },
];
