const PAGE_EXTRACT_FILE = 'content/page-extract.js';

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
      url,
      canExtract: canInjectIntoUrl(url),
    })
    .catch(() => {});
}

function broadcastTabRemoved(tabId) {
  chrome.runtime
    .sendMessage({
      type: 'JR_TAB_REMOVED',
      tabId,
    })
    .catch(() => {});
}

function notifyCurrentActiveTab(reason) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) return;
    broadcastActiveTab(tab, reason);
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

chrome.tabs.onRemoved.addListener((tabId) => {
  broadcastTabRemoved(tabId);
  // After close, re-read whatever is now active (debounced in sidepanel).
  setTimeout(() => notifyCurrentActiveTab('after_remove'), 50);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'JR_GET_VACANCY') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!canInjectIntoUrl(tab.url)) {
        sendResponse({
          ok: false,
          error: 'Откройте обычную http(s) страницу с вакансией (не chrome://)',
          tabId: tab.id,
          url: tab.url || '',
        });
        return;
      }
      extractFromTab(tab.id, (resp) => {
        sendResponse({
          ...(resp || { ok: false, error: 'Empty response' }),
          tabId: tab.id,
          url: tab.url || resp?.vacancy?.url || '',
        });
      });
    });
    return true;
  }

  if (message?.type === 'JR_GET_VACANCY_LIST') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      if (!canInjectIntoUrl(tab.url)) {
        sendResponse({
          ok: false,
          error: 'Откройте страницу поиска вакансий hh.ru (/search/vacancy)',
          tabId: tab.id,
          url: tab.url || '',
        });
        return;
      }
      sendTabMessageWithInject(tab.id, { type: 'JR_EXTRACT_VACANCY_LIST' }, (resp) => {
        sendResponse({
          ...(resp || { ok: false, error: 'Empty response' }),
          tabId: tab.id,
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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      run(tab.id);
    });
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
