/**
 * Shared Bookmarks Bro extension config (aligned with web app BOOKMARKS_BRO_BUILD).
 * Load via <script> in pages or importScripts() in the service worker.
 */
const BB_EXTENSION = {
  build: '0.1.1-testing',
  apiBaseDefault: 'https://swoop.autoro.tech',
  supabaseAuthPathDefault: '/bb-supabase',
  workspaceIdFallback: '1',
  webAppPath: '/bookmarks-bro',
};

function bbNormalizeApiBase(raw) {
  return String(raw || BB_EXTENSION.apiBaseDefault).trim().replace(/\/$/, '');
}

function bbWebAppUrl(apiBase) {
  return `${bbNormalizeApiBase(apiBase)}${BB_EXTENSION.webAppPath}`;
}

if (typeof self !== 'undefined' && typeof importScripts === 'function') {
  self.BB_EXTENSION = BB_EXTENSION;
  self.bbNormalizeApiBase = bbNormalizeApiBase;
  self.bbWebAppUrl = bbWebAppUrl;
}
