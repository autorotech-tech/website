const JR_API = (() => {
  const DEFAULT_API_BASE = 'https://swoop.autoro.tech';

  function normalizeApiBase(apiBase) {
    return String(apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
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
      const detail = data?.detail != null ? String(data.detail) : `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return data || {};
  }

  async function getApiBase() {
    const saved = await chrome.storage.local.get(['jrApiBase']);
    return normalizeApiBase(saved.jrApiBase);
  }

  async function getAuthHeaders() {
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
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async function ensureWorkspace() {
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

  async function resumeStatus() {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(
      `${apiBase}/api/v1/job-responder/resume/status?workspaceId=${encodeURIComponent(workspaceId)}`,
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

  async function generateResponse({ mode, host, vacancy }) {
    const apiBase = await getApiBase();
    const headers = await getAuthHeaders();
    const workspaceId = await getWorkspaceId();
    return fetchJson(`${apiBase}/api/v1/job-responder/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ workspaceId, mode, host, vacancy, locale: 'ru' }),
    });
  }

  async function fetchVacancyFromTab() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'JR_GET_VACANCY' }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!resp?.ok) {
          reject(new Error(resp?.error || 'Не удалось прочитать страницу вакансии'));
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
      'jrWorkspaceId',
    ]);
  }

  return {
    DEFAULT_API_BASE,
    ensureWorkspace,
    fetchVacancyFromTab,
    generateResponse,
    getApiBase,
    logout,
    resumeCapture,
    resumeStatus,
  };
})();
