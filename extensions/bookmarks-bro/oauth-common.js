/**
 * Swoop UI lives at the domain root; Supabase API — under /supabase (same as SUPABASE_URL in agent-api).
 */
function supabasePublicRoot(apiBase) {
  const b = String(apiBase || '')
    .trim()
    .replace(/\/$/, '');
  if (!b) return '';
  if (/\/supabase$/i.test(b)) return b;
  return `${b}/supabase`;
}

function buildBookmarksOAuthUrl(apiBase, provider) {
  const root = supabasePublicRoot(apiBase);
  const redirect = encodeURIComponent(chrome.runtime.getURL('oauth-callback.html'));
  return `${root}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${redirect}`;
}

function startBookmarksOAuth(apiBaseRaw, provider) {
  const apiBase = String(apiBaseRaw || '').trim().replace(/\/$/, '');
  if (!apiBase) return;
  const url = buildBookmarksOAuthUrl(apiBase, provider);
  chrome.tabs.create({ url, active: true });
}
