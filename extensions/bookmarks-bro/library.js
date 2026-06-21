const DEFAULT_API = BB_EXTENSION.apiBaseDefault;
const LIMIT = 40;
const IMPORT_FOLDER = 'Keept Import';
/** "Other Bookmarks" in Chromium */
const OTHER_BOOKMARKS_PARENT = '2';

const qEl = document.getElementById('q');
const categoryEl = document.getElementById('category');
const tagEl = document.getElementById('tag');
const fetchStatusEl = document.getElementById('fetchStatus');
const sortEl = document.getElementById('sort');
const orderEl = document.getElementById('order');
const tbody = document.getElementById('tbody');
const toast = document.getElementById('toast');
const loadBtn = document.getElementById('loadBtn');
const importBtn = document.getElementById('importBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const pageInfo = document.getElementById('pageInfo');
const selectAllEl = document.getElementById('selectAll');

let offset = 0;
let total = 0;

function setToast(msg, isErr) {
  toast.textContent = msg || '';
  toast.className = isErr ? 'danger' : '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAgentJson(url, options = {}) {
  let response;
  for (let a = 1; a <= 3; a += 1) {
    try {
      response = await fetch(url, options);
      break;
    } catch {
      if (a === 3) throw new Error('Network unavailable');
      await sleep(a * 500);
    }
  }
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const msg = String(data?.detail || `HTTP ${response.status}`);
    const e = new Error(msg);
    e.status = response.status;
    throw e;
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
        const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: String(auth.userRefreshToken) }),
        });
        if (data?.accessToken) {
          await chrome.storage.local.set({
            userAccessToken: String(data.accessToken),
            userRefreshToken: String(data.refreshToken || auth.userRefreshToken),
            userEmail: String(data?.user?.email || ''),
          });
        }
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
    throw new Error('Bootstrap token missing');
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
    return { Authorization: `Bearer ${token}` };
  }
  const fresh = await getBootstrapAccessToken(apiBase);
  return { Authorization: `Bearer ${fresh}` };
}

async function apiBaseWs() {
  const s = await chrome.storage.local.get(['apiBase', 'workspaceId']);
  const apiBase = String(s.apiBase || DEFAULT_API).trim().replace(/\/$/, '');
  const workspaceId = String(s.workspaceId || '1').trim();
  return { apiBase, workspaceId };
}

function fillSelect(sel, items, placeholder) {
  const cur = sel.value;
  sel.innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = placeholder;
  sel.appendChild(o0);
  for (const it of items || []) {
    const o = document.createElement('option');
    o.value = it;
    o.textContent = it;
    sel.appendChild(o);
  }
  if (items?.includes(cur)) sel.value = cur;
}

async function loadFacets() {
  const { apiBase, workspaceId } = await apiBaseWs();
  const headers = await getAuthorizedHeaders(apiBase);
  const data = await fetchAgentJson(
    `${apiBase}/api/v1/bookmarks/library/facets?workspaceId=${encodeURIComponent(workspaceId)}`,
    { headers },
  );
  fillSelect(categoryEl, data.categories || [], '— any —');
  fillSelect(tagEl, data.tags || [], '— any —');
}

function renderRows(items) {
  tbody.innerHTML = '';
  for (const row of items || []) {
    const tr = document.createElement('tr');
    const tags = Array.isArray(row.tags) ? row.tags.join(', ') : '';
    tr.innerHTML = `
      <td><input type="checkbox" class="pick" data-url="${escapeAttr(row.url)}" data-title="${escapeAttr(row.title || row.url || '')}" /></td>
      <td>
        <strong>${escapeHtml(row.title || '—')}</strong><br/>
        <a class="cell-link" href="${escapeAttr(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.url || '')}</a>
        ${row.summary ? `<div class="tags" style="margin-top:6px">${escapeHtml(row.summary.slice(0, 200))}${row.summary.length > 200 ? '…' : ''}</div>` : ''}
      </td>
      <td>${escapeHtml(row.category || '—')}</td>
      <td class="tags">${escapeHtml(tags || '—')}</td>
      <td>${escapeHtml(row.fetchStatus || '—')}</td>`;
    tbody.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

async function loadPage() {
  const { apiBase, workspaceId } = await apiBaseWs();
  const headers = await getAuthorizedHeaders(apiBase);
  const params = new URLSearchParams({
    workspaceId,
    limit: String(LIMIT),
    offset: String(offset),
    sort: sortEl.value,
    order: orderEl.value,
  });
  const q = (qEl.value || '').trim();
  const cat = (categoryEl.value || '').trim();
  const tag = (tagEl.value || '').trim();
  const fs = (fetchStatusEl.value || '').trim();
  if (q) params.set('q', q);
  if (cat) params.set('category', cat);
  if (tag) params.set('tag', tag);
  if (fs) params.set('fetchStatus', fs);

  loadBtn.disabled = true;
  setToast('Loading…');
  try {
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/library?${params}`, { headers });
    total = Number(data.total || 0);
    renderRows(data.items);
    pageInfo.textContent = `Items ${offset + 1}–${offset + (data.items?.length || 0)} of ${total}`;
    setToast('');
  } catch (e) {
    setToast(String(e.message || e), true);
    tbody.innerHTML = '';
    pageInfo.textContent = '';
  } finally {
    loadBtn.disabled = false;
  }
}

async function findOrCreateImportFolder() {
  const kids = await chrome.bookmarks.getChildren(OTHER_BOOKMARKS_PARENT);
  const found = kids.find((n) => !n.url && n.title === IMPORT_FOLDER);
  if (found) return found.id;
  const created = await chrome.bookmarks.create({ parentId: OTHER_BOOKMARKS_PARENT, title: IMPORT_FOLDER });
  return created.id;
}

async function importSelected() {
  const picks = [...tbody.querySelectorAll('input.pick:checked')];
  if (!picks.length) {
    setToast('Select at least one bookmark.', true);
    return;
  }
  importBtn.disabled = true;
  setToast('Importing…');
  try {
    const parentId = await findOrCreateImportFolder();
    let n = 0;
    for (const el of picks) {
      const url = el.getAttribute('data-url');
      const title = el.getAttribute('data-title') || url;
      if (!url) continue;
      await chrome.bookmarks.create({ parentId, title, url });
      n += 1;
    }
    setToast(`Imported into "${IMPORT_FOLDER}": ${n} bookmarks.`);
  } catch (e) {
    setToast(`Import: ${e.message || e}`, true);
  } finally {
    importBtn.disabled = false;
  }
}

loadBtn.addEventListener('click', () => {
  offset = 0;
  loadPage();
});

prevBtn.addEventListener('click', () => {
  offset = Math.max(0, offset - LIMIT);
  loadPage();
});

nextBtn.addEventListener('click', () => {
  if (offset + LIMIT < total) {
    offset += LIMIT;
    loadPage();
  }
});

importBtn.addEventListener('click', importSelected);

sortEl.addEventListener('change', () => {
  offset = 0;
  loadPage();
});
orderEl.addEventListener('change', () => {
  offset = 0;
  loadPage();
});

selectAllEl.addEventListener('change', () => {
  const on = selectAllEl.checked;
  for (const c of tbody.querySelectorAll('input.pick')) {
    c.checked = on;
  }
});

qEl.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    offset = 0;
    loadPage();
  }
});

(async () => {
  try {
    await loadFacets();
    await loadPage();
  } catch (e) {
    setToast(`Error: ${e.message || e}`, true);
  }
})();
