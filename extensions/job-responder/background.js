const DEFAULT_API_BASE = 'https://swoop.autoro.tech';

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
      const tabId = tabs[0]?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tabId, { type: 'JR_EXTRACT_VACANCY' }, (resp) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse(resp || { ok: false, error: 'Empty response' });
      });
    });
    return true;
  }
  return false;
});

async function getApiBase() {
  const saved = await chrome.storage.local.get(['jrApiBase']);
  return String(saved.jrApiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
}
