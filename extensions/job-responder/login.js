const DEFAULT_API_BASE = 'https://swoop.autoro.tech';

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const loginSubmitBtn = document.getElementById('loginSubmitBtn');
const signupBtn = document.getElementById('signupBtn');
const errorEl = document.getElementById('error');
const successEl = document.getElementById('success');

async function getApiBase() {
  const saved = await chrome.storage.local.get(['jrApiBase']);
  return String(saved.jrApiBase || DEFAULT_API_BASE).trim().replace(/\/$/, '');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
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

function toEpochFromExpiresIn(expiresInSec) {
  const ttl = Number(expiresInSec || 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return 0;
  return Math.floor(Date.now() / 1000) + ttl;
}

async function persistSession(data, email) {
  await chrome.storage.local.set({
    userAccessToken: String(data.accessToken || ''),
    userRefreshToken: String(data.refreshToken || ''),
    userEmail: String(data?.user?.email || email),
    userTokenExpiresAt: toEpochFromExpiresIn(data?.expiresIn),
  });
}

async function submitLogin() {
  const email = String(emailInput?.value || '').trim();
  const password = String(passwordInput?.value || '').trim();
  if (!email || !password) {
    errorEl.textContent = 'Enter email and password';
    return;
  }
  errorEl.textContent = '';
  successEl.textContent = '';
  loginSubmitBtn.disabled = true;
  try {
    const apiBase = await getApiBase();
    const data = await fetchJson(`${apiBase}/api/v1/bookmarks/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    await persistSession(data, email);
    successEl.textContent = 'Login OK';
    setTimeout(() => window.close(), 600);
  } catch (err) {
    errorEl.textContent = String(err.message || err);
  } finally {
    loginSubmitBtn.disabled = false;
  }
}

async function submitSignup() {
  const email = String(emailInput?.value || '').trim();
  const password = String(passwordInput?.value || '').trim();
  if (!email || !password) {
    errorEl.textContent = 'Enter email and password';
    return;
  }
  errorEl.textContent = '';
  signupBtn.disabled = true;
  try {
    const apiBase = await getApiBase();
    const data = await fetchJson(`${apiBase}/api/v1/bookmarks/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (data?.accessToken) {
      await persistSession(data, email);
      successEl.textContent = 'Account created';
      setTimeout(() => window.close(), 600);
      return;
    }
    successEl.textContent = 'Account created - confirm email, then login';
  } catch (err) {
    errorEl.textContent = String(err.message || err);
  } finally {
    signupBtn.disabled = false;
  }
}

loginSubmitBtn.addEventListener('click', submitLogin);
signupBtn.addEventListener('click', submitSignup);
