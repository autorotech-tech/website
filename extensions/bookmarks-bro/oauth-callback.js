function parseHashParams() {
  const h = (window.location.hash || '').replace(/^#/, '');
  const q = new URLSearchParams(h);
  const search = new URLSearchParams(window.location.search);
  return { hash: q, search };
}

function decodeJwtEmail(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return '';
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const json = JSON.parse(atob(payload + pad));
    return String(json.email || json.user_metadata?.email || json.user_metadata?.full_name || '').trim();
  } catch {
    return '';
  }
}

(async () => {
  const msg = document.getElementById('msg');
  const { hash, search } = parseHashParams();

  const err =
    search.get('error_description') ||
    search.get('error') ||
    hash.get('error_description') ||
    hash.get('error');
  if (err) {
    msg.textContent = `Login error: ${err}`;
    return;
  }

  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const expiresIn = Number(hash.get('expires_in') || 0);

  if (search.get('code') && !accessToken) {
    msg.innerHTML =
      'Authorization code received (PKCE). Please add the extension redirect URL to Supabase or sign in using email/password. ' +
      '<a href="https://supabase.com/docs/guides/auth/social-login" target="_blank" rel="noreferrer">Documentation</a>';
    return;
  }

  if (!accessToken) {
    msg.textContent = 'Tokens not found in response. Verify the redirect URL configuration in Supabase (chrome-extension://.../oauth-callback.html).';
    return;
  }

  const email = decodeJwtEmail(accessToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = expiresIn > 0 ? now + expiresIn : 0;

  await chrome.storage.local.set({
    userAccessToken: accessToken,
    userRefreshToken: refreshToken || '',
    userEmail: email,
    userTokenExpiresAt: expiresAt,
  });

  msg.textContent = email ? `Login successful: ${email}. You can close this tab now.` : 'Login successful. You can close this tab now.';
  setTimeout(() => window.close(), 1200);
})().catch((e) => {
  const msg = document.getElementById('msg');
  if (msg) msg.textContent = String(e?.message || e);
});
