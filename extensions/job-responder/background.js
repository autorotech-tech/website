const PAGE_EXTRACT_FILE = 'content/page-extract.js';
const OFFSCREEN_URL = 'offscreen.html';
let offscreenCreating = null;

function canInjectIntoUrl(url) {
  if (!url) return false;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return false;
  if (url.startsWith('about:') || url.startsWith('devtools://') || url.startsWith('edge://')) return false;
  return /^https?:\/\//i.test(url);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

/**
 * Resolve active tab for a side-panel window.
 * Prefer explicit windowId from the panel; never rely on service-worker "currentWindow"
 * alone (wrong window when vacancy opens in a new Chrome window).
 */
function queryActiveTab({ windowId, tabId } = {}) {
  return new Promise((resolve) => {
    if (Number.isFinite(Number(tabId)) && Number(tabId) > 0) {
      chrome.tabs.get(Number(tabId), (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve(null);
          return;
        }
        resolve(tab);
      });
      return;
    }
    const wid = windowId != null && Number.isFinite(Number(windowId)) ? Number(windowId) : null;
    const query =
      wid != null ? { active: true, windowId: wid } : { active: true, lastFocusedWindow: true };
    chrome.tabs.query(query, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function extractFromTab(tabId, sendResponse) {
  chrome.tabs.sendMessage(tabId, { type: 'JR_EXTRACT_VACANCY' }, (resp) => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: [PAGE_EXTRACT_FILE] },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { type: 'JR_EXTRACT_VACANCY' }, (resp2) => {
              if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              sendResponse(resp2 || { ok: false, error: 'Empty response' });
            });
          }, 150);
        }
      );
      return;
    }
    sendResponse(resp || { ok: false, error: 'Empty response' });
  });
}

function sendTabMessageWithInject(tabId, message, sendResponse) {
  chrome.tabs.sendMessage(tabId, message, (resp) => {
    if (chrome.runtime.lastError) {
      chrome.scripting.executeScript(
        { target: { tabId }, files: [PAGE_EXTRACT_FILE] },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, message, (resp2) => {
              if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              sendResponse(resp2 || { ok: false, error: 'Empty response' });
            });
          }, 150);
        }
      );
      return;
    }
    sendResponse(resp || { ok: false, error: 'Empty response' });
  });
}

/** Notify side panel about active tab changes - DOM re-read, clear stale letter. */
function broadcastActiveTab(tab, reason) {
  if (!tab?.id) return;
  const url = String(tab.url || '');
  chrome.runtime
    .sendMessage({
      type: 'JR_TAB_CHANGED',
      reason: reason || 'activated',
      tabId: tab.id,
      windowId: tab.windowId != null ? tab.windowId : null,
      url,
      canExtract: canInjectIntoUrl(url),
    })
    .catch(() => {});
}

function broadcastTabRemoved(tabId, windowId) {
  chrome.runtime
    .sendMessage({
      type: 'JR_TAB_REMOVED',
      tabId,
      windowId: windowId != null ? windowId : null,
    })
    .catch(() => {});
}

function notifyCurrentActiveTab(reason, windowId) {
  const query =
    windowId != null
      ? { active: true, windowId: Number(windowId) }
      : { active: true, lastFocusedWindow: true };
  chrome.tabs.query(query, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    broadcastActiveTab(tab, reason);
  });
}

async function ensureOffscreenDocument() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
      });
      if (contexts && contexts.length > 0) return;
    }
  } catch (_err) {
    /* older Chrome - try create anyway */
  }
  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }
  offscreenCreating = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['CLIPBOARD'],
      justification: 'Copy Autoro Hunt cover letter from side panel to system clipboard',
    })
    .catch((err) => {
      const msg = String(err?.message || err || '');
      // Already exists is fine under races.
      if (!/already exists|Only a single offscreen/i.test(msg)) throw err;
    })
    .finally(() => {
      offscreenCreating = null;
    });
  await offscreenCreating;
}

