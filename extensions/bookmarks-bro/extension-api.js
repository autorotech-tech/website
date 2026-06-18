/**
 * Shared API helpers for popup / options (requires extension-config.js).
 */

async function bbFetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data = null;
  if (raw.length) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const detail =
      data && typeof data === 'object' && data.detail != null ? String(data.detail) : null;
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return data;
}

async function bbGetBootstrapAccessToken(apiBase) {
  const base = bbNormalizeApiBase(apiBase);
  const auth = await chrome.storage.local.get(['userAccessToken']);
  const userToken = auth.userAccessToken ? String(auth.userAccessToken) : '';
  const headers = { 'Content-Type': 'application/json' };
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  const data = await bbFetchJson(`${base}/api/v1/bookmarks/bootstrap`, {
    method: 'POST',
    headers,
    body: JSON.stringify({}),
  });
  if (!data?.accessToken) throw new Error('Bootstrap token missing in response');
  return String(data.accessToken);
}

async function bbEnsureWorkspace(apiBase) {
  const base = bbNormalizeApiBase(apiBase);
  const token = await bbGetBootstrapAccessToken(base);
  const data = await bbFetchJson(`${base}/api/v1/bookmarks/workspaces/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  const id = data?.workspaceId != null ? String(data.workspaceId) : '';
  if (!id) throw new Error('ensure: missing workspaceId');
  return { workspaceId: id, workspaceName: data.workspaceName || id, accessToken: token };
}

async function bbPingWorkspaceUiState(apiBase, workspaceId, accessToken) {
  const base = bbNormalizeApiBase(apiBase);
  const ws = encodeURIComponent(String(workspaceId));
  return bbFetchJson(`${base}/api/v1/bookmarks/workspace-ui-state?workspaceId=${ws}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

function formatMetricsReport(data, workspaceId, signedInHint, uiStateLine = '') {
  const jobs = data?.jobs || {};
  const tasks = data?.tasks || {};
  const bookmarks = data?.bookmarks || {};
  const content = data?.content || {};
  const lines = [
    'OK: API is available (bootstrap + metrics).',
    `Build: ${BB_EXTENSION.build}`,
    signedInHint,
    '',
    `Workspace (settings field): ${workspaceId}`,
    `API filter: ${data?.workspaceIdFilter ?? 'all'}`,
    '',
    `Bookmarks: ${bookmarks.total_bookmarks ?? 0}`,
    `Jobs: total ${jobs.total_jobs ?? 0}, completed ${jobs.completed_jobs ?? 0}`,
    `Tasks: done ${tasks.done_tasks ?? 0}, failed ${tasks.failed_tasks ?? 0}`,
    `Enrichment: ok ${content.fetched_ok ?? 0}, embedded ${content.embedded_total ?? 0}`,
  ];
  if (uiStateLine) lines.push('', uiStateLine);
  if (data?.recentJobs?.length) {
    lines.push('', 'Recent jobs:');
    for (const j of data.recentJobs.slice(0, 3)) {
      lines.push(`  • ${j.jobId} ${j.status} ${j.processedItems}/${j.totalItems}`);
    }
  }
  return lines.join('\n');
}
