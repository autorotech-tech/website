import http from "node:http";
import crypto from "node:crypto";
import { URL } from "node:url";
import { createTelegramAdapter, parseBotIdFromPath } from "./telegram/dist/handler.js";

const PORT = Number(process.env.PORT || 8080);

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Optional default n8n endpoint (fallback). Recommended approach for your current setup:
// one client = one workflow -> store n8n_webhook_url per bot in Supabase.
const N8N_WEBHOOK_URL_DEFAULT = process.env.N8N_WEBHOOK_URL || "";
// Optional: HMAC signature to protect your n8n webhook from direct calls.
const N8N_SHARED_SECRET = process.env.N8N_SHARED_SECRET || "";
const CHAT_PUSH_SECRET = process.env.CHAT_PUSH_SECRET || N8N_SHARED_SECRET || "";

const WIDGET_PUBLIC_URL = process.env.WIDGET_PUBLIC_URL || "https://chat.autoro.tech";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const SESSION_REPLY_TTL_MS = Number(process.env.SESSION_REPLY_TTL_MS || 86_400_000);
const MAX_MESSAGE_LEN = Number(process.env.MAX_MESSAGE_LEN || 500);

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 30_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 12);

// If set to "true", we require Origin/Referer to match allowed domains (when configured).
const ENFORCE_ALLOWED_DOMAINS = (process.env.ENFORCE_ALLOWED_DOMAINS || "true").toLowerCase() === "true";

