const JR_API = (() => {
  // Тестовый режим: без login/JWT. Выключить: jrTestMode=false в chrome.storage.local
  const DEFAULT_API_BASE = 'https://swoop.autoro.tech';
  const DEFAULT_TEST_WORKSPACE_ID = '1';

  function normalizeApiBase(apiBase) {
    return String(apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
  }

  async function isTestMode() {
    const saved = await chrome.storage.local.get(['jrTestMode']);
    if (saved.jrTestMode === false || saved.jrTestMode === '0') return false;
    return true;
  }

  function networkFailMessage(kind, url, detail) {
    const path = String(url || '').split('?')[0];
    const hint =
      kind === 'relevance'
        ? 'Проверьте сеть и что API доступен (swoop.autoro.tech). Затем Reload расширения.'
        : 'Проверьте сеть / VPN и базовый URL API, затем повторите.';
    const extra = detail && !/failed to fetch/i.test(detail) ? ` (${detail})` : '';
    return `Нет ответа от сервера${extra}: ${path}. ${hint}`;
  }

  /** Prefer service-worker fetch (host_permissions); fall back to page fetch. */
  async function rawFetchViaExtension(url, fetchOpts, timeoutMs) {
    const canMessage = typeof chrome !== 'undefined' && chrome.runtime?.sendMessage;
    const body = fetchOpts.body;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    // FormData cannot reliably cross the extension message boundary.
    if (canMessage && !isFormData) {
      const headers =
        fetchOpts.headers && typeof fetchOpts.headers === 'object' && !(fetchOpts.headers instanceof Headers)
          ? { ...fetchOpts.headers }
          : fetchOpts.headers
            ? Object.fromEntries(new Headers(fetchOpts.headers).entries())
            : undefined;
      const proxied = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            {
              type: 'JR_FETCH_JSON',
              url,
              timeoutMs,
              options: {
                method: fetchOpts.method || 'GET',
                headers,
                body: body || undefined,
              },
            },
            (resp) => {
              if (chrome.runtime.lastError) {
                resolve({ proxyError: chrome.runtime.lastError.message });
                return;
              }
              resolve(resp || { proxyError: 'empty proxy response' });
            }
          );
        } catch (err) {
          resolve({ proxyError: String(err?.message || err) });
        }
      });
      if (proxied && !proxied.proxyError) return proxied;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...fetchOpts, signal: controller.signal });
      const raw = await response.text();
      let data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText || '',
        raw,
        data,
      };
    } catch (err) {
      const name = err && err.name ? String(err.name) : '';
      return {
        ok: false,
        aborted: name === 'AbortError' || name === 'TimeoutError',
        error: err && err.message ? String(err.message) : String(err || 'network error'),
        errorName: name,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchJson(url, options = {}) {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000;
    const errorKind = options.errorKind || inferErrorKind(url);
    const retries = Number(options.retries) >= 0 ? Number(options.retries) : errorKind === 'relevance' ? 1 : 0;
    const { timeoutMs: _ignored, errorKind: _kindIgnored, retries: _retriesIgnored, ...fetchOpts } = options;

    let lastFail = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const result = await rawFetchViaExtension(url, fetchOpts, timeoutMs);
      if (result.aborted) {
        throw new Error(localTimeoutMessage(errorKind, timeoutMs));
      }
      if (!result.ok || result.proxyError) {
        lastFail = result.error || result.proxyError || 'Failed to fetch';
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
          continue;
        }
        throw new Error(networkFailMessage(errorKind, url, lastFail));
      }
      const status = Number(result.status) || 0;
      const raw = result.raw || '';
      const data = result.data;
      if (status < 200 || status >= 300) {
        throw new Error(formatApiError(status, data, raw, url, errorKind));
      }
      if (data == null && looksLikeHtml(raw)) {
        throw new Error(gatewayMessage(status, errorKind));
      }
      return data || {};
    }
    throw new Error(networkFailMessage(errorKind, url, lastFail));
  }

  function inferErrorKind(url) {
    const u = String(url || '');
    if (/file-capture|drive-import|text-capture|link-capture|\/patch|\/capture/i.test(u)) return 'upload';
    if (/\/generate/i.test(u)) return 'generate';
    if (/\/relevance/i.test(u)) return 'relevance';
    return 'generic';
  }

  function looksLikeHtml(raw) {
    const s = String(raw || '').trim();
    if (!s) return false;
    return (
      /^<!DOCTYPE html/i.test(s) ||
      /^<html[\s>]/i.test(s) ||
      /^<head[\s>]/i.test(s) ||
      /<title[^>]*>[^<]*(502|504|524|error|cloudflare)/i.test(s) ||
      /cloudflare/i.test(s) && /<\/html>/i.test(s) ||
      /502 Bad Gateway/i.test(s) ||
      /Error code (502|504|524)/i.test(s)
    );
  }

  function stripHtmlSnippet(raw) {
    return String(raw || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  function localTimeoutMessage(kind, timeoutMs) {
    const sec = Math.round(timeoutMs / 1000);
    if (kind === 'generate') {
      return (
        `Генерация прервана через ${sec}с: сервер не успел ответить. ` +
        'Нажмите «Отклик» ещё раз - обычно со второго раза быстрее.'
      );
    }
    if (kind === 'upload') {
      return (
        `Загрузка прервана локально через ${sec}с. ` +
        'Нажмите «Обновить sources» - файл мог уже сохраниться. Если нет, повторите загрузку.'
      );
    }
    return `Таймаут ${sec}с: сервер не ответил вовремя.`;
  }

  function gatewayMessage(status, kind) {
    const code = status || 502;
    if (kind === 'generate') {
      return (
        `Шлюз оборвал генерацию (HTTP ${code}, ответ не JSON). ` +
        'Нажмите «Отклик» ещё раз - обычно помогает.'
      );
    }
    if (kind === 'upload') {
      return (
        `Шлюз оборвал загрузку (HTTP ${code}). Нажмите «Обновить sources» - файл мог сохраниться. ` +
        'Если списка нет, загрузите ещё раз.'
      );
    }
    if (kind === 'relevance') {
      return (
        `Сервер оценки не ответил (HTTP ${code}). ` +
        'Нажмите «Оценить предложение» ещё раз.'
      );
    }
    return `Сервер не ответил (HTTP ${code}). Повторите попытку.`;
  }

  /** Strip provider/model names from user-visible API errors. */
  function sanitizeUserError(text) {
    let t = String(text || '');
    t = t.replace(/\s*Провайдеры?:\s*[^.]+/gi, '');
    t = t.replace(
      /\b(gemini_rag|openmodel|openrouter|gemini|glm|groq|lmarena|mimo|kimi)(:[^\s;,.]+)?/gi,
      ''
    );
    t = t.replace(/\b(timeout>\d+s|budget_exhausted|no_time|skipped_\w+)/gi, '');
    t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,;])/g, '$1').trim();
    return t;
  }

  function formatApiError(status, data, raw, url, kind = 'generic') {
    if (
      status === 502 ||
      status === 504 ||
      status === 524 ||
      status === 408 ||
      (status >= 520 && status <= 530) ||
      looksLikeHtml(raw)
    ) {
      return gatewayMessage(status, kind);
    }
    let detail = '';
    if (data?.message && typeof data.message === 'string') detail = data.message;
    else if (data?.detail != null) {
      if (typeof data.detail === 'string') detail = data.detail;
      else if (Array.isArray(data.detail)) {
        detail = data.detail
          .map((item) => {
            if (!item) return '';
            if (typeof item === 'string') return item;
            return item.msg || JSON.stringify(item);
          })
          .filter(Boolean)
          .join('; ');
      } else {
        detail = JSON.stringify(data.detail);
      }
    }
    if (looksLikeHtml(detail)) return gatewayMessage(status, kind);
    if (!detail) {
      const clipped = stripHtmlSnippet(raw) || `HTTP ${status}`;
      if (looksLikeHtml(raw)) return gatewayMessage(status, kind);
      detail = clipped;
    }
    if (status === 404 || /^not found$/i.test(detail)) {
      return (
        `API 404: маршрут не найден (${String(url || '').split('?')[0]}). ` +
        'Нужен redeploy agent-api (job_responder.py) на swoop.autoro.tech, затем Reload расширения.'
      );
    }
    if (status === 413 || /file_too_large/i.test(detail)) {
      return `Файл слишком большой (лимит 12 МБ). ${detail}`;
    }
    if (status === 422) {
      return sanitizeUserError(detail);
    }
    return sanitizeUserError(`${detail} (HTTP ${status})`);
  }

  async function getApiBase() {
    const saved = await chrome.storage.local.get(['jrApiBase']);
    return normalizeApiBase(saved.jrApiBase);
  }

  async function getAuthHeaders(forFormData = false) {
    const headers = {};
    if (!forFormData) headers['Content-Type'] = 'application/json';

    if (await isTestMode()) {
      return headers;
    }

    const saved = await chrome.storage.local.get(['userAccessToken', 'userRefreshToken', 'userTokenExpiresAt']);
    const now = Math.floor(Date.now() / 1000);
    let token = String(saved.userAccessToken || '');
    const expires = Number(saved.userTokenExpiresAt || 0);
    if ((!token || expires <= now + 60) && saved.userRefreshToken) {
      const apiBase = await getApiBase();
      const refreshed = await fetchJson(`${apiBase}/api/v1/bookmarks/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: String(saved.userRefreshToken) }),
      });
      token = String(refreshed.accessToken || '');
      await chrome.storage.local.set({
        userAccessToken: token,
        userRefreshToken: String(refreshed.refreshToken || saved.userRefreshToken),
        userTokenExpiresAt: refreshed.expiresIn ? now + Number(refreshed.expiresIn) : 0,
      });
    }
    if (!token) throw new Error('Нужен вход (email/password)');
    headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async function ensureWorkspace() {
    if (await isTestMode()) {
      const saved = await chrome.storage.local.get(['jrWorkspaceId']);
      const workspaceId = String(saved.jrWorkspaceId || DEFAULT_TEST_WORKSPACE_ID);
      await chrome.storage.local.set({ jrWorkspaceId: workspaceId });
      return workspaceId;
    }
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const data = await fetchJson(`${apiBase}/api/v1/bookmarks/workspaces/ensure`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
    const workspaceId = data?.workspaceId != null ? String(data.workspaceId) : '';
    if (!workspaceId) throw new Error('workspaceId missing');
    await chrome.storage.local.set({ jrWorkspaceId: workspaceId });
    return workspaceId;
  }

  async function getWorkspaceId() {
    const saved = await chrome.storage.local.get(['jrWorkspaceId']);
    if (saved.jrWorkspaceId) return String(saved.jrWorkspaceId);
    return ensureWorkspace();
  }

  async function setWorkspaceId(workspaceId) {
    const id = String(workspaceId || DEFAULT_TEST_WORKSPACE_ID).trim() || DEFAULT_TEST_WORKSPACE_ID;
    await chrome.storage.local.set({ jrWorkspaceId: id });
    return id;
  }

  async function resumeStatus() {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(
      `${apiBase}/api/v1/job-responder/resume/status?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers }
    );
  }

  async function listSources() {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(
      `${apiBase}/api/v1/job-responder/resume/sources?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers }
    );
  }

  async function resumeCapture({ title, text, kind = 'job_resume', category = 'cv' }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, title, text, kind, category }),
    });
  }

  async function resumeFileCapture({ file, title, kind = 'job_resume', category = 'cv' }) {
    const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`${file.name || 'file'}: больше 12 МБ`);
    }
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders(true);
    const workspaceId = await getWorkspaceId();

    const form = new FormData();
    form.append('workspaceId', workspaceId);
    form.append('kind', kind);
    form.append('category', category);
    if (title) form.append('title', title);
    form.append('file', file, file.name || 'upload.bin');

    return fetchJson(`${apiBase}/api/v1/job-responder/resume/file-capture`, {
      method: 'POST',
      headers,
      body: form,
      timeoutMs: 50000,
      errorKind: 'upload',
    });
  }

  async function resumeTextCapture({ text, title, kind = 'job_experience', category = 'notes' }) {
    if (!text || String(text).trim().length < 20) {
      throw new Error('Текст слишком короткий (мин. 20 символов)');
    }
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/text-capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        text: String(text).trim(),
        title: title || undefined,
        kind,
        category,
      }),
      timeoutMs: 45000,
    });
  }

  async function resumePatch({ text, title } = {}) {
    const body = String(text || '').trim();
    if (body.length < 3) {
      throw new Error('Текст слишком короткий (мин. 3 символа)');
    }
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/patch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        text: body,
        title: title || undefined,
      }),
      timeoutMs: 45000,
      errorKind: 'upload',
    });
  }

  async function resumeOptimize({ syncGemini = true } = {}) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/optimize`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, syncGemini: Boolean(syncGemini) }),
      timeoutMs: 60000,
      errorKind: 'upload',
    });
  }

  async function resumeLinkCapture({ url, title, kind = 'job_experience', category = 'link' }) {
    if (!url) throw new Error('url is required');
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/link-capture`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, url, title, kind, category }),
      timeoutMs: 40000,
    });
  }

  async function driveImport({ folderUrlOrId, accessToken, kind = 'job_experience', category = 'drive' }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/drive-import`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        folderUrlOrId,
        accessToken: accessToken || undefined,
        kind,
        category,
      }),
      timeoutMs: 90000,
    });
  }

  async function scoreRelevance({
    vacancy,
    selectedSourceIds = [],
    effectivenessPrompt,
    useLlmEffectiveness,
  }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    const eff = String(effectivenessPrompt || '').trim();
    return fetchJson(`${apiBase}/api/v1/job-responder/relevance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        vacancy,
        selectedSourceIds,
        ...(eff ? { effectivenessPrompt: eff } : {}),
        ...(useLlmEffectiveness === true ? { useLlmEffectiveness: true } : {}),
      }),
      timeoutMs: 30000,
      errorKind: 'relevance',
      retries: 1,
    });
  }

  async function scoreRelevanceBatch({ vacancies = [], selectedSourceIds = [] }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/relevance/batch`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, vacancies, selectedSourceIds }),
      timeoutMs: 60000,
      errorKind: 'relevance',
      retries: 1,
    });
  }

  function fetchVacancyListFromTab({ windowId, tabId } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'JR_GET_VACANCY_LIST', windowId, tabId },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Не удалось прочитать список'));
            return;
          }
          if (!resp?.ok) {
            reject(new Error(resp?.error || 'Список вакансий не найден'));
            return;
          }
          resolve(resp);
        }
      );
    });
  }

  function injectListBadges({ scores, tabId, windowId } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'JR_INJECT_LIST_BADGES', scores: scores || [], tabId, windowId },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message || 'Не удалось вставить бейджи'));
            return;
          }
          if (!resp?.ok) {
            reject(new Error(resp?.error || 'Inject failed'));
            return;
          }
          resolve(resp);
        }
      );
    });
  }

  function copyTextViaBackground(text) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'JR_COPY_TEXT', text: String(text || '') }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Clipboard bridge failed'));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || 'Не удалось скопировать'));
          return;
        }
        resolve(resp);
      });
    });
  }

  async function geminiRagStatus() {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(
      `${apiBase}/api/v1/job-responder/gemini-rag/status?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers, timeoutMs: 20000 }
    );
  }

  async function geminiRagSync({ poll = true } = {}) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/gemini-rag/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, poll }),
      timeoutMs: poll ? 120000 : 20000,
    });
  }

  async function generateResponse({
    mode,
    host,
    vacancy,
    selectedSourceIds = [],
    coverTemplate,
    baseLetter,
    promptExtra,
    customInstructions,
    profileOverrides,
    useGeminiRag,
    effectivenessPrompt,
    useLlmEffectiveness,
  }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    const template = String(coverTemplate || baseLetter || '').trim();
    const extra = String(promptExtra || customInstructions || '').trim();
    const eff = String(effectivenessPrompt || '').trim();
    const overrides =
      profileOverrides && typeof profileOverrides === 'object' && !Array.isArray(profileOverrides)
        ? profileOverrides
        : null;
    const normalizedMode = mode === 'qa' || mode === 'question_answers' ? 'qa' : 'cover_letter';
    const data = await fetchJson(`${apiBase}/api/v1/job-responder/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        mode: normalizedMode,
        host: host || 'web',
        vacancy,
        locale: 'ru',
        selectedSourceIds,
        ...(Array.isArray(vacancy?.questions) && vacancy.questions.length
          ? { questions: vacancy.questions }
          : {}),
        ...(template ? { coverTemplate: template, baseLetter: template } : {}),
        ...(extra ? { promptExtra: extra, customInstructions: extra } : {}),
        ...(overrides && Object.keys(overrides).length ? { profileOverrides: overrides } : {}),
        ...(eff ? { effectivenessPrompt: eff } : {}),
        ...(useLlmEffectiveness === true ? { useLlmEffectiveness: true } : {}),
        ...(useGeminiRag === true ? { useGeminiRag: true } : {}),
        ...(useGeminiRag === false ? { useGeminiRag: false } : {}),
      }),
      timeoutMs: 70000,
      errorKind: 'generate',
    });
    if (data && data.ok === false) {
      const pe = Array.isArray(data.providerErrors) ? data.providerErrors.filter(Boolean) : [];
      const err = new Error(
        sanitizeUserError(String(data.message || data.error || 'Генерация не удалась'))
      );
      err.jrMeta = {
        providerErrors: pe.slice(-8),
        elapsedSec: data.elapsedSec,
        timedOut: data.timedOut,
        compactProfileChars: data.compactProfileChars,
        error: data.error,
        debugBudget: data.debugBudget || null,
      };
      throw err;
    }
    const text = pickGeneratedText(data);
    return { ...data, text };
  }

  async function prepareOutbound({ items = [], letterText = '', attachmentSourceIds = [], minScore } = {}) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/outbound/prepare`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        items,
        ...(String(letterText || '').trim() ? { letterText: String(letterText).trim() } : {}),
        ...(Array.isArray(attachmentSourceIds) && attachmentSourceIds.length
          ? { attachmentSourceIds }
          : {}),
        ...(minScore != null && Number.isFinite(Number(minScore)) ? { minScore: Number(minScore) } : {}),
      }),
      timeoutMs: 20000,
    });
  }

  async function insertLetterIntoTab({ text, tabId, windowId } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'JR_INSERT_LETTER', text: String(text || ''), tabId, windowId },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(resp || { ok: false, error: 'Empty response', humanGate: true });
        }
      );
    });
  }

  async function fillFormFieldsInTab({ answers = [], tabId, windowId } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: 'JR_FILL_FORM_FIELDS', answers, tabId, windowId },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(resp || { ok: false, error: 'Empty response', humanGate: true });
        }
      );
    });
  }

  function pickGeneratedText(data) {
    if (!data || typeof data !== 'object') return '';
    const direct = [data.text, data.letter, data.content, data.coverLetter]
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .find(Boolean);
    if (direct) return direct;
    if (Array.isArray(data.answers) && data.answers.length) {
      return data.answers
        .map((a) => {
          if (!a || typeof a !== 'object') return '';
          const q = String(a.question || '').trim();
          const ans = String(a.answer || '').trim();
          if (!q && !ans) return '';
          return q ? `Q: ${q}\nA: ${ans}` : ans;
        })
        .filter(Boolean)
        .join('\n\n');
    }
    return '';
  }

  async function fetchVacancyFromTab({ windowId, tabId } = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'JR_GET_VACANCY', windowId, tabId }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || 'Не удалось прочитать страницу'));
          return;
        }
        const vacancy = resp.vacancy && typeof resp.vacancy === 'object' ? { ...resp.vacancy } : {};
        if (resp.tabId != null) vacancy.tabId = resp.tabId;
        if (resp.windowId != null) vacancy.windowId = resp.windowId;
        if (resp.url && !vacancy.url) vacancy.url = resp.url;
        const vid =
          String(vacancy.id || '').trim() ||
          (String(vacancy.url || '').match(/\/vacancy\/(\d+)/) || [])[1] ||
          '';
        if (vid) vacancy.id = vid;
        resolve(vacancy);
      });
    });
  }

  async function deleteSources({ knowledgeItemIds = [], titles = [] } = {}) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/resume/sources/delete`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, knowledgeItemIds, titles }),
      timeoutMs: 20000,
    });
  }

  async function getDefaultPrompt() {
    const apiBase = await getApiBase();
    return fetchJson(`${apiBase}/api/v1/job-responder/default-prompt`, {
      method: 'GET',
      headers: await getAuthHeaders(),
    });
  }

  async function logout() {
    await chrome.storage.local.remove([
      'userAccessToken',
      'userRefreshToken',
      'userEmail',
      'userTokenExpiresAt',
    ]);
  }

  return {
    DEFAULT_API_BASE,
    DEFAULT_TEST_WORKSPACE_ID,
    deleteSources,
    driveImport,
    ensureWorkspace,
    copyTextViaBackground,
    fetchVacancyFromTab,
    fetchVacancyListFromTab,
    fillFormFieldsInTab,
    geminiRagStatus,
    geminiRagSync,
    generateResponse,
    getApiBase,
    getDefaultPrompt,
    getWorkspaceId,
    injectListBadges,
    insertLetterIntoTab,
    isTestMode,
    listSources,
    logout,
    prepareOutbound,
    resumeCapture,
    resumeStatus,
    resumeFileCapture,
    resumePatch,
    resumeOptimize,
    resumeTextCapture,
    resumeLinkCapture,
    scoreRelevance,
    scoreRelevanceBatch,
    setWorkspaceId,
  };
})();
