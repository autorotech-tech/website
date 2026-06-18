const buildHintEl = document.getElementById('buildHint');
const appBtn = document.getElementById('appBtn');
const settingsBtn = document.getElementById('settingsBtn');
const libraryBtn = document.getElementById('libraryBtn');
const syncBtn = document.getElementById('syncBtn');
const statusBtn = document.getElementById('statusBtn');
const authHintEl = document.getElementById('authHint');
const aiTaskInput = document.getElementById('aiTaskInput');
const aiSearchBtn = document.getElementById('aiSearchBtn');
const searchModeSelect = document.getElementById('searchModeSelect');
const statusEl = document.getElementById('status');
const lastJobEl = document.getElementById('lastJob');
const lastSyncEl = document.getElementById('lastSync');

let currentJobId = null;
const DEFAULTS = {
  apiBase: BB_EXTENSION.apiBaseDefault,
  workspaceId: BB_EXTENSION.workspaceIdFallback,
  supabaseAuthPath: BB_EXTENSION.supabaseAuthPathDefault,
  autoSync: true,
  workerBatchSize: 6,
  workerCycles: 12,
  enrichBatchSize: 30,
  enrichCycles: 3,
  searchMode: 'bookmarks',
};

function detectBrowserType() {
  const ua = navigator.userAgent || '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox/')) return 'firefox';
  return 'chrome';
}

function setStatus(text) {
  statusEl.textContent = text;
}

function toEpochFromExpiresIn(expiresInSec) {
  const ttl = Number(expiresInSec || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  return Math.floor(Date.now() / 1000) + ttl;
}

function formatDate(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Login window — compact popup overlaying the desktop */
function openAuthPopupWindow() {
  const width = Math.max(400, Math.min(520, Math.floor((screen.availWidth || 900) * 0.42)));
  const height = Math.max(640, Math.min(780, Math.floor((screen.availHeight || 900) * 0.78)));
  const left = Math.max(0, Math.floor(((screen.availWidth || width) - width) / 2));
  const top = Math.max(0, Math.floor(((screen.availHeight || height) - height) / 2));
  chrome.windows.create(
    {
      url: chrome.runtime.getURL('login.html'),
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    },
    (win) => {
      if (win?.id) {
        chrome.windows.update(win.id, { focused: true }, () => {});
      }
    },
  );
}

async function fetchAgentJson(url, options = {}) {
  let response;
  let networkErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, options);
      networkErr = null;
      break;
    } catch (err) {
      networkErr = err;
      if (attempt < 3) {
        await sleep(attempt * 900);
      }
    }
  }
  if (!response) {
    const reason = networkErr?.message ? String(networkErr.message) : 'network error';
    throw new Error(`Network unavailable (${reason}). Check access to ${url}`);
  }
  const raw = await response.text();
  let data = null;
  let jsonOk = false;
  if (!raw.length) {
    jsonOk = true;
  } else {
    try {
      data = JSON.parse(raw);
      jsonOk = true;
    } catch {
      jsonOk = false;
    }
  }
  const snippet = raw.trim().slice(0, 140).replace(/\s+/g, ' ');
  if (!response.ok) {
    const detail = data && typeof data === 'object' && data.detail != null ? String(data.detail) : null;
    const fallback =
      raw.trim().startsWith('<') || (!jsonOk && snippet)
        ? `HTTP ${response.status}: server returned HTML/non-JSON (${snippet.slice(0, 80)}...)`
        : `HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`;
    const e = new Error(detail || fallback);
    e.status = response.status;
    throw e;
  }
  if (!jsonOk) {
    throw new Error(
      `Expected JSON, got HTML or error page. Check API URL and Vite/Nginx proxy configuration. (${snippet.slice(0, 100)}...)`,
    );
  }
  return data;
}

async function getBootstrapAccessToken(apiBase) {
  const auth = await chrome.storage.local.get(['userAccessToken', 'userRefreshToken']);
  const userToken = auth.userAccessToken ? String(auth.userAccessToken) : '';
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
  }
  let response;
  try {
    response = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/bootstrap`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    });
  } catch (err) {
    const hasRefresh = Boolean(auth.userRefreshToken);
    const isUnauthorized = Number(err?.status || 0) === 401;
    if (hasRefresh && (isUnauthorized || userToken)) {
      try {
        await refreshUserSession(apiBase);
        const retryAuth = await chrome.storage.local.get(['userAccessToken']);
        const retryHeaders = { 'Content-Type': 'application/json' };
        if (retryAuth.userAccessToken) {
          retryHeaders.Authorization = `Bearer ${String(retryAuth.userAccessToken)}`;
        }
        response = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/bootstrap`, {
          method: 'POST',
          headers: retryHeaders,
          body: JSON.stringify({}),
        });
      } catch {
        throw err;
      }
    } else {
      throw err;
    }
  }
  if (!response?.accessToken) {
    throw new Error('Bootstrap token missing in response');
  }
  await chrome.storage.local.set({
    accessToken: String(response.accessToken),
    tokenExpiresAt: Number(response.expiresAt || 0),
  });
  return String(response.accessToken);
}