// pquoc unified RAG: chat-gateway -> pquoc admin-api /internal/ask-phu-quoc
const PQUOC_ADMIN_INTERNAL_URL = String(
  process.env.PQUOC_ADMIN_INTERNAL_URL || process.env.PQUOC_RAG_INTERNAL_URL || ""
).replace(/\/$/, "");
const PQUOC_N8N_CALLBACK_SECRET = process.env.PQUOC_N8N_CALLBACK_SECRET || "";
const PQUOC_RAG_BOT_IDS = new Set(
  String(process.env.PQUOC_RAG_BOT_IDS || process.env.PQUOC_BOT_ID || "5a298eec-6b34-47ef-9ab1-48e30e6732a7")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const inMemoryRate = new Map(); // key -> { ts: number[], blockedUntil?: number }
/** @type {Map<string, { id: string, reply: string, at: number }[]>} */
const sessionReplyQueue = new Map(); // fallback when Supabase unavailable

const PQUOC_LOCALE_PREFIXES = new Set(["ru", "ko", "es", "it", "fr", "mn", "kz"]);

function pquocSiteUrl(lang) {
  const l = String(lang || "en").slice(0, 2).toLowerCase();
  if (PQUOC_LOCALE_PREFIXES.has(l)) return `https://pquoc.com/${l}/`;
  return "https://pquoc.com/";
}

/** Repair truncated https://pquoc. → https://pquoc.com (keep /locale paths). */
function fixBrokenPquocUrls(text, lang) {
  const site = pquocSiteUrl(lang).replace(/\/$/, "");
  return String(text ?? "").replace(
    /https?:\/\/(?:www\.)?pquoc\.(?!com\b)/gi,
    (match, offset, full) => {
      const rest = full.slice(offset + match.length);
      if (rest.startsWith("/")) return "https://pquoc.com";
      return site;
    }
  );
}

function nowMs() {
  return Date.now();
}

function json(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function text(res, statusCode, body, extraHeaders = {}) {
  const payload = String(body ?? "");
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function js(res, statusCode, body, extraHeaders = {}) {
  const payload = String(body ?? "");
  res.writeHead(statusCode, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function css(res, statusCode, body, extraHeaders = {}) {
  const payload = String(body ?? "");
  res.writeHead(statusCode, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=300",
    "Content-Length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

function readBody(req, limitBytes = 256_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on("data", (chunk) => {
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

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getRequestIp(req) {
  // nginx-proxy usually sets X-Forwarded-For.
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return xff || req.socket.remoteAddress || "unknown";
}

function getRequestOriginHost(req) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  const referer = req.headers.referer ? String(req.headers.referer) : "";
  const candidate = origin || referer;
  if (!candidate) return null;
  try {
    const u = new URL(candidate);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isSameOrSubdomain(host, allowed) {
  const h = host.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith("." + a);
}

function hmacSha256Hex(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

async function supabaseSelectAllowedDomains(botId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = new URL("/rest/v1/chat_agent_domains", SUPABASE_URL);
  url.searchParams.set("select", "domain");
  url.searchParams.set("bot_id", `eq.${botId}`);
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return null;
  return rows
    .map((r) => String(r?.domain || "").trim().toLowerCase())
    .filter(Boolean);
}

async function supabaseGetChatAgent(botId) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const fetchAgent = async (select) => {
    const url = new URL("/rest/v1/chat_agents", SUPABASE_URL);
    url.searchParams.set("select", select);
    url.searchParams.set("id", `eq.${botId}`);
    url.searchParams.set("limit", "1");
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0] || {};
  };
  const r =
    (await fetchAgent("id,status,default_lang,data_region,n8n_webhook_url,telegram_bot_token,bot_role")) ||
    (await fetchAgent("id,status,default_lang,data_region,n8n_webhook_url,telegram_bot_token"));
  if (!r) return null;
  return {
    id: String(r.id || ""),
    status: String(r.status || "active"),
    default_lang: String(r.default_lang || "en"),
    data_region: String(r.data_region || "global"),
    n8n_webhook_url: r.n8n_webhook_url ? String(r.n8n_webhook_url) : "",
    telegram_bot_token: r.telegram_bot_token ? String(r.telegram_bot_token) : "",
    bot_role: String(r.bot_role || "support") === "sales" ? "sales" : "support",
  };
}

async function supabasePatchChatAgent(botId, fields) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !botId || !fields) return false;
  const url = new URL("/rest/v1/chat_agents", SUPABASE_URL);
  url.searchParams.set("id", `eq.${botId}`);
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    console.error("patch chat_agent failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

function isPquocRagBot(botId) {
  return PQUOC_RAG_BOT_IDS.has(String(botId || "").trim());
}

async function forwardToPquocInternal(payloadObj) {
  if (!PQUOC_ADMIN_INTERNAL_URL || !PQUOC_N8N_CALLBACK_SECRET) {
    return { ok: false, status: 503, data: { reply: "" }, reason: "not_configured" };
  }

  const url = `${PQUOC_ADMIN_INTERNAL_URL}/internal/ask-phu-quoc`;
  const body = {
    message: payloadObj.message,
    lang: payloadObj.lang || payloadObj.detected_language || "en",
    session_id: payloadObj.session_id || payloadObj.session,
    platform: payloadObj.platform || "site",
    page_url: payloadObj.page_url || "",
    bot_id: payloadObj.bot_id,
  };
  const headers = {
    "Content-Type": "application/json",
    "x-pquoc-callback-secret": PQUOC_N8N_CALLBACK_SECRET,
  };

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const raw = await res.text();
    const data = safeParseJson(raw);
    if (!res.ok) {
      return { ok: false, status: res.status, data: { reply: "" }, debug: { raw: raw.slice(0, 500) } };
    }
    const reply = String(data?.reply ?? data?.answer ?? "").trim();
    return { ok: true, status: res.status, data: { reply, answer: reply, meta: data?.meta } };
  } catch (e) {
    return { ok: false, status: 502, data: { reply: "" }, error: String(e?.message || e) };
  }
}

async function resolveChatReply(botId, n8nWebhookUrl, payload) {
  if (isPquocRagBot(botId)) {
    const internal = await forwardToPquocInternal(payload);
    const internalReply = String(internal.data?.reply ?? "").trim();
    if (internal.ok && internalReply) return internal;
  }
  return forwardToN8n(n8nWebhookUrl, payload);
}

async function supabaseInsertChatMessage({ botId, sessionId, role, content, platform }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false;
  const url = new URL("/rest/v1/chat_messages", SUPABASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      bot_id: botId,
      session_id: sessionId,
      role,
      content,
      platform,
    }),
  });
  return res.ok;
}

async function supabasePollAssistantMessages({ botId, sessionId, sinceIso }) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const url = new URL("/rest/v1/chat_messages", SUPABASE_URL);
  url.searchParams.set(
    "select",
    "id,content,created_at"
  );
  url.searchParams.set("bot_id", `eq.${botId}`);
  url.searchParams.set("session_id", `eq.${sessionId}`);
  url.searchParams.set("role", "eq.assistant");
  if (sinceIso) {
    url.searchParams.set("created_at", `gt.${sinceIso}`);
  }
  url.searchParams.set("order", "created_at.asc");
  url.searchParams.set("limit", "20");
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({
    id: String(r.id || ""),
    reply: String(r.content || ""),
    at: String(r.created_at || ""),
  }));
}

function queueSessionReply(sessionId, reply) {
  const sid = String(sessionId || "").slice(0, 80);
  const text = String(reply || "").trim();
  if (!sid || !text) return null;
  const id = crypto.randomUUID();
  const at = nowMs();
  const bucket = sessionReplyQueue.get(sid) || [];
  bucket.push({ id, reply: text, at });
  sessionReplyQueue.set(sid, bucket);
  return { id, reply: text, at: new Date(at).toISOString() };
}

function pollSessionReplies(sessionId, sinceMs) {
  const sid = String(sessionId || "").slice(0, 80);
  const bucket = sessionReplyQueue.get(sid) || [];
  const cutoff = Number(sinceMs) || 0;
  const fresh = bucket.filter((m) => m.at > cutoff);
  // prune old
  const keep = bucket.filter((m) => nowMs() - m.at <= SESSION_REPLY_TTL_MS);
  if (keep.length) sessionReplyQueue.set(sid, keep);
  else sessionReplyQueue.delete(sid);
  return fresh.map((m) => ({ id: m.id, reply: m.reply, at: new Date(m.at).toISOString() }));
}

function verifyPushSecret(provided) {
  if (!CHAT_PUSH_SECRET) return true; // dev / legacy
  return String(provided || "") === CHAT_PUSH_SECRET;
}

function rateLimitOrNull({ botId, ip }) {
  const key = `${botId}::${ip}`;
  const n = nowMs();
  const bucket = inMemoryRate.get(key) || { ts: [], blockedUntil: 0 };
  if (bucket.blockedUntil && n < bucket.blockedUntil) return { retryAfterMs: bucket.blockedUntil - n };
  bucket.ts = bucket.ts.filter((t) => n - t <= RATE_LIMIT_WINDOW_MS);
  if (bucket.ts.length >= RATE_LIMIT_MAX) {
    bucket.blockedUntil = n + 10_000;
    inMemoryRate.set(key, bucket);
    return { retryAfterMs: 10_000 };
  }
  bucket.ts.push(n);
  inMemoryRate.set(key, bucket);
  return null;
}

function corsHeadersForOrigin(origin) {
  if (!origin) {
    return {
      "Access-Control-Allow-Origin": "null",
      Vary: "Origin",
    };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function getWidgetJs() {
  // Small, dependency-free widget. All HTML is created safely (no innerHTML for untrusted text).
  // Styling is loaded from /widget/chat-agent.css
  return `
(function(){
  function q(sel, root){ return (root||document).querySelector(sel); }
  function el(tag, attrs, children){
    var e = document.createElement(tag);
    if(attrs){
      Object.keys(attrs).forEach(function(k){
        var v = attrs[k];
        if(k === 'class') e.className = v;
        else if(k === 'text') e.textContent = v;
        else e.setAttribute(k, v);
      });
    }
    (children||[]).forEach(function(c){ e.appendChild(c); });
    return e;
  }

  function getBotId(){
    var s = document.currentScript;
    if(!s) s = document.querySelector('script[data-bot-id]');
    return s ? (s.getAttribute('data-bot-id')||'').trim() : '';
  }

  function getSessionId(){
    try{
      var k = 'autoro_chat_agent_sid';
      var v = localStorage.getItem(k);
      if(v) return v;
      var id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now())+'-'+Math.random().toString(16).slice(2);
      localStorage.setItem(k, id);
      return id;
    }catch(e){
      return String(Date.now())+'-'+Math.random().toString(16).slice(2);
    }
  }

  function getUtm(){
    var p = new URLSearchParams(location.search);
    function g(k){ return p.get(k) || ''; }
    return { source:g('utm_source'), medium:g('utm_medium'), campaign:g('utm_campaign'), content:g('utm_content'), term:g('utm_term') };
  }

  function loadCss(href){
    if(document.querySelector('link[data-chat-agent-css]')) return;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.setAttribute('data-chat-agent-css','1');
    document.head.appendChild(l);
  }

  function mount(){
    var botId = getBotId();
    if(!botId) return;

    loadCss('${WIDGET_PUBLIC_URL}/widget/chat-agent.css');

    var root = el('div', { class:'ca-root', 'data-bot-id': botId });
    var overlay = el('div', { class:'ca-overlay' });
    var modal = el('div', { class:'ca-modal', role:'dialog', 'aria-label':'Chat Agent' });
    var header = el('div', { class:'ca-header' }, [
      el('div', { class:'ca-title', text:'Chat Agent' }),
      el('button', { class:'ca-close', type:'button', 'aria-label':'Close', text:'×' })
    ]);
    var body = el('div', { class:'ca-body' });
    var messages = el('div', { class:'ca-messages' });
    body.appendChild(messages);
    var footer = el('div', { class:'ca-footer' });
    var input = el('input', { class:'ca-input', type:'text', placeholder:'Type your question…', maxlength:'500', autocomplete:'off' });
    var send = el('button', { class:'ca-send', type:'button', text:'Send' });
    footer.appendChild(input); footer.appendChild(send);
    modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);
    var toggle = el('button', { class:'ca-toggle', type:'button', 'aria-label':'Open chat' }, [
      el('span', { class:'ca-toggle-dot' })
    ]);

    root.appendChild(overlay);
    root.appendChild(modal);
    root.appendChild(toggle);
    document.body.appendChild(root);

    function open(){ root.classList.add('open'); input.focus(); }
    function close(){ root.classList.remove('open'); }
    overlay.addEventListener('click', close);
    q('.ca-close', root).addEventListener('click', close);
    toggle.addEventListener('click', open);

    function addMsg(text, who){
      var m = el('div', { class:'ca-msg '+who });
      m.textContent = text;
      messages.appendChild(m);
      messages.scrollTop = messages.scrollHeight;
      return m;
    }

    addMsg('Hi! Ask me anything about this site.', 'bot');

    var inFlight = false;
    async function sendMessage(){
      if(inFlight) return;
      var t = (input.value||'').trim();
      if(!t) return;
      if(t.length > ${MAX_MESSAGE_LEN}) t = t.slice(0, ${MAX_MESSAGE_LEN});
      addMsg(t, 'user');
      input.value = '';
      var pending = addMsg('Thinking…', 'bot');
      inFlight = true;
      try{
        var payload = {
          bot_id: botId,
          session_id: getSessionId(),
          message: t,
          page_url: location.href,
          referrer: document.referrer || '',
          utm: getUtm(),
          lang: (document.documentElement.getAttribute('lang')||navigator.language||'en').slice(0,2),
          tz: (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : '',
          userAgent: navigator.userAgent
        };
        var r = await fetch('${WIDGET_PUBLIC_URL}/v1/chat-agent/message', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body: JSON.stringify(payload)
        });
        var data = null;
        try{ data = await r.json(); }catch(e){}
        if(r.ok && data && typeof data.reply === 'string'){
          pending.textContent = data.reply;
        }else{
          pending.textContent = 'Sorry — please try again.';
        }
      }catch(e){
        pending.textContent = 'Network error — please try again.';
      }finally{
        inFlight = false;
      }
    }

    send.addEventListener('click', sendMessage);
    input.addEventListener('keydown', function(e){
      if(e.key === 'Enter'){ e.preventDefault(); sendMessage(); }
    });
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
`;
}

function getWidgetCss() {
  return `
.ca-root{ position:fixed; right:18px; bottom:18px; z-index:2147483000; font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial; }
.ca-toggle{ width:56px; height:56px; border-radius:999px; border:0; cursor:pointer; background:#0f172a; color:#fff; box-shadow:0 12px 30px rgba(0,0,0,.18); display:flex; align-items:center; justify-content:center; }
.ca-toggle:hover{ background:#111c33; }
.ca-toggle-dot{ width:18px; height:18px; border-radius:6px; background:#fff; display:block; }
.ca-overlay{ display:none; position:fixed; inset:0; background:rgba(15,23,42,.45); }
.ca-modal{ display:none; position:fixed; right:18px; bottom:86px; width:min(380px, calc(100vw - 36px)); height:min(520px, calc(100vh - 140px)); background:#fff; border-radius:14px; box-shadow:0 24px 80px rgba(0,0,0,.25); overflow:hidden; border:1px solid rgba(15,23,42,.08); }
.ca-root.open .ca-overlay{ display:block; }
.ca-root.open .ca-modal{ display:flex; flex-direction:column; }
.ca-root.open .ca-toggle{ display:none; }
.ca-header{ padding:12px 14px; display:flex; align-items:center; justify-content:space-between; background:#0f172a; color:#fff; }
.ca-title{ font-weight:600; font-size:14px; letter-spacing:.2px; }
.ca-close{ border:0; background:transparent; color:#fff; font-size:22px; line-height:1; cursor:pointer; padding:0 6px; }
.ca-body{ flex:1; background:#f8fafc; overflow:auto; padding:12px; }
.ca-messages{ display:flex; flex-direction:column; gap:10px; }
.ca-msg{ max-width:85%; padding:10px 12px; border-radius:12px; font-size:13px; white-space:pre-wrap; word-break:break-word; }
.ca-msg.user{ margin-left:auto; background:#2563eb; color:#fff; border-bottom-right-radius:4px; }
.ca-msg.bot{ margin-right:auto; background:#fff; color:#0f172a; border:1px solid rgba(15,23,42,.08); border-bottom-left-radius:4px; }
.ca-footer{ display:flex; gap:10px; padding:12px; border-top:1px solid rgba(15,23,42,.08); background:#fff; }
.ca-input{ flex:1; border:1px solid rgba(15,23,42,.18); border-radius:10px; padding:10px 12px; font-size:13px; outline:none; }
.ca-input:focus{ border-color:#2563eb; box-shadow:0 0 0 3px rgba(37,99,235,.15); }
.ca-send{ border:0; border-radius:10px; padding:10px 14px; cursor:pointer; background:#0f172a; color:#fff; font-size:13px; font-weight:600; }
.ca-send:hover{ background:#111c33; }
`;
}

async function forwardToN8n(n8nWebhookUrl, payloadObj) {
  if (!n8nWebhookUrl) {
    return { ok: false, status: 500, data: { reply: "Chat backend is not configured." } };
  }

  const payload = JSON.stringify(payloadObj);
  const headers = { "Content-Type": "application/json" };
  if (N8N_SHARED_SECRET) {
    // Deterministic signature that can be verified inside n8n without needing raw request body.
    const sigPayload = `${payloadObj.bot_id}\n${payloadObj.session_id}\n${payloadObj.message}`;
    headers["X-Chat-Agent-Signature"] = hmacSha256Hex(N8N_SHARED_SECRET, sigPayload);
    headers["X-Chat-Agent-Signature-V"] = "v1";
  }

  const res = await fetch(n8nWebhookUrl, { method: "POST", headers, body: payload });
  const ct = String(res.headers.get("content-type") || "");
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, data: { reply: "Sorry — try again later." }, debug: { ct, raw: raw.slice(0, 500) } };
  }
  const data = safeParseJson(raw) || { reply: raw };
  if (data && typeof data.reply === "string") return { ok: true, status: res.status, data };
  if (typeof data === "string") return { ok: true, status: res.status, data: { reply: data } };
  return { ok: true, status: res.status, data: { reply: "Thanks! We'll get back to you shortly." } };
}

async function handleChat(req, res) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  const originHost = getRequestOriginHost(req);

  const rawBody = await readBody(req).catch((e) => {
    if (e?.code === "BODY_TOO_LARGE") return null;
    return null;
  });
  if (!rawBody) return json(res, 413, { error: "Body too large" }, corsHeadersForOrigin(origin));

  const body = safeParseJson(rawBody);
  if (!body || typeof body !== "object") return json(res, 400, { error: "Invalid JSON" }, corsHeadersForOrigin(origin));

  const botId = String(body.bot_id || body.botId || "").trim();
  const message = String(body.message || "").trim();
  if (!botId) return json(res, 400, { error: "bot_id is required" }, corsHeadersForOrigin(origin));
  if (!message) return json(res, 400, { error: "message is required" }, corsHeadersForOrigin(origin));

  const agent = await supabaseGetChatAgent(botId);
  if (!agent) return json(res, 404, { error: "Bot not found" }, corsHeadersForOrigin(origin));
  if (agent.status && agent.status !== "active") return json(res, 403, { error: "Bot disabled" }, corsHeadersForOrigin(origin));

  const trimmedMsg = message.length > MAX_MESSAGE_LEN ? message.slice(0, MAX_MESSAGE_LEN) : message;
  const ip = getRequestIp(req);

  const rl = rateLimitOrNull({ botId, ip });
  if (rl) {
    return json(
      res,
      429,
      { error: "Too many requests" },
      { ...corsHeadersForOrigin(origin), "Retry-After": String(Math.ceil(rl.retryAfterMs / 1000)) }
    );
  }

  // Allowed domains check (best-effort).
  // Behavior:
  // - if ENFORCE=true and we have configured domains -> require match
  // - if no domains configured -> allow (MVP-friendly)
  // - if no origin host -> block when enforce=true and domains exist
  let allowedDomains = null;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    allowedDomains = await supabaseSelectAllowedDomains(botId);
  }

  if (ENFORCE_ALLOWED_DOMAINS && Array.isArray(allowedDomains) && allowedDomains.length > 0) {
    if (!originHost) {
      return json(res, 403, { error: "Forbidden (missing Origin/Referer)" }, corsHeadersForOrigin(origin));
    }
    const ok = allowedDomains.some((d) => isSameOrSubdomain(originHost, d));
    if (!ok) return json(res, 403, { error: "Forbidden (domain not allowed)" }, corsHeadersForOrigin(origin));
  }

  const payload = {
    bot_id: botId,
    // Compatibility: some n8n templates expect `session`
    session: String(body.session_id || body.session || "").slice(0, 80),
    session_id: String(body.session_id || body.session || "").slice(0, 80),
    message: trimmedMsg,
    // Compatibility: some n8n templates expect `text/chat_id/platform/detected_language`
    text: trimmedMsg,
    chat_id: String(body.session_id || body.session || "").slice(0, 80),
    platform: "site",
    detected_language: String(body.lang || "").slice(0, 12),
    // context
    page_url: String(body.page_url || "").slice(0, 2000),
    referrer: String(body.referrer || "").slice(0, 2000),
    utm: body.utm && typeof body.utm === "object" ? body.utm : {},
    lang: String(body.lang || "").slice(0, 12),
    tz: String(body.tz || "").slice(0, 64),
    userAgent: String(body.userAgent || "").slice(0, 300),
    // gateway context (useful for anti-abuse)
    ip,
    origin_host: originHost,
    received_at: new Date().toISOString(),
  };

  const n8nWebhookUrl = agent.n8n_webhook_url || N8N_WEBHOOK_URL_DEFAULT;
  // Persist user message (best-effort, for operator thread + poll fallback)
  supabaseInsertChatMessage({
    botId,
    sessionId: payload.session_id,
    role: "user",
    content: trimmedMsg,
    platform: "site",
  }).catch(() => {});

  const out = await resolveChatReply(botId, n8nWebhookUrl, payload);
  const reply =
    fixBrokenPquocUrls(String(out.data?.reply ?? "").trim(), payload.lang) ||
    "Спасибо! Мы получили ваш вопрос и скоро ответим.";
  return json(res, out.ok ? 200 : 502, { reply }, corsHeadersForOrigin(origin));
}

async function handlePushReply(req, res) {
  const rawBody = await readBody(req).catch(() => null);
  if (!rawBody) return json(res, 413, { error: "Body too large" });

  const body = safeParseJson(rawBody);
  if (!body || typeof body !== "object") return json(res, 400, { error: "Invalid JSON" });

  const secret = String(body.secret || req.headers["x-chat-push-secret"] || "");
  if (!verifyPushSecret(secret)) return json(res, 403, { error: "Forbidden" });

  const botId = String(body.bot_id || body.botId || "").trim();
  const sessionId = String(body.session_id || body.session || "").slice(0, 80);
  const reply = String(body.reply || body.message || "").trim();
  if (!botId || !sessionId || !reply) {
    return json(res, 400, { error: "bot_id, session_id and reply are required" });
  }

  const agent = await supabaseGetChatAgent(botId);
  if (!agent) return json(res, 404, { error: "Bot not found" });

  const trimmed = reply.length > MAX_MESSAGE_LEN ? reply.slice(0, MAX_MESSAGE_LEN) : reply;
  const stored = await supabaseInsertChatMessage({
    botId,
    sessionId,
    role: "assistant",
    content: trimmed,
    platform: "telegram",
  });
  const queued = queueSessionReply(sessionId, trimmed);
  return json(res, 200, { ok: true, stored, queued: Boolean(queued) });
}

async function handlePoll(req, res, searchParams) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  const botId = String(searchParams.get("bot_id") || searchParams.get("botId") || "").trim();
  const sessionId = String(searchParams.get("session_id") || searchParams.get("session") || "").slice(0, 80);
  const since = String(searchParams.get("since") || "").trim();
  const sinceMs = Number(searchParams.get("since_ms") || 0);

  if (!botId || !sessionId) {
    return json(res, 400, { error: "bot_id and session_id are required" }, corsHeadersForOrigin(origin));
  }

  const agent = await supabaseGetChatAgent(botId);
  if (!agent) return json(res, 404, { error: "Bot not found" }, corsHeadersForOrigin(origin));

  let messages = await supabasePollAssistantMessages({ botId, sessionId, sinceIso: since || undefined });
  if (!messages) {
    messages = pollSessionReplies(sessionId, sinceMs);
  }
  return json(res, 200, { messages: messages || [] }, corsHeadersForOrigin(origin));
}

const telegram = createTelegramAdapter(
  {
    getChatAgent: supabaseGetChatAgent,
    patchChatAgent: supabasePatchChatAgent,
    insertChatMessage: supabaseInsertChatMessage,
    isPquocRagBot,
    forwardToPquocInternal,
    forwardToN8n,
    fixBrokenPquocUrls,
    n8nWebhookUrlDefault: N8N_WEBHOOK_URL_DEFAULT,
    widgetPublicUrl: WIDGET_PUBLIC_URL,
    telegramWebhookSecret: TELEGRAM_WEBHOOK_SECRET,
  },
  { text, json },
);

async function handleTelegramWebhook(req, res, botId) {
  return telegram.handleWebhook(req, res, botId);
}

async function handleTelegramSetup(req, res, botId) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  return telegram.handleSetup(req, res, botId, corsHeadersForOrigin(origin));
}

