const apiBaseInput = document.getElementById('apiBase');
const workspaceIdInput = document.getElementById('workspaceId');
const profileIdInput = document.getElementById('profileId');
const autoSyncInput = document.getElementById('autoSync');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const statusEl = document.getElementById('status');

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

async function loadSettings() {
  const saved = await chrome.storage.local.get(['apiBase', 'workspaceId', 'profileId', 'autoSync']);
  const browserType = detectBrowserType();
  apiBaseInput.value = saved.apiBase || DEFAULTS.apiBase;
  workspaceIdInput.value = saved.workspaceId || DEFAULTS.workspaceId;
  profileIdInput.value = saved.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`;
  autoSyncInput.checked = typeof saved.autoSync === 'boolean' ? saved.autoSync : false;
}

async function saveSettings() {
  const apiBase = apiBaseInput.value.trim().replace(/\/$/, '');
  const workspaceId = workspaceIdInput.value.trim();
  const profileId = profileIdInput.value.trim();
  const autoSync = Boolean(autoSyncInput.checked);
  if (!apiBase || !workspaceId || !profileId) {
    throw new Error('All fields are required.');
  }
  await chrome.storage.local.set({ apiBase, workspaceId, profileId, autoSync });
  await chrome.runtime.sendMessage({ type: 'bookmarksBro:updateAutoSync', enabled: autoSync });
}

async function testConnection() {
  const apiBase = apiBaseInput.value.trim().replace(/\/$/, '');
  const workspaceId = workspaceIdInput.value.trim();
  if (!apiBase || !workspaceId) {
    throw new Error('apiBase and workspaceId are required for test.');
  }
  const bootstrap = await fetch(`${apiBase}/api/v1/bookmarks/bootstrap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const bootstrapRaw = await bootstrap.text();
  let bootstrapJson = null;
  try {
    bootstrapJson = bootstrapRaw ? JSON.parse(bootstrapRaw) : null;
  } catch {
    bootstrapJson = null;
  }
  if (!bootstrap.ok || !bootstrapJson?.accessToken) {
    throw new Error(bootstrapJson?.detail || `Bootstrap failed: HTTP ${bootstrap.status}`);
  }
  const response = await fetch(`${apiBase}/api/v1/bookmarks/metrics?workspaceId=${encodeURIComponent(workspaceId)}`, {
    headers: { Authorization: `Bearer ${bootstrapJson.accessToken}` },
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    throw new Error(data?.detail || `HTTP ${response.status}`);
  }
  return data;
}

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  try {
    await saveSettings();
    setStatus('Settings saved.');
  } catch (error) {
    setStatus(`Save failed: ${error.message || error}`);
  } finally {
    saveBtn.disabled = false;
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  try {
    const data = await testConnection();
    setStatus(`Connection OK.\nJobs total: ${data?.jobs?.total_jobs ?? 0}`);
  } catch (error) {
    setStatus(`Connection failed: ${error.message || error}`);
  } finally {
    testBtn.disabled = false;
  }
});

loadSettings()
  .then(() => setStatus('Ready.'))
  .catch((error) => setStatus(`Init failed: ${error.message || error}`));
