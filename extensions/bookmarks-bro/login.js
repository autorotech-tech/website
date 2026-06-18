const DEFAULT_API_BASE =
  typeof BB_EXTENSION !== 'undefined' ? BB_EXTENSION.apiBaseDefault : 'https://swoop.autoro.tech';

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const signupBtn = document.getElementById('signupBtn');
const cancelBtn = document.getElementById('cancelBtn');
const googleOAuthBtn = document.getElementById('googleOAuthBtn');
const azureOAuthBtn = document.getElementById('azureOAuthBtn');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');

function setError(msg) {
  errorEl.textContent = msg || '';
}

function setSuccess(msg) {
  successEl.textContent = msg || '';
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAgentJson(url, options = {}) {
  let response;
  let networkErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      response = await fetch(url, options);
      networkErr = null;
      break;
    } catch (err) {
      networkErr = err;
      if (attempt < 3) await sleep(attempt * 800);
    }
  }
  if (!response) {
    throw new Error(`Network unavailable (${networkErr?.message || 'network error'})`);
  }
  const raw = await response.text();
  let data = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new Error(String(data?.detail || `HTTP ${response.status}`));
  }
  return data || {};
}

async function getApiBase() {
  const saved = await chrome.storage.local.get(['apiBase']);
  return String(saved.apiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
}

async function submitLogin() {
  const email = String(emailInput?.value || '').trim();
  const password = String(passwordInput?.value || '').trim();
  if (!email || !password) {
    setError('Enter email and password');
    return;
  }

  setError('');
  setSuccess('');
  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = 'Connecting...';
  try {
    const apiBase = await getApiBase();
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await chrome.storage.local.set({
      userAccessToken: String(data.accessToken || ''),
      userRefreshToken: String(data.refreshToken || ''),
      userEmail: String(data?.user?.email || email),
      userTokenExpiresAt: toEpochFromExpiresIn(data?.expiresIn),
    });
    setSuccess('Login successful. You can close this window.');
    setTimeout(() => {
      window.close();
    }, 700);
  } catch (err) {
    setError(String(err?.message || err));
    loginSubmitBtn.disabled = false;
    loginSubmitBtn.textContent = 'Login';
  }
}

function toEpochFromExpiresIn(expiresInSec) {
  const ttl = Number(expiresInSec || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  return Math.floor(Date.now() / 1000) + ttl;
}

async function submitSignup() {
  const email = String(emailInput?.value || '').trim();
  const password = String(passwordInput?.value || '').trim();
  if (!email || !password) {
    setError('Enter email and password');
    return;
  }
  setError('');
  setSuccess('');
  signupBtn.disabled = true;
  signupBtn.textContent = 'Creating...';
  try {
    const apiBase = await getApiBase();
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (data?.accessToken) {
      await chrome.storage.local.set({
        userAccessToken: String(data.accessToken || ''),
        userRefreshToken: String(data.refreshToken || ''),
        userEmail: String(data?.user?.email || email),
        userTokenExpiresAt: toEpochFromExpiresIn(data?.expiresIn),
      });
      setSuccess('Account created and logged in.');
      setTimeout(() => window.close(), 700);
      return;
    }
    setSuccess('Account created. Confirm email, then login.');
    signupBtn.disabled = false;
    signupBtn.textContent = 'Sign up';
  } catch (err) {
    setError(String(err?.message || err));
    signupBtn.disabled = false;
    signupBtn.textContent = 'Sign up';
  }
}

async function tryAutoRefreshSession() {
  const saved = await chrome.storage.local.get(['userAccessToken', 'userTokenExpiresAt', 'userRefreshToken']);
  const now = Math.floor(Date.now() / 1000);
  if (saved.userAccessToken && Number(saved.userTokenExpiresAt || 0) > now + 60) {
    setSuccess('Session already active.');
    setTimeout(() => window.close(), 500);
    return;
  }
  if (!saved.userRefreshToken) return;
  try {
    const apiBase = await getApiBase();
    const data = await fetchAgentJson(`${apiBase}/api/v1/bookmarks/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: String(saved.userRefreshToken) }),
    });
    if (data?.accessToken) {
      await chrome.storage.local.set({
        userAccessToken: String(data.accessToken || ''),
        userRefreshToken: String(data.refreshToken || saved.userRefreshToken),
        userEmail: String(data?.user?.email || ''),
        userTokenExpiresAt: toEpochFromExpiresIn(data?.expiresIn),
      });
      setSuccess('Session restored.');
      setTimeout(() => window.close(), 500);
    }
  } catch (_) {
    // user can continue with manual login
  }
}

loginSubmitBtn?.addEventListener('click', submitLogin);
signupBtn?.addEventListener('click', submitSignup);
cancelBtn?.addEventListener('click', () => window.close());

passwordInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitLogin();
  }
});

emailInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitLogin();
  }
});

googleOAuthBtn?.addEventListener('click', async () => {
  setError('');
  try {
    await startSupabaseOAuth('google');
    setSuccess('Google login window will open. Complete the login, focus will return automatically.');
  } catch (e) {
    setError(String(e?.message || e));
  }
});
azureOAuthBtn?.addEventListener('click', async () => {
  setError('');
  try {
    await startSupabaseOAuth('azure');
    setSuccess('Microsoft login window will open. Complete the login.');
  } catch (e) {
    setError(String(e?.message || e));
  }
});

tryAutoRefreshSession();