function copyViaOffscreen(text) {
  return new Promise(async (resolve) => {
    try {
      await ensureOffscreenDocument();
    } catch (err) {
      resolve({ ok: false, error: String(err?.message || err) });
      return;
    }
    chrome.runtime.sendMessage({ type: 'JR_OFFSCREEN_COPY', text: String(text || '') }, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: 'Empty offscreen response' });
    });
  });
}

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    broadcastActiveTab(tab, 'activated');
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  if (!tab?.active) return;
  const url = changeInfo.url || tab.url;
  if (!url) return;
  broadcastActiveTab({ ...tab, id: tabId, url }, changeInfo.url ? 'navigated' : 'complete');
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  broadcastTabRemoved(tabId, removeInfo?.windowId);
  // After close, re-read whatever is now active in that window (debounced in sidepanel).
  setTimeout(() => notifyCurrentActiveTab('after_remove', removeInfo?.windowId), 50);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'JR_GET_VACANCY') {
    queryActiveTab({ windowId: message.windowId, tabId: message.tabId }).then((tab) => {
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!canInjectIntoUrl(tab.url)) {
        sendResponse({
          ok: false,
          error: 'Откройте обычную http(s) страницу с вакансией (не chrome://)',
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url || '',
        });
        return;
      }
      extractFromTab(tab.id, (resp) => {
        sendResponse({
          ...(resp || { ok: false, error: 'Empty response' }),
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url || resp?.vacancy?.url || '',
        });
      });
    });
    return true;
  }

  if (message?.type === 'JR_GET_VACANCY_LIST') {
    queryActiveTab({ windowId: message.windowId, tabId: message.tabId }).then((tab) => {
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!canInjectIntoUrl(tab.url)) {
        sendResponse({
          ok: false,
          error: 'Откройте страницу поиска вакансий hh.ru (/search/vacancy)',
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url || '',
        });
        return;
      }
      sendTabMessageWithInject(tab.id, { type: 'JR_EXTRACT_VACANCY_LIST' }, (resp) => {
        sendResponse({
          ...(resp || { ok: false, error: 'Empty response' }),
          tabId: tab.id,
          windowId: tab.windowId,
          url: tab.url || resp?.url || '',
        });
      });
    });
    return true;
  }

  if (message?.type === 'JR_INJECT_LIST_BADGES') {
    const scores = Array.isArray(message.scores) ? message.scores : [];
    const tabId = Number(message.tabId);
    const run = (id) => {
      sendTabMessageWithInject(id, { type: 'JR_INJECT_RELEVANCE_BADGES', scores }, sendResponse);
    };
    if (Number.isFinite(tabId) && tabId > 0) {
      run(tabId);
      return true;
    }
    queryActiveTab({ windowId: message.windowId }).then((tab) => {
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      run(tab.id);
    });
    return true;
  }

  if (message?.type === 'JR_COPY_TEXT') {
    copyViaOffscreen(message.text).then((resp) => sendResponse(resp));
    return true;
  }

  // Proxy fetch via service worker - more reliable than sidepanel fetch on some Chrome builds.
  if (message?.type === 'JR_FETCH_JSON') {
    const url = String(message.url || '');
    const timeoutMs = Number(message.timeoutMs) > 0 ? Number(message.timeoutMs) : 45000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const opts = message.options && typeof message.options === 'object' ? message.options : {};
    fetch(url, { ...opts, signal: controller.signal })
      .then(async (response) => {
        const raw = await response.text();
        let data = null;
        if (raw) {
          try {
            data = JSON.parse(raw);
          } catch {
            data = null;
          }
        }
        sendResponse({
          ok: true,
          status: response.status,
          statusText: response.statusText || '',
          raw,
          data,
        });
      })
      .catch((err) => {
        const name = err && err.name ? String(err.name) : '';
        const msg = err && err.message ? String(err.message) : String(err || 'network error');
        sendResponse({
          ok: false,
          aborted: name === 'AbortError' || name === 'TimeoutError',
          error: msg,
          errorName: name,
        });
      })
      .finally(() => clearTimeout(timer));
    return true;
  }

  return false;
});
