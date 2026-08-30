// n8n Code node: Apply Hermes Answer (+ failover на agent-api /api/v1/hermes/run)

async function fetchShim(url, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers || {}) };
  let body = init.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      /* as-is */
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
  const full = await this.helpers.httpRequest(opts);
  const statusCode = full.statusCode ?? full.status ?? 200;
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    json: async () => full.body,
    text: async () => (typeof full.body === 'string' ? full.body : JSON.stringify(full.body || {})),
  };
}

function sanitizeErr(text) {
  return String(text || '')
    .replace(/sk-or-[a-zA-Z0-9_-]+/gi, 'sk-or-***')
    .replace(/sk-[a-zA-Z0-9._-]{12,}/gi, 'sk-***')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function pickAnswer(body) {
  if (!body || typeof body !== 'object') return '';
  const candidates = [
    body.answer,
    body.output,
    body.text,
    body.response,
    body?.data?.answer,
    body?.data?.text,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return candidates[0] || '';
}

const src = $json || {};
const statusCode = Number(src.statusCode ?? src.status ?? 0) || 0;
const rawBody = src.body && typeof src.body === 'object' ? src.body : src;
const errBlob = String(
  src.error?.message || rawBody.error || rawBody.detail || rawBody.message || '',
).trim();

let answer = pickAnswer(rawBody);
let provider = String(rawBody.provider || 'hermes').trim();
let model = String(rawBody.model || rawBody.agent || 'hermes').trim();
let failoverUsed = false;

const detectItems = $items('Detect & Run Command', 0, 0) || [];
const detectJson = detectItems[0]?.json || {};
const base = { ...detectJson, ...src };

if (!answer && (statusCode >= 400 || /rate|402|429|exhausted|retry/i.test(errBlob))) {
  const agentBase = String($env.AUTORO_AGENT_API_BASE || $env.HERMES_AGENT_API_URL || '')
    .trim()
    .replace(/\/api\/v1\/hermes\/run\/?$/i, '')
    .replace(/\/+$/, '');
  const apiKey = String($env.HERMES_AGENT_API_KEY || $env.AGENT_API_KEY || '').trim();
  const failoverUrl = agentBase ? `${agentBase}/api/v1/hermes/run` : '';

  if (failoverUrl && apiKey) {
    const mode = String(base.command_mode || 'ask').toLowerCase();
    const tier =
      base.llm_tier ||
      (mode === 'research' ? 'reasoning' : mode === 'optimize' ? 'fast' : 'general');
    const prompt = String(
      base.command_prompt || base.original_text || base.text || '',
    ).trim();

    try {
      const resp = await fetchShim.call(this, failoverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-llm-tier': tier,
          'x-swoop-user-email': String(
            base.swoop_user_email || $env.SWOOP_LLM_USER_EMAIL || 'autoro.tech@gmail.com',
          ).trim(),
        },
        body: {
          chat_id: base.chat_id,
          mode,
          prompt,
          llm_tier: tier,
          llm_provider: base.llm_route_provider || null,
          llm_model: base.llm_route_model || null,
          swoop_user_email: String(
            base.swoop_user_email || $env.SWOOP_LLM_USER_EMAIL || 'autoro.tech@gmail.com',
          ).trim(),
          context: {
            update_id: base.update_id || null,
            message_id: base.message_id || null,
            username: base.username || null,
            hermes_failover: true,
          },
        },
      });
      if (resp.ok) {
        const body = await resp.json();
        const fb = pickAnswer(body);
        if (fb) {
          answer = fb.slice(0, 3900);
          provider = String(body.provider || 'swoop-routing').trim();
          model = String(body.model || '').trim() || 'routed';
          failoverUsed = true;
        }
      }
    } catch {
      /* failover failed — fall through */
    }
  }
}

if (!answer) {
  const hint = sanitizeErr(errBlob) || `HTTP ${statusCode || 'error'}`;
  return [
    {
      ...base,
      ai_answer: '',
      ai_answer_markdown: `*Ошибка LLM*\n\n${hint}\n\nПроверьте ключи в Swoop → Service settings и \`agent_llm_routing\`. Для Hermes укажите \`HERMES_AGENT_API_URL=…/api/v1/hermes/run\`.`,
      command_provider: 'hermes-error',
      command_model: 'none',
      hermes_failover_used: failoverUsed,
    },
  ];
}

return [
  {
    ...base,
    ai_answer: answer.slice(0, 3900),
    ai_answer_markdown: answer.slice(0, 3900),
    command_provider: failoverUsed ? `${provider}-failover` : provider,
    command_model: model,
    hermes_failover_used: failoverUsed,
  },
];
