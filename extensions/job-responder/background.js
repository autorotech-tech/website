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

/** Notify side panel that the active tab navigated - clear stale Q&A. */
function broadcastActiveTabUrl(tabId, url) {
  if (!canInjectIntoUrl(url)) return;
  chrome.runtime
    .sendMessage({
      type: 'JR_TAB_NAVIGATED',
      tabId,
      url: String(url || ''),
    })
    .catch(() => {});
}

chrome.tabs.onActivated.addListener((info) => {
  chrome.tabs.get(info.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) return;
    broadcastActiveTabUrl(tab.id, tab.url);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  if (!tab?.active) return;
  const url = changeInfo.url || tab.url;
  if (!url) return;
  broadcastActiveTabUrl(tabId, url);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'JR_GET_VACANCY') return false;
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
      });
      return;
    }
    extractFromTab(tab.id, sendResponse);
  });
  return true;
});
