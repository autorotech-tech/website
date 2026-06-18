importScripts('extension-config.js', 'extension-api.js');

const AUTO_SYNC_ALARM = 'bookmarksBro:autoSync';
const ACTIVE_JOB_ALARM = 'bookmarksBro:activeJob';
const DEFAULTS = {
  apiBase: BB_EXTENSION.apiBaseDefault,
  workspaceId: BB_EXTENSION.workspaceIdFallback,
  autoSync: true,
  workerBatchSize: 6,
  workerCycles: 12,
  enrichBatchSize: 30,
  enrichCycles: 3,
};

function detectBrowserType() {
  const ua = self.navigator?.userAgent || '';
  if (ua.includes('Edg/')) return 'edge';
  if (ua.includes('Firefox/')) return 'firefox';
  return 'chrome';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setBadgeIdle() {
  await chrome.action.setBadgeText({ text: '' });
}

async function setBadgeRunning() {
  await chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  await chrome.action.setBadgeText({ text: 'RUN' });
}

async function setBadgeError() {
  await chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  await chrome.action.setBadgeText({ text: 'ERR' });
}

async function performSync() {
  const settings = await chrome.storage.local.get([
    'apiBase',
    'workspaceId',
    'profileId',
    'autoSync',
    'userAccessToken',
  ]);
  if (!settings.autoSync) return;

  const userTok = settings.userAccessToken ? String(settings.userAccessToken).trim() : '';
  if (!userTok) {
    await setBadgeIdle();
    return;
  }

  const browserType = detectBrowserType();
  const apiBase = bbNormalizeApiBase(settings.apiBase || DEFAULTS.apiBase);
  const workspaceId = (settings.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (settings.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`).trim();
  if (!apiBase || !workspaceId || !profileId) {
    await chrome.storage.local.set({
      lastAutoSyncError: 'Auto-sync skipped: extension is not configured (profile/workspace missing).',
      lastAutoSyncAt: new Date().toISOString(),
    });
    await setBadgeError();
    return;
  }

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(tree);
  if (!bookmarks.length) return;

  const headers = await getAuthorizedHeaders(apiBase);
  const response = await fetch(`${apiBase}/api/v1/bookmarks/sync/start`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      workspaceId,
      profile: {
        browserType,
        profileExternalId: profileId,
        displayName: profileId,
      },
      bookmarks,
    }),
  });

  const raw = await response.text();
  let data = {};
  let parseOk = false;
  if (!raw.length) {
    parseOk = true;
  } else {
    try {
      data = JSON.parse(raw);
      parseOk = true;
    } catch {
      parseOk = false;
    }
  }
  const looksHtml = raw.trim().startsWith('<');
  if (!response.ok) {
    await chrome.storage.local.set({
      lastAutoSyncError:
        (parseOk && data?.detail) ||
        (looksHtml ? `HTTP ${response.status}: HTML (proxy/nginx?)` : `HTTP ${response.status}`),
      lastAutoSyncAt: new Date().toISOString(),
    });
    await setBadgeError();
    return;
  }
  if (!parseOk) {
    await chrome.storage.local.set({
      lastAutoSyncError: looksHtml
        ? 'Expected JSON; got HTML — check swoop /api/v1/ -> agent-api'
        : 'Invalid JSON from API',
      lastAutoSyncAt: new Date().toISOString(),
    });
    await setBadgeError();
    return;
  }

  await chrome.storage.local.set({
    lastJobId: String(data.jobId || ''),
    lastSyncAt: new Date().toISOString(),
    lastAutoSyncError: null,
  });
  await setBadgeIdle();

  if (data?.jobId) {
    await setActiveJob({
      jobId: String(data.jobId),
      workspaceId,
      apiBase,
    });
    await processActiveJobTick();
  }
}

async function getOrRefreshAccessToken(apiBase) {
  const now = Math.floor(Date.now() / 1000);
  const saved = await chrome.storage.local.get(['accessToken', 'tokenExpiresAt', 'userAccessToken']);
  if (saved.accessToken && Number(saved.tokenExpiresAt || 0) > now + 30) {
    return String(saved.accessToken);
  }
  const userToken = saved.userAccessToken ? String(saved.userAccessToken) : '';
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  const response = await fetch(`${apiBase}/api/v1/bookmarks/bootstrap`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok || !data?.accessToken) {
    throw new Error(data?.detail || `Bootstrap failed (HTTP ${response.status})`);
  }
  await chrome.storage.local.set({
    accessToken: String(data.accessToken),
    tokenExpiresAt: Number(data.expiresAt || 0),
  });
  return String(data.accessToken);
}

async function getAuthorizedHeaders(apiBase) {
  const token = await getOrRefreshAccessToken(apiBase);
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function runProcessingBatches(apiBase, headers, workspaceId, jobId) {
  let idleWorkerRuns = 0;
  for (let i = 0; i < DEFAULTS.workerCycles; i += 1) {
    const worker = await fetch(`${apiBase}/api/v1/bookmarks/worker/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        max_tasks: DEFAULTS.workerBatchSize,
        workspaceId,
        jobId,
      }),
    });
    const workerRaw = await worker.text();
    let workerJson = {};
    try {
      workerJson = workerRaw ? JSON.parse(workerRaw) : {};
    } catch {
      workerJson = {};
    }
    const processed = Number(workerJson?.processed || 0);
    if (processed === 0) {
      idleWorkerRuns += 1;
      if (idleWorkerRuns >= 2) break;
    } else {
      idleWorkerRuns = 0;
    }
  }

  for (let i = 0; i < DEFAULTS.enrichCycles; i += 1) {
    const enrich = await fetch(`${apiBase}/api/v1/bookmarks/enrich/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        max_tasks: DEFAULTS.enrichBatchSize,
        workspaceId,
      }),
    });
    const enrichRaw = await enrich.text();
    let enrichJson = {};
    try {
      enrichJson = enrichRaw ? JSON.parse(enrichRaw) : {};
    } catch {
      enrichJson = {};
    }
    if (Number(enrichJson?.processed || 0) === 0) break;
  }

  const statusResp = await fetch(`${apiBase}/api/v1/bookmarks/sync/jobs/${jobId}`, {
    headers: { Authorization: headers.Authorization },
  });
  const statusRaw = await statusResp.text();
  let statusJson = {};
  try {
    statusJson = statusRaw ? JSON.parse(statusRaw) : {};
  } catch {
    statusJson = {};
  }
  return {
    status: statusJson?.status || 'unknown',
    processedItems: Number(statusJson?.processedItems || 0),
    totalItems: Number(statusJson?.totalItems || 0),
  };
}

async function setActiveJob({ jobId, workspaceId, apiBase }) {
  await chrome.storage.local.set({
    activeJobId: String(jobId),
    activeWorkspaceId: String(workspaceId),
    activeApiBase: String(apiBase).replace(/\/$/, ''),
    activeJobUpdatedAt: new Date().toISOString(),
  });
  await setBadgeRunning();
  await chrome.alarms.create(ACTIVE_JOB_ALARM, {
    delayInMinutes: 0.1,
    periodInMinutes: 1,
  });
}

async function clearActiveJob() {
  await chrome.storage.local.remove(['activeJobId', 'activeWorkspaceId', 'activeApiBase', 'activeJobUpdatedAt']);
  await chrome.alarms.clear(ACTIVE_JOB_ALARM);
  await setBadgeIdle();
}

async function processActiveJobTick() {
  const state = await chrome.storage.local.get(['activeJobId', 'activeWorkspaceId', 'activeApiBase']);
  const jobId = state.activeJobId ? String(state.activeJobId) : '';
  const workspaceId = state.activeWorkspaceId ? String(state.activeWorkspaceId) : '';
  const apiBase = state.activeApiBase ? String(state.activeApiBase).replace(/\/$/, '') : '';
  if (!jobId || !workspaceId || !apiBase) {
    await clearActiveJob();
    return;
  }

  const headers = await getAuthorizedHeaders(apiBase);
  await setBadgeRunning();
  const result = await runProcessingBatches(apiBase, headers, workspaceId, jobId);

  await chrome.storage.local.set({
    activeJobUpdatedAt: new Date().toISOString(),
    lastJobId: jobId,
    lastSyncAt: new Date().toISOString(),
  });

  const isTerminalStatus =
    result.status === 'completed' ||
    result.status === 'partial' ||
    result.status === 'failed' ||
    (result.totalItems > 0 && result.processedItems >= result.totalItems);

  if (isTerminalStatus) {
    await chrome.storage.local.set({
      lastJobFinalStatus: result.status,
    });
    await clearActiveJob();
  }
}

async function ensureAlarm(enabled) {
  if (!enabled) {
    await chrome.alarms.clear(AUTO_SYNC_ALARM);
    return;
  }
  await chrome.alarms.create(AUTO_SYNC_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: 30,
  });
}

async function seedDefaults() {
  const browserType = detectBrowserType();
  const { autoSync, apiBase, workspaceId, profileId } = await chrome.storage.local.get([
    'autoSync',
    'apiBase',
    'workspaceId',
    'profileId',
  ]);
  const normalized = {
    apiBase: apiBase || DEFAULTS.apiBase,
    workspaceId: workspaceId || DEFAULTS.workspaceId,
    profileId: profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: typeof autoSync === 'boolean' ? autoSync : DEFAULTS.autoSync,
    workerBatchSize: DEFAULTS.workerBatchSize,
    workerCycles: DEFAULTS.workerCycles,
    enrichBatchSize: DEFAULTS.enrichBatchSize,
    enrichCycles: DEFAULTS.enrichCycles,
  };
  await chrome.storage.local.set(normalized);
  await ensureAlarm(normalized.autoSync);
  const active = await chrome.storage.local.get(['activeJobId']);
  if (active.activeJobId) {
    await setBadgeRunning();
  } else {
    await setBadgeIdle();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  seedDefaults().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  seedDefaults().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'bookmarksBro:updateAutoSync') {
    ensureAlarm(Boolean(message.enabled))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === 'bookmarksBro:resumeJob') {
    setActiveJob({
      jobId: message.jobId,
      workspaceId: message.workspaceId,
      apiBase: message.apiBase,
    })
      .then(() => processActiveJobTick())
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  if (message?.type === 'bookmarksBro:clearActiveJob') {
    clearActiveJob()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_SYNC_ALARM) {
    performSync().catch(async (err) => {
      await chrome.storage.local.set({
        lastAutoSyncError: String(err),
        lastAutoSyncAt: new Date().toISOString(),
      });
      await setBadgeError();
    });
    return;
  }
  if (alarm.name === ACTIVE_JOB_ALARM) {
    processActiveJobTick().catch(async (err) => {
      await chrome.storage.local.set({
        lastAutoSyncError: `Active job tick failed: ${String(err)}`,
        lastAutoSyncAt: new Date().toISOString(),
      });
      await setBadgeError();
    });
  }
});
