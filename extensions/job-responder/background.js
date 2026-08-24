const DEFAULT_API_BASE = 'https://swoop.autoro.tech';

const HH_HOSTNAME_RE = /(^|\.)hh\.(ru|kz|uz)$/i;

function isHhVacancyUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    const hostOk = HH_HOSTNAME_RE.test(u.hostname.toLowerCase());
    const pathOk = (u.pathname || '').includes('/vacancy/');
    return hostOk && pathOk;
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'JR_GET_VACANCY') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      // Content script exists only on vacancy pages (content/hh-vacancy.js)
      if (!tab.url || !isHhVacancyUrl(tab.url)) {
        sendResponse({ ok: false, notHh: true, error: 'Not a HH vacancy page' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: 'JR_EXTRACT_VACANCY' }, (resp) => {
        if (chrome.runtime.lastError) {
          // Try injecting the content script first, then retry
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content/hh-vacancy.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                return;
              }
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { type: 'JR_EXTRACT_VACANCY' }, (resp2) => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                    return;
                  }
                  sendResponse(resp2 || { ok: false, error: 'Empty response' });
                });
              }, 200);
            }
          );
          return;
        }
        sendResponse(resp || { ok: false, error: 'Empty response' });
      });
    });
    return true;
  }
  return false;
});
