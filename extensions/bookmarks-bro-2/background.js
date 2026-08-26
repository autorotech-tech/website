const AUTO_SYNC_ALARM = 'bookmarksBro:autoSync';
const DEFAULTS = {
  apiBase: 'https://swoop.autoro.tech',
  workspaceId: '1',
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

async function performSync() {
  const settings = await chrome.storage.local.get([
    'apiBase',
    'apiKey',
    'workspaceId',
    'profileId',
    'autoSync',
  ]);
  if (!settings.autoSync) return;

  const browserType = detectBrowserType();
  const apiBase = (settings.apiBase || DEFAULTS.apiBase).trim().replace(/\/$/, '');
  const apiKey = (settings.apiKey || '').trim();
  const workspaceId = (settings.workspaceId || DEFAULTS.workspaceId).trim();
  const profileId = (settings.profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`).trim();

  if (!apiBase || !workspaceId || !profileId || !apiKey) {
    await chrome.storage.local.set({
      lastAutoSyncError: 'Auto-sync skipped: extension is not configured (apiKey/profile/workspace missing).',
      lastAutoSyncAt: new Date().toISOString(),
    });
    return;
  }

  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(tree);
  if (!bookmarks.length) return;

  const response = await fetch(`${apiBase}/api/v1/bookmarks/sync/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
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
    return;
  }
  if (!parseOk) {
    await chrome.storage.local.set({
      lastAutoSyncError: looksHtml
        ? 'Expected JSON; got HTML — check swoop /api/v1/ -> agent-api'
        : 'Invalid JSON from API',
      lastAutoSyncAt: new Date().toISOString(),
    });
    return;
  }

  await chrome.storage.local.set({
    lastJobId: String(data.jobId),
    lastSyncAt: new Date().toISOString(),
    lastAutoSyncError: null,
  });
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
  const { autoSync, apiBase, apiKey, workspaceId, profileId } = await chrome.storage.local.get([
    'autoSync',
    'apiBase',
    'apiKey',
    'workspaceId',
    'profileId',
  ]);
  const normalized = {
    apiBase: apiBase || DEFAULTS.apiBase,
    apiKey: apiKey || '',
    workspaceId: workspaceId || DEFAULTS.workspaceId,
    profileId: profileId || `${browserType}-${chrome.runtime.id.slice(0, 8)}`,
    autoSync: typeof autoSync === 'boolean' ? autoSync : false,
  };
  await chrome.storage.local.set(normalized);
  await ensureAlarm(normalized.autoSync);
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
  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== AUTO_SYNC_ALARM) return;
  performSync().catch(async (err) => {
    await chrome.storage.local.set({
      lastAutoSyncError: String(err),
      lastAutoSyncAt: new Date().toISOString(),
    });
  });
});
