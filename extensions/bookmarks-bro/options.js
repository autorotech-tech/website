const apiBaseInput = document.getElementById('apiBase');
const workspaceIdInput = document.getElementById('workspaceId');
const profileIdInput = document.getElementById('profileId');
const supabaseAuthPathInput = document.getElementById('supabaseAuthPath');
const autoSyncInput = document.getElementById('autoSync');
const buildLabel = document.getElementById('buildLabel');
const saveBtn = document.getElementById('saveBtn');
const ensureBtn = document.getElementById('ensureBtn');
const testBtn = document.getElementById('testBtn');
const appBtn = document.getElementById('appBtn');
const logoutBtn = document.getElementById('logoutBtn');
const statusEl = document.getElementById('status');

const DEFAULTS = {
  apiBase: BB_EXTENSION.apiBaseDefault,
  workspaceId: BB_EXTENSION.workspaceIdFallback,
  supabaseAuthPath: BB_EXTENSION.supabaseAuthPathDefault,
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
  const saved = await chrome.storage.local.get(['apiBase', 'workspaceId', 'profileId', 'autoSync', 'supabaseAuthPath']);
  const browserType = detectBrowserType();
  apiBaseInput.value = saved.apiBase || DEFAULTS.apiBase;
  workspaceIdInput.value = saved.workspaceId || DEFAULTS.workspaceId;
  profileIdInput.value = saved.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`;
  supabaseAuthPathInput.value = saved.supabaseAuthPath || DEFAULTS.supabaseAuthPath;
  autoSyncInput.checked = typeof saved.autoSync === 'boolean' ? saved.autoSync : false;
  if (buildLabel) {
    buildLabel.textContent = `Extension build ${BB_EXTENSION.build} · manifest ${chrome.runtime.getManifest().version}`;
  }
}

async function saveSettings() {
  const apiBase = bbNormalizeApiBase(apiBaseInput.value);
  const workspaceId = workspaceIdInput.value.trim();
  const profileId = profileIdInput.value.trim();
  let supabaseAuthPath = String(supabaseAuthPathInput?.value || DEFAULTS.supabaseAuthPath).trim();
  if (!supabaseAuthPath.startsWith('/')) supabaseAuthPath = `/${supabaseAuthPath}`;
  supabaseAuthPath = supabaseAuthPath.replace(/\/+$/, '');
  const autoSync = Boolean(autoSyncInput.checked);
  if (!apiBase || !workspaceId || !profileId || !supabaseAuthPath) {
    throw new Error('All fields are required.');
  }
  await chrome.storage.local.set({ apiBase, workspaceId, profileId, supabaseAuthPath, autoSync });
  await chrome.runtime.sendMessage({ type: 'bookmarksBro:updateAutoSync', enabled: autoSync });
}

async function resolveWorkspace() {
  const apiBase = bbNormalizeApiBase(apiBaseInput.value);
  if (!apiBase) throw new Error('apiBase is required.');
  const { workspaceId, workspaceName } = await bbEnsureWorkspace(apiBase);
  workspaceIdInput.value = workspaceId;
  await chrome.storage.local.set({ apiBase, workspaceId });
  return { workspaceId, workspaceName };
}

async function testConnection() {
  const apiBase = bbNormalizeApiBase(apiBaseInput.value);
  const workspaceId = workspaceIdInput.value.trim();
  if (!apiBase || !workspaceId) {
    throw new Error('apiBase and workspaceId are required for test.');
  }
  const token = await bbGetBootstrapAccessToken(apiBase);
  const response = await fetch(
    `${apiBase}/api/v1/bookmarks/metrics?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
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

  let uiStateLine = 'UI state: not checked';
  try {
    const ui = await bbPingWorkspaceUiState(apiBase, workspaceId, token);
    const ideas = Array.isArray(ui?.ideas) ? ui.ideas.length : 0;
    const reminders = Array.isArray(ui?.reminders) ? ui.reminders.length : 0;
    const kb = Array.isArray(ui?.knowledgeItems) ? ui.knowledgeItems.length : 0;
    uiStateLine = `UI state OK: ideas=${ideas}, reminders=${reminders}, knowledge=${kb}`;
  } catch (err) {
    uiStateLine = `UI state: ${err.message || err}`;
  }

  return { data, uiStateLine, token };
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

ensureBtn.addEventListener('click', async () => {
  ensureBtn.disabled = true;
  try {
    const { workspaceId, workspaceName } = await resolveWorkspace();
    setStatus(`Workspace: id=${workspaceId}, name=${workspaceName}\nSaved to storage.`);
  } catch (error) {
    setStatus(`Resolve failed: ${error.message || error}`);
  } finally {
    ensureBtn.disabled = false;
  }
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  try {
    const auth = await chrome.storage.local.get(['userAccessToken', 'userEmail']);
    const hasUser = Boolean(auth.userAccessToken?.trim?.());
    const signedInHint = hasUser
      ? `User session: ${String(auth.userEmail || 'signed in')}.`
      : 'Not signed in via popup — using guest bootstrap.';

    const ws = workspaceIdInput.value.trim();
    const { data, uiStateLine } = await testConnection();
    setStatus(formatMetricsReport(data, ws, signedInHint, uiStateLine));
  } catch (error) {
    setStatus(`Connection failed: ${error.message || error}`);
  } finally {
    testBtn.disabled = false;
  }
});

appBtn.addEventListener('click', async () => {
  const apiBase = bbNormalizeApiBase(apiBaseInput.value || DEFAULTS.apiBase);
  const url = bbWebAppUrl(apiBase);
  await chrome.tabs.create({ url, active: true });
});

logoutBtn.addEventListener('click', async () => {
  await chrome.storage.local.remove([
    'userAccessToken',
    'userRefreshToken',
    'userEmail',
    'userTokenExpiresAt',
    'accessToken',
    'tokenExpiresAt',
  ]);
  setStatus('Signed out. Please sign in again from popup.');
});

loadSettings()
  .then(() => setStatus('Save settings, then Resolve workspace and run Test Connection if needed.'))
  .catch((error) => setStatus(`Init failed: ${error.message || error}`));
