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

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const raw = await response.text();
    let data = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
    }
    if (!response.ok) {
      const detail =
        data?.detail != null
          ? typeof data.detail === 'string'
            ? data.detail
            : JSON.stringify(data.detail)
          : `HTTP ${response.status}`;
      if (response.status === 404 || /^not found$/i.test(String(detail))) {
        throw new Error(
          `API 404: маршрут не найден (${url.split('?')[0]}). ` +
            'Нужен redeploy agent-api (job_responder.py) на swoop.autoro.tech, затем Reload расширения.'
        );
      }
      throw new Error(detail);
    }
    return data || {};
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
    if (!file) throw new Error('File is required');
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
    });
  }

  async function scoreRelevance({ vacancy, selectedSourceIds = [] }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/relevance`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, vacancy, selectedSourceIds }),
    });
  }

  async function generateResponse({
    mode,
    host,
    vacancy,
    selectedSourceIds = [],
    coverTemplate,
    baseLetter,
  }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    const template = String(coverTemplate || baseLetter || '').trim();
    const data = await fetchJson(`${apiBase}/api/v1/job-responder/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        mode,
        host: host || 'web',
        vacancy,
        locale: 'ru',
        selectedSourceIds,
        ...(template ? { coverTemplate: template, baseLetter: template } : {}),
      }),
    });
    const text = pickGeneratedText(data);
    return { ...data, text };
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

  async function fetchVacancyFromTab() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'JR_GET_VACANCY' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || 'Не удалось прочитать страницу'));
          return;
        }
        resolve(resp.vacancy);
      });
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
    driveImport,
    ensureWorkspace,
    fetchVacancyFromTab,
    generateResponse,
    getApiBase,
    getWorkspaceId,
    isTestMode,
    listSources,
    logout,
    resumeCapture,
    resumeStatus,
    resumeFileCapture,
    resumeTextCapture,
    resumeLinkCapture,
    scoreRelevance,
    setWorkspaceId,
  };
})();