async function updateAuthHint() {
  const saved = await chrome.storage.local.get(['userEmail', 'userAccessToken']);
  const loggedIn = Boolean(saved.userAccessToken?.trim?.());
  if (authHintEl) {
    authHintEl.textContent = loggedIn
      ? `Account: ${String(saved.userEmail || 'signed in')}`
      : 'Not signed in. Sync will open the authorization window.';
  }
  syncBtn.disabled = false;
  statusBtn.disabled = false;
  aiSearchBtn.disabled = false;
}

async function saveUserSession(data, fallbackEmail = '') {
  await chrome.storage.local.set({
    userAccessToken: String(data?.accessToken || ''),
    userRefreshToken: String(data?.refreshToken || ''),
    userEmail: String(data?.user?.email || fallbackEmail || ''),
    userTokenExpiresAt: toEpochFromExpiresIn(data?.expiresIn),
  });
}

async function refreshUserSession(apiBaseRaw) {
  const apiBase = (apiBaseRaw || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const saved = await chrome.storage.local.get(['userRefreshToken']);
  const refreshToken = String(saved.userRefreshToken || '').trim();
  if (!refreshToken) return false;
  const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!data?.accessToken) return false;
  await saveUserSession(data);
  return true;
}

async function ensureUserSession(apiBaseRaw) {
  const apiBase = (apiBaseRaw || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const saved = await chrome.storage.local.get(['userAccessToken', 'userTokenExpiresAt', 'userRefreshToken']);
  const now = Math.floor(Date.now() / 1000);
  const hasAccess = Boolean(saved.userAccessToken);
  const expiresAt = Number(saved.userTokenExpiresAt || 0);
  const shouldRefresh = Boolean(saved.userRefreshToken) && (!hasAccess || !expiresAt || expiresAt <= now + 60);
  if (!shouldRefresh) return;
  try {
    await refreshUserSession(apiBase);
  } catch {
    // guest mode for AI/bootstrap in case of missing session
  }
}

async function getAuthorizedHeaders(apiBase) {
  const now = Math.floor(Date.now() / 1000);
  const saved = await chrome.storage.local.get(['accessToken', 'tokenExpiresAt']);
  const token = saved.accessToken ? String(saved.accessToken) : '';
  const exp = Number(saved.tokenExpiresAt || 0);
  if (token && exp > now + 30) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }
  const fresh = await getBootstrapAccessToken(apiBase);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${fresh}`,
  };
}

function flattenBookmarks(nodes, parentPath = '', acc = []) {
  for (const node of nodes || []) {
    if (node.url) {
      acc.push({
        sourceBookmarkId: node.id,
        title: node.title || node.url,
        url: node.url,
        parentPath,
      });
      continue;
    }
    const nextPath = node.title ? (parentPath ? `${parentPath}/${node.title}` : node.title) : parentPath;
    if (node.children && node.children.length) {
      flattenBookmarks(node.children, nextPath, acc);
    }
  }
  return acc;
}

async function maybeResolveWorkspaceId(apiBase) {
  const saved = await chrome.storage.local.get(['workspaceId', 'workspaceResolvedAt']);
  const current = String(saved.workspaceId || '').trim();
  const fallback = BB_EXTENSION.workspaceIdFallback;
  if (saved.workspaceResolvedAt && current && current !== fallback) return current;
  try {
    const { workspaceId } = await bbEnsureWorkspace(apiBase);
    await chrome.storage.local.set({
      workspaceId,
      workspaceResolvedAt: new Date().toISOString(),
    });
    return workspaceId;
  } catch {
    return current || fallback;
  }
}

async function loadSettings() {
  const saved = await chrome.storage.local.get([
    'apiBase',
    'workspaceId',
    'profileId',
    'lastJobId',
    'lastSyncAt',
    'searchMode',
    'supabaseAuthPath',
  ]);

  const browserType = detectBrowserType();
  const apiBase = bbNormalizeApiBase(saved.apiBase || DEFAULTS.apiBase);
  let workspaceId = saved.workspaceId || DEFAULTS.workspaceId;
  try {
    workspaceId = await maybeResolveWorkspaceId(apiBase);
  } catch {
    // keep the saved id
  }

  await chrome.storage.local.set({
    apiBase,
    workspaceId,
    profileId: saved.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`,
    workerBatchSize: Number(saved.workerBatchSize) > 0 ? Number(saved.workerBatchSize) : DEFAULTS.workerBatchSize,
    workerCycles: Number(saved.workerCycles) > 0 ? Number(saved.workerCycles) : DEFAULTS.workerCycles,
    enrichBatchSize: Number(saved.enrichBatchSize) > 0 ? Number(saved.enrichBatchSize) : DEFAULTS.enrichBatchSize,
    enrichCycles: Number(saved.enrichCycles) > 0 ? Number(saved.enrichCycles) : DEFAULTS.enrichCycles,
    searchMode: saved.searchMode || DEFAULTS.searchMode,
    supabaseAuthPath: saved.supabaseAuthPath || DEFAULTS.supabaseAuthPath,
  });

  currentJobId = saved.lastJobId || null;
  lastJobEl.textContent = currentJobId || '—';
  lastSyncEl.textContent = formatDate(saved.lastSyncAt);
  if (searchModeSelect) {
    searchModeSelect.value = saved.searchMode || DEFAULTS.searchMode;
  }
  await ensureUserSession(apiBase);
  if (buildHintEl) {
    buildHintEl.textContent = `Build ${BB_EXTENSION.build} · workspace ${workspaceId}`;
  }
}

