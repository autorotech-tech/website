/**
 * Google Drive OAuth via Chrome Identity API (MV3).
 * Requires manifest.oauth2.client_id (Chrome Extension type in Google Cloud Console).
 * Manual token paste remains a fallback when client_id is a placeholder.
 */
const JR_DRIVE_AUTH = (() => {
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
  const STORAGE_KEYS = {
    folder: 'jrDriveFolderUrlOrId',
    connected: 'jrDriveConnected',
    manualToken: 'jrDriveAccessToken',
  };

  function getOAuthClientId() {
    const manifest = chrome.runtime.getManifest();
    return String(manifest?.oauth2?.client_id || '').trim();
  }

  function isOAuthConfigured() {
    const clientId = getOAuthClientId();
    if (!clientId) return false;
    if (/^YOUR_/i.test(clientId)) return false;
    if (/REPLACE/i.test(clientId)) return false;
    if (/__GOOGLE_OAUTH_CLIENT_ID__/i.test(clientId)) return false;
    return /\.apps\.googleusercontent\.com$/i.test(clientId);
  }

  function getAuthToken(interactive) {
    return new Promise((resolve, reject) => {
      if (!chrome.identity?.getAuthToken) {
        reject(new Error('chrome.identity недоступен в этом браузере'));
        return;
      }
      chrome.identity.getAuthToken({ interactive: Boolean(interactive) }, (token) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'OAuth failed'));
          return;
        }
        if (!token) {
          reject(new Error('Google не вернул access token'));
          return;
        }
        resolve(String(token));
      });
    });
  }

  function removeCachedAuthToken(token) {
    return new Promise((resolve) => {
      if (!token || !chrome.identity?.removeCachedAuthToken) {
        resolve();
        return;
      }
      chrome.identity.removeCachedAuthToken({ token }, () => resolve());
    });
  }

  function clearAllCachedAuthTokens() {
    return new Promise((resolve) => {
      if (!chrome.identity?.clearAllCachedAuthTokens) {
        resolve();
        return;
      }
      chrome.identity.clearAllCachedAuthTokens(() => resolve());
    });
  }

  async function connectInteractive() {
    if (!isOAuthConfigured()) {
      throw new Error(
        'OAuth client_id не настроен в manifest.json. См. docs/job-responder/drive.md'
      );
    }
    const token = await getAuthToken(true);
    await chrome.storage.local.set({ [STORAGE_KEYS.connected]: true });
    return token;
  }

  async function disconnect() {
    try {
      const token = await getAuthToken(false).catch(() => '');
      if (token) await removeCachedAuthToken(token);
    } catch {
      /* ignore */
    }
    await clearAllCachedAuthTokens();
    await chrome.storage.local.set({ [STORAGE_KEYS.connected]: false });
  }

  /**
   * Prefer Chrome Identity cached token; fall back to manually pasted token.
   * On 401-style identity errors, clears cache and retries once interactively.
   */
  async function resolveAccessToken({ allowInteractive = true, manualToken = '' } = {}) {
    const pasted = String(manualToken || '').trim();

    if (isOAuthConfigured()) {
      try {
        const token = await getAuthToken(false);
        if (token) {
          await chrome.storage.local.set({ [STORAGE_KEYS.connected]: true });
          return { accessToken: token, source: 'identity' };
        }
      } catch {
        /* try interactive or manual */
      }

      if (allowInteractive) {
        try {
          const token = await getAuthToken(true);
          await chrome.storage.local.set({ [STORAGE_KEYS.connected]: true });
          return { accessToken: token, source: 'identity' };
        } catch (err) {
          if (pasted) {
            return { accessToken: pasted, source: 'manual' };
          }
          throw err;
        }
      }
    }

    if (pasted) {
      return { accessToken: pasted, source: 'manual' };
    }

    if (!isOAuthConfigured()) {
      throw new Error(
        'Нужен OAuth: настройте client_id (см. drive.md) или вставьте access token вручную'
      );
    }
    throw new Error('Google Drive не подключён. Нажмите «Подключить Google Drive»');
  }

  /** After HTTP 401 from Drive API: drop cached token and get a fresh one. */
  async function refreshAfterUnauthorized(manualToken = '') {
    try {
      const stale = await getAuthToken(false).catch(() => '');
      if (stale) await removeCachedAuthToken(stale);
    } catch {
      /* ignore */
    }
    return resolveAccessToken({ allowInteractive: true, manualToken });
  }

  async function loadUiState() {
    const saved = await chrome.storage.local.get([
      STORAGE_KEYS.folder,
      STORAGE_KEYS.connected,
      STORAGE_KEYS.manualToken,
    ]);
    return {
      folderUrlOrId: String(saved[STORAGE_KEYS.folder] || ''),
      connected: Boolean(saved[STORAGE_KEYS.connected]),
      manualToken: String(saved[STORAGE_KEYS.manualToken] || ''),
      oauthConfigured: isOAuthConfigured(),
      scope: DRIVE_SCOPE,
    };
  }

  async function saveFolder(folderUrlOrId) {
    const value = String(folderUrlOrId || '').trim();
    await chrome.storage.local.set({ [STORAGE_KEYS.folder]: value });
    return value;
  }

  async function saveManualToken(token) {
    const value = String(token || '').trim();
    if (value) {
      await chrome.storage.local.set({ [STORAGE_KEYS.manualToken]: value });
    } else {
      await chrome.storage.local.remove(STORAGE_KEYS.manualToken);
    }
    return value;
  }

  return {
    DRIVE_SCOPE,
    STORAGE_KEYS,
    isOAuthConfigured,
    getOAuthClientId,
    connectInteractive,
    disconnect,
    resolveAccessToken,
    refreshAfterUnauthorized,
    loadUiState,
    saveFolder,
    saveManualToken,
  };
})();
