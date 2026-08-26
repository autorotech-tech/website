const settingsBtn = document.getElementById('settingsBtn');
const syncBtn = document.getElementById('syncBtn');
const statusBtn = document.getElementById('statusBtn');
const autoSyncCheckbox = document.getElementById('autoSync');
const statusEl = document.getElementById('status');
const lastJobEl = document.getElementById('lastJob');
const lastSyncEl = document.getElementById('lastSync');

let currentJobId = null;
const DEFAULTS = {
  apiBase: 'https://swoop.autoro.tech',
  workspaceId: '1',
  autoSync: true,
  workerBatchSize: 6,
  workerCycles: 12,
  enrichBatchSize: 30,
  enrichCycles: 3,
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

function formatDate(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAgentJson(url, options = {}) {
  const response = await fetch(url, options);
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
        ? `HTTP ${response.status}: сервер вернул HTML/не JSON (${snippet.slice(0, 80)}…)`
        : `HTTP ${response.status}${snippet ? `: ${snippet}` : ''}`;
    throw new Error(detail || fallback);
  }
  if (!jsonOk) {
    throw new Error(
      `Ожидался JSON, пришла страница ошибки или HTML. Проверьте URL API и прокси /api/v1/ на swoop. (${snippet.slice(0, 100)}…)`,
    );
  }
  return data;
}

async function getBootstrapAccessToken(apiBase) {
  const response = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!response?.accessToken) {
    throw new Error('Bootstrap token missing in response');
  }
  await chrome.storage.local.set({
    accessToken: String(response.accessToken),
    tokenExpiresAt: Number(response.expiresAt || 0),
  });
  return String(response.accessToken);
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

async function loadSettings() {
  const saved = await chrome.storage.local.get([
    'apiBase',
    'workspaceId',
    'profileId',
    'autoSync',
    'lastJobId',
    'lastSyncAt',
  ]);

  const browserType = detectBrowserType();
  await chrome.storage.local.set({
    apiBase: saved.apiBase || DEFAULTS.apiBase,
    workspaceId: saved.workspaceId || DEFAULTS.workspaceId,
    profileId: saved.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: typeof saved.autoSync === 'boolean' ? saved.autoSync : DEFAULTS.autoSync,
    workerBatchSize: Number(saved.workerBatchSize) > 0 ? Number(saved.workerBatchSize) : DEFAULTS.workerBatchSize,
    workerCycles: Number(saved.workerCycles) > 0 ? Number(saved.workerCycles) : DEFAULTS.workerCycles,
    enrichBatchSize: Number(saved.enrichBatchSize) > 0 ? Number(saved.enrichBatchSize) : DEFAULTS.enrichBatchSize,
    enrichCycles: Number(saved.enrichCycles) > 0 ? Number(saved.enrichCycles) : DEFAULTS.enrichCycles,
  });
  autoSyncCheckbox.checked = typeof saved.autoSync === 'boolean' ? saved.autoSync : DEFAULTS.autoSync;

  currentJobId = saved.lastJobId || null;
  lastJobEl.textContent = currentJobId || '—';
  lastSyncEl.textContent = formatDate(saved.lastSyncAt);
}

async function saveSettings() {
  await chrome.storage.local.set({ autoSync: Boolean(autoSyncCheckbox.checked) });
  await chrome.runtime.sendMessage({
    type: 'bookmarksBro:updateAutoSync',
    enabled: Boolean(autoSyncCheckbox.checked),
  });
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
  const saved = await chrome.storage.local.get([
    'apiBase',
    'workspaceId',
    'profileId',
  ]);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const workspaceId = (saved.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (saved.profileId || `${detectBrowserType()}-${chrome.runtime.id.slice(0, 8)}`).trim();

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

    const result = await runProcessingBatches(apiBase, headers, workspaceId, String(syncData.jobId));
    setStatus(
      `Done.\nJob ID: ${syncData.jobId}\nWorker processed: ${result.workerProcessed}\nEnriched: ${result.enriched}\nJob status: ${result.jobStatus}`,
    );
  } catch (err) {
    setStatus(`Sync failed: ${err.message || err}`);
  } finally {
    syncBtn.disabled = false;
  }
}

async function runProcessingBatches(apiBase, headers, workspaceId, jobId) {
  let workerProcessed = 0;
  let idleWorkerRuns = 0;
  for (let i = 0; i < DEFAULTS.workerCycles; i += 1) {
    const worker = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/worker/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        max_tasks: DEFAULTS.workerBatchSize,
        workspaceId,
        jobId,
      }),
    });
    const processed = Number(worker?.processed || 0);
    workerProcessed += processed;
    if (processed === 0) {
      idleWorkerRuns += 1;
      if (idleWorkerRuns >= 2) break;
    } else {
      idleWorkerRuns = 0;
    }
  }

  let status = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/jobs/${jobId}`, {
    headers: { Authorization: headers.Authorization },
  });

  if (status?.status === 'running' || status?.status === 'queued') {
    // Tasks with retry become available in ~30s on backend.
    await sleep(35000);
    idleWorkerRuns = 0;
    for (let i = 0; i < 6; i += 1) {
      const worker = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/worker/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          max_tasks: DEFAULTS.workerBatchSize,
          workspaceId,
          jobId,
        }),
      });
      const processed = Number(worker?.processed || 0);
      workerProcessed += processed;
      if (processed === 0) {
        idleWorkerRuns += 1;
        if (idleWorkerRuns >= 2) break;
      } else {
        idleWorkerRuns = 0;
      }
    }
    status = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/jobs/${jobId}`, {
      headers: { Authorization: headers.Authorization },
    });
  }

  let enriched = 0;
  for (let i = 0; i < DEFAULTS.enrichCycles; i += 1) {
    const enrich = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/enrich/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        max_tasks: DEFAULTS.enrichBatchSize,
        workspaceId,
      }),
    });
    const processed = Number(enrich?.processed || 0);
    enriched += processed;
    if (processed === 0) break;
  }

  return { workerProcessed, enriched, jobStatus: status?.status || 'unknown' };
}

async function refreshJobStatus() {
  const saved = await chrome.storage.local.get(['apiBase']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const jobId = currentJobId || (await chrome.storage.local.get(['lastJobId'])).lastJobId;
  if (!apiBase || !jobId) {
    setStatus('Missing apiBase/lastJobId.');
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

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

syncBtn.addEventListener('click', syncBookmarks);
autoSyncCheckbox.addEventListener('change', async () => {
  try {
    await saveSettings();
  } catch (err) {
    setStatus(`Auto-sync update failed: ${err.message || err}`);
  }
});
statusBtn.addEventListener('click', refreshJobStatus);

loadSettings()
  .then(() => {
    setStatus('Ready. Press "Sync Bookmarks Now".');
  })
  .catch((err) => setStatus(`Init failed: ${err.message || err}`));
