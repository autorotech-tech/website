/**
 * Offscreen document for reliable clipboard writes from MV3 side panel.
 * Background relays JR_OFFSCREEN_COPY here (reason: CLIPBOARD).
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'JR_OFFSCREEN_COPY') return false;
  const value = String(message.text || '');
  if (!value) {
    sendResponse({ ok: false, error: 'empty' });
    return false;
  }

  (async () => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        sendResponse({ ok: true, via: 'clipboard-api' });
        return;
      }
    } catch (_err) {
      /* fall through */
    }

    const ta = document.createElement('textarea');
    ta.value = value;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;inset:0;width:100%;height:40px;opacity:0.01;z-index:99999;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } finally {
      ta.remove();
    }
    sendResponse(ok ? { ok: true, via: 'execCommand' } : { ok: false, error: 'execCommand failed' });
  })();

  return true;
});
