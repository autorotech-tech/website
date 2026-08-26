const syncBtn = document.getElementById('syncBtn');
const statusBtn = document.getElementById('statusBtn');
const autoSyncCheckbox = document.getElementById('autoSync');
const statusEl = document.getElementById('status');
const lastJobEl = document.getElementById('lastJob');
const lastSyncEl = document.getElementById('lastSync');

let currentJobId = null;
const DEFAULTS = {
  apiBase: 'https://swoop.autoro.tech',
  apiKey: 'ak_Gk4VLwwF1tNfdFlkt79QiEfGAjbJoiQGyEZ6olrG',
  workspaceId: '1',
};

function setStatus(text) {
  statusEl.textContent = text;
}

function formatDate(dateLike) {
  if (!dateLike) return '—';
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return String(dateLike);
  return d.toLocaleString();
}

/** Avoids "Unexpected token '<'" when nginx returns HTML (SPA/502/504) instead of JSON. */
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
    const detail =
      data && typeof data === 'object' && data.detail != null ? String(data.detail) : null;
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
  const seeded = {
    apiBase: saved.apiBase || DEFAULTS.apiBase,
    apiKey: saved.apiKey || DEFAULTS.apiKey,
    workspaceId: saved.workspaceId || DEFAULTS.workspaceId,
    profileId: saved.profileId || `chrome-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: typeof saved.autoSync === 'boolean' ? saved.autoSync : true,
  };
  await chrome.storage.local.set(seeded);
  autoSyncCheckbox.checked = Boolean(saved.autoSync);
  currentJobId = saved.lastJobId || null;
  lastJobEl.textContent = currentJobId || '—';
  lastSyncEl.textContent = formatDate(saved.lastSyncAt);
}

async function saveSettings() {
  const saved = await chrome.storage.local.get(['apiBase', 'apiKey', 'workspaceId', 'profileId']);
  await chrome.storage.local.set({
    apiBase: saved.apiBase || DEFAULTS.apiBase,
    apiKey: saved.apiKey || DEFAULTS.apiKey,
    workspaceId: saved.workspaceId || DEFAULTS.workspaceId,
    profileId: saved.profileId || `chrome-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: autoSyncCheckbox.checked,
  });
  await chrome.runtime.sendMessage({
    type: 'bookmarksBro:updateAutoSync',
    enabled: autoSyncCheckbox.checked,
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
  const apiKey = (saved.apiKey || DEFAULTS.apiKey).trim();
  const workspaceId = (saved.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (saved.profileId || `chrome-${chrome.runtime.id.slice(0, 8)}`).trim();

  if (!apiBase || !apiKey || !workspaceId || !profileId) {
    setStatus('Fill all fields before sync.');
    return;
  }

  syncBtn.disabled = true;
  setStatus('Collecting bookmarks...');

  try {
    await saveSettings();
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
          browserType: 'chrome',
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
  const apiKey = (saved.apiKey || DEFAULTS.apiKey).trim();
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
      `Job ${jobId}: ${data.status}\nProcessed: ${data.processedItems}/${data.totalItems}\nFailed: ${data.failedItems}\nFinished: ${formatDate(data.finishedAt)}`
    );
  } catch (err) {
    setStatus(`Status check failed: ${err.message || err}`);
  } finally {
    statusBtn.disabled = false;
  }
}

syncBtn.addEventListener('click', syncBookmarks);
autoSyncCheckbox.addEventListener('change', saveSettings);
statusBtn.addEventListener('click', refreshJobStatus);
loadSettings()
  .then(() => setStatus('Ready. Press "Sync Bookmarks Now".'))
  .catch((err) => setStatus(`Init failed: ${err.message || err}`));