async function saveSyncMeta({ jobId, syncedAt }) {
  const patch = {};
  if (jobId) {
    patch.lastJobId = String(jobId);
    currentJobId = String(jobId);
    lastJobEl.textContent = currentJobId;
  }
  if (syncedAt) {
    patch.lastSyncAt = syncedAt;
    lastSyncEl.textContent = formatDate(syncedAt);
  }
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

async function syncBookmarks() {
  const saved = await chrome.storage.local.get(['apiBase', 'workspaceId', 'profileId', 'userAccessToken']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const workspaceId = (saved.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (saved.profileId || `${detectBrowserType()}-${chrome.runtime.id.slice(0, 8)}`).trim();

  if (!saved.userAccessToken || !String(saved.userAccessToken).trim()) {
    openAuthPopupWindow();
    setStatus('Please open the login window, authenticate, then click Sync again.');
    return;
  }

  if (!apiBase || !workspaceId || !profileId) {
    setStatus('Not configured. Open Settings and provide workspace/profile.');
    return;
  }

  syncBtn.disabled = true;
  setStatus('Collecting bookmarks...');

  try {
    const tree = await chrome.bookmarks.getTree();
    const bookmarks = flattenBookmarks(tree);
    setStatus(`Found ${bookmarks.length} bookmarks. Sending...`);

    const headers = await getAuthorizedHeaders(apiBase);
    const syncData = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        profile: {
          browserType: detectBrowserType(),
          profileExternalId: profileId,
          displayName: profileId,
        },
        bookmarks,
      }),
    });

    await saveSyncMeta({ jobId: syncData.jobId, syncedAt: new Date().toISOString() });
    setStatus(
      `Sync started.\nJob ID: ${syncData.jobId}\nAccepted: ${syncData.accepted}\nDeduplicated: ${syncData.deduplicated}\nProcessing...`,
    );

    await chrome.runtime.sendMessage({
      type: 'bookmarksBro:resumeJob',
      jobId: String(syncData.jobId),
      workspaceId,
      apiBase,
    });
    if (Number(syncData.accepted || 0) > 0) {
      setStatus(
        `Sync started.\nJob: ${syncData.jobId}\nAccepted: ${syncData.accepted}, duplicates: ${syncData.deduplicated}\nProcessing in background (you can close popup).`,
      );
    } else {
      await chrome.runtime.sendMessage({ type: 'bookmarksBro:clearActiveJob' });
      setStatus(
        `Sync complete (no new bookmarks).\nJob: ${syncData.jobId}\nAccepted: ${syncData.accepted}, dedup: ${syncData.deduplicated}.`,
      );
    }
    await updateAuthHint();
  } catch (err) {
    setStatus(`Sync failed: ${err.message || err}`);
  } finally {
    syncBtn.disabled = false;
  }
}

function parseOverviewToPicks(overview) {
  const lines = overview.split('\n');
  const picks = [];
  let currentPick = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\.\s+([^:]+):\s*(.*)$/);
    if (match) {
      if (currentPick) picks.push(currentPick);
      currentPick = {
        title: match[2].trim(),
        reason: match[3].trim(),
        url: '',
        category: 'AI Recommendation',
        relevance: 'High',
      };
    } else if (currentPick) {
      if (line.startsWith('http')) {
        currentPick.url = line;
      } else {
        currentPick.reason += ` ${line}`;
      }
    }
  }
  if (currentPick) picks.push(currentPick);
  return picks;
}

