const saveBtn = document.getElementById('saveBtn');
const syncBtn = document.getElementById('syncBtn');
const statusBtn = document.getElementById('statusBtn');
const autoSyncCheckbox = document.getElementById('autoSync');
const statusEl = document.getElementById('status');
const lastJobEl = document.getElementById('lastJob');
const lastSyncEl = document.getElementById('lastSync');
const apiBaseInput = document.getElementById('apiBase');
const apiKeyInput = document.getElementById('apiKey');
const workspaceIdInput = document.getElementById('workspaceId');
const profileIdInput = document.getElementById('profileId');

let currentJobId = null;
const DEFAULTS = {
  apiBase: 'https://swoop.autoro.tech',
  workspaceId: '1',
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

function getCurrentInputs() {
  return {
    apiBase: apiBaseInput.value.trim().replace(/\/$/, ''),
    apiKey: apiKeyInput.value.trim(),
    workspaceId: workspaceIdInput.value.trim(),
    profileId: profileIdInput.value.trim(),
    autoSync: Boolean(autoSyncCheckbox.checked),
  };
}

async function loadSettings() {
  const saved = await chrome.storage.local.get([
    'apiBase',
    'apiKey',
    'workspaceId',
    'profileId',
    'autoSync',
    'lastJobId',
    'lastSyncAt',
  ]);

  const browserType = detectBrowserType();
  const defaults = {
    apiBase: saved.apiBase || DEFAULTS.apiBase,
    apiKey: saved.apiKey || '',
    workspaceId: saved.workspaceId || DEFAULTS.workspaceId,
    profileId: saved.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: typeof saved.autoSync === 'boolean' ? saved.autoSync : false,
  };

  apiBaseInput.value = defaults.apiBase;
  apiKeyInput.value = defaults.apiKey;
  workspaceIdInput.value = defaults.workspaceId;
  profileIdInput.value = defaults.profileId;
  autoSyncCheckbox.checked = defaults.autoSync;

  currentJobId = saved.lastJobId || null;
  lastJobEl.textContent = currentJobId || '—';
  lastSyncEl.textContent = formatDate(saved.lastSyncAt);
}

async function saveSettings() {
  const inputs = getCurrentInputs();
  if (!inputs.apiBase || !inputs.workspaceId || !inputs.profileId) {
    throw new Error('apiBase, workspaceId и profileId обязательны.');
  }
  await chrome.storage.local.set(inputs);
  await chrome.runtime.sendMessage({
    type: 'bookmarksBro:updateAutoSync',
    enabled: inputs.autoSync,
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
  const saved = await chrome.storage.local.get(['apiBase', 'apiKey', 'workspaceId', 'profileId']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const apiKey = (saved.apiKey || '').trim();
  const workspaceId = (saved.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (saved.profileId || `${detectBrowserType()}-${chrome.runtime.id.slice(0, 8)}`).trim();

  if (!apiBase || !workspaceId || !profileId || !apiKey) {
    setStatus('Not configured: задайте apiBase / workspaceId / profileId / X-API-Key и сохраните настройки.');
    return;
  }

  syncBtn.disabled = true;
  setStatus('Collecting bookmarks...');

  try {
    const tree = await chrome.bookmarks.getTree();
    const bookmarks = flattenBookmarks(tree);
    setStatus(`Found ${bookmarks.length} bookmarks. Sending...`);

    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
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

    await saveSyncMeta({ jobId: data.jobId, syncedAt: new Date().toISOString() });
    setStatus(`Sync started.\nJob ID: ${data.jobId}\nAccepted: ${data.accepted}\nDeduplicated: ${data.deduplicated}`);
  } catch (err) {
    setStatus(`Sync failed: ${err.message || err}`);
  } finally {
    syncBtn.disabled = false;
  }
}

async function refreshJobStatus() {
  const saved = await chrome.storage.local.get(['apiBase', 'apiKey']);
  const apiBase = (saved.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const apiKey = (saved.apiKey || '').trim();
  const jobId = currentJobId || (await chrome.storage.local.get(['lastJobId'])).lastJobId;
  if (!apiBase || !apiKey || !jobId) {
    setStatus('Missing apiBase/apiKey/lastJobId.');
    return;
  }

  statusBtn.disabled = true;
  setStatus('Loading job status...');
  try {
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/sync/jobs/${jobId}`, {
      headers: {
        'X-API-Key': apiKey,
      },
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

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  try {
    await saveSettings();
    setStatus('Settings saved locally.');
  } catch (err) {
    setStatus(`Save failed: ${err.message || err}`);
  } finally {
    saveBtn.disabled = false;
  }
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
    setStatus('Ready. Save settings once, then press "Sync Bookmarks Now".');
  })
  .catch((err) => setStatus(`Init failed: ${err.message || err}`));