async function handleTelegramStatus(req, res, botId) {
  const origin = req.headers.origin ? String(req.headers.origin) : "";
  return telegram.handleStatus(req, res, botId, corsHeadersForOrigin(origin));
}

async function handleWhatsAppWebhook(req, res, searchParams) {
  if (req.method === "GET") {
    const mode = searchParams.get("hub.mode");
    const challenge = searchParams.get("hub.challenge");
    if (mode === "subscribe" && challenge) {
      return text(res, 200, challenge);
    }
    return text(res, 403, "Forbidden");
  }

  const botId = searchParams.get("bot_id");
  if (!botId) return text(res, 400, "Missing bot_id");

  const rawBody = await readBody(req).catch(() => null);
  if (!rawBody) return text(res, 413, "Body too large");

  const body = safeParseJson(rawBody);
  if (!body) return text(res, 400, "Invalid JSON");

  text(res, 200, "OK");

  try {
    const entry = body.entry && body.entry[0];
    const changes = entry && entry.changes && entry.changes[0];
    const value = changes && changes.value;
    const messages = value && value.messages;
    
    if (!messages || !messages[0] || !messages[0].text) return;
    
    const msgObj = messages[0];
    const fromPhone = msgObj.from;
    const msgText = msgObj.text.body;

    const agent = await supabaseGetChatAgent(botId);
    if (!agent || (agent.status && agent.status !== "active")) return;

    const payload = {
      bot_id: botId,
      session_id: String(fromPhone),
      message: String(msgText).trim(),
      platform: "whatsapp",
      lang: "en",
      received_at: new Date().toISOString(),
    };

    const n8nWebhookUrl = agent.n8n_webhook_url || N8N_WEBHOOK_URL_DEFAULT;
    forwardToN8n(n8nWebhookUrl, payload).catch(console.error);
  } catch (e) {
    console.error("WhatsApp parse error", e);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const path = u.pathname;

    // health
    if (req.method === "GET" && path === "/health") return text(res, 200, "ok");

    // widget static
    if (req.method === "GET" && path === "/widget/chat-agent.js") return js(res, 200, getWidgetJs());
    if (req.method === "GET" && path === "/widget/chat-agent.css") return css(res, 200, getWidgetCss());

    // Telegram webhook (query bot_id + path alias /v1/telegram/webhook/:botId)
    if (req.method === "POST" && path.startsWith("/v1/chat-agent/telegram/webhook")) {
      const botId = u.searchParams.get("bot_id");
      return await handleTelegramWebhook(req, res, botId);
    }
    if (req.method === "POST" && path.startsWith("/v1/telegram/webhook/")) {
      const botId = parseBotIdFromPath(path);
      return await handleTelegramWebhook(req, res, botId);
    }

    if (req.method === "OPTIONS" && (
      path === "/v1/chat-agent/telegram/setup" ||
      path === "/v1/chat-agent/telegram/status" ||
      path.startsWith("/v1/telegram/setup/") ||
      path.startsWith("/v1/telegram/status/")
    )) {
      const origin = req.headers.origin ? String(req.headers.origin) : "";
      res.writeHead(204, {
        ...corsHeadersForOrigin(origin),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }
    if (req.method === "POST" && path === "/v1/chat-agent/telegram/setup") {
      const botId = u.searchParams.get("bot_id");
      return await handleTelegramSetup(req, res, botId);
    }
    if (req.method === "POST" && path.startsWith("/v1/telegram/setup/")) {
      const botId = parseBotIdFromPath(path);
      return await handleTelegramSetup(req, res, botId);
    }
    if (req.method === "GET" && path === "/v1/chat-agent/telegram/status") {
      const botId = u.searchParams.get("bot_id");
      return await handleTelegramStatus(req, res, botId);
    }
    if (req.method === "GET" && path.startsWith("/v1/telegram/status/")) {
      const botId = parseBotIdFromPath(path);
      return await handleTelegramStatus(req, res, botId);
    }

    // WhatsApp webhook
    if (path.startsWith("/v1/chat-agent/whatsapp/webhook")) {
      return await handleWhatsAppWebhook(req, res, u.searchParams);
    }

    // CORS preflight
    if (req.method === "OPTIONS" && (path === "/v1/chat-agent/message" || path === "/v1/chat-agent/poll")) {
      const origin = req.headers.origin ? String(req.headers.origin) : "";
      res.writeHead(204, {
        ...corsHeadersForOrigin(origin),
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Chat-Push-Secret",
        "Access-Control-Max-Age": "600",
      });
      return res.end();
    }

    if (req.method === "POST" && path === "/v1/chat-agent/push-reply") {
      return await handlePushReply(req, res);
    }

    if (req.method === "GET" && path === "/v1/chat-agent/poll") {
      return await handlePoll(req, res, u.searchParams);
    }

    if (req.method === "POST" && path === "/v1/chat-agent/message") {
      return await handleChat(req, res);
    }

    return text(res, 404, "Not Found");
  } catch (e) {
    // Avoid leaking request body / PII.
    return text(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`chat-gateway listening on :${PORT}`);
});