async function aiSearchBookmarks() {
  const query = (aiTaskInput?.value || '').trim();
  if (query.length < 5) {
    setStatus('Enter an AI Search query (minimum 5 characters).');
    return;
  }
  const saved = await chrome.storage.local.get(['apiBase', 'workspaceId']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const workspaceId = (saved.workspaceId || DEFAULTS.workspaceId).trim();
  if (!apiBase || !workspaceId) {
    setStatus('API Base or Workspace ID not configured.');
    return;
  }

  aiSearchBtn.disabled = true;
  setStatus('AI Searching...');
  try {
    const searchMode = String(searchModeSelect?.value || DEFAULTS.searchMode);
    await chrome.storage.local.set({ searchMode });
    const headers = await getAuthorizedHeaders(apiBase);
    const result = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/ai-recommend`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        workspaceId,
        task: query,
        retrieveLimit: 24,
        maxPicks: 6,
        searchMode,
        webLimit: 10,
      }),
    });

    let picks = Array.isArray(result?.recommendations) ? result.recommendations : [];

    if (!picks.length && result?.overview) {
      picks = parseOverviewToPicks(result.overview);
    }

    if (!picks.length) {
      setStatus(`AI search:\n${result?.overview || 'No recommendations yet. Start Sync and wait for enrichment.'}`);
      return;
    }

    openResultsTab({
      overview: result?.overview || '',
      retrievalMode: result?.retrievalMode || 'AI Parsing',
      candidateCount: result?.candidateCount || picks.length,
      picks,
    });
    setStatus('AI search complete — results tab opened.');
  } catch (err) {
    setStatus(`AI search failed: ${err.message || err}`);
  } finally {
    aiSearchBtn.disabled = false;
  }
}

async function refreshJobStatus() {
  const saved = await chrome.storage.local.get(['apiBase']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const jobId = currentJobId || (await chrome.storage.local.get(['lastJobId'])).lastJobId;
  if (!apiBase || !jobId) {
    setStatus('Missing apiBase or last Job ID.');
    return;
  }

  statusBtn.disabled = true;
  setStatus('Loading job status...');
  try {
    const headers = await getAuthorizedHeaders(apiBase);
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/jobs/${jobId}`, {
      headers: { Authorization: headers.Authorization },
    });
    setStatus(
      `Job ${jobId}: ${data.status}\nProcessed: ${data.processedItems}/${data.totalItems}\nFailed: ${data.failedItems}\nFinished: ${formatDate(data.finishedAt)}`,
    );
  } catch (err) {
    setStatus(`Status check failed: ${err.message || err}`);
  } finally {
    statusBtn.disabled = false;
  }
}

function openResultsTab({ overview, retrievalMode, candidateCount, picks }) {
  chrome.storage.local.set({
    aiSearchLastResult: {
      overview,
      retrievalMode,
      candidateCount,
      picks: Array.isArray(picks) ? picks : [],
      createdAt: new Date().toISOString(),
    },
  });

  const resultsUrl = `${chrome.runtime.getURL('results.html')}?r=${Date.now()}`;
  chrome.storage.local.get(['aiResultsTabId'], (saved) => {
    const tabId = Number(saved?.aiResultsTabId || 0);
    if (tabId > 0) {
      chrome.tabs.update(tabId, { url: resultsUrl, active: true }, (tab) => {
        if (!chrome.runtime.lastError && tab?.id) {
          chrome.storage.local.set({ aiResultsTabId: tab.id });
          return;
        }
        chrome.tabs.create({ url: resultsUrl, active: true }, (created) => {
          if (created?.id) chrome.storage.local.set({ aiResultsTabId: created.id });
        });
      });
      return;
    }
    chrome.tabs.create({ url: resultsUrl, active: true }, (created) => {
      if (created?.id) chrome.storage.local.set({ aiResultsTabId: created.id });
    });
  });
}

appBtn?.addEventListener('click', async () => {
  const saved = await chrome.storage.local.get(['apiBase']);
  const url = bbWebAppUrl(saved.apiBase || DEFAULTS.apiBase);
  chrome.tabs.create({ url, active: true });
});

libraryBtn?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('library.html'), active: true });
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

syncBtn.addEventListener('click', syncBookmarks);
statusBtn.addEventListener('click', refreshJobStatus);
aiSearchBtn.addEventListener('click', aiSearchBookmarks);
aiTaskInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    aiSearchBookmarks();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.userAccessToken || changes.userEmail) {
    updateAuthHint();
  }
});

loadSettings()
  .then(() => updateAuthHint())
  .then(() => {
    setStatus('Click Sync to upload bookmarks or use AI Search.');
  })
  .catch((err) => setStatus(`Init failed: ${err.message || err}`));
