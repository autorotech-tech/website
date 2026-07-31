/**
 * Staging auth: login → bootstrap → ensure workspace.
 * Used by Playwright helpers and optional standalone scripts.
 */

export async function loginUser(apiBase, email, password) {
  const res = await fetch(`${apiBase}/api/v1/bookmarks/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const raw = await res.text()
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = { raw: raw.slice(0, 200) }
  }
  if (!res.ok) {
    throw new Error(`login failed HTTP ${res.status}: ${data?.detail || raw.slice(0, 120)}`)
  }
  if (!data?.accessToken) {
    throw new Error('login: missing accessToken')
  }
  return data
}

export async function bootstrapToken(apiBase, userAccessToken) {
  const res = await fetch(`${apiBase}/api/v1/bookmarks/bootstrap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${userAccessToken}`,
    },
    body: JSON.stringify({}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`bootstrap failed HTTP ${res.status}: ${data?.detail || res.statusText}`)
  }
  if (!data?.accessToken) {
    throw new Error('bootstrap: missing accessToken')
  }
  return data
}

export async function ensureWorkspace(apiBase, bootstrapAccessToken) {
  const res = await fetch(`${apiBase}/api/v1/bookmarks/workspaces/ensure`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bootstrapAccessToken}`,
    },
    body: JSON.stringify({}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`ensure failed HTTP ${res.status}: ${data?.detail || res.statusText}`)
  }
  const workspaceId = String(data?.workspaceId ?? '')
  if (!workspaceId) {
    throw new Error('ensure: missing workspaceId')
  }
  return { workspaceId, workspaceName: data?.workspaceName || workspaceId }
}

export function toEpochFromExpiresIn(expiresInSec) {
  const ttl = Number(expiresInSec || 0)
  if (!Number.isFinite(ttl) || ttl <= 0) return 0
  return Math.floor(Date.now() / 1000) + ttl
}

export async function buildAuthSession(apiBase, email, password, profileId = 'e2e-playwright') {
  const login = await loginUser(apiBase, email, password)
  const userAccessToken = String(login.accessToken)
  const bootstrap = await bootstrapToken(apiBase, userAccessToken)
  const { workspaceId, workspaceName } = await ensureWorkspace(apiBase, bootstrap.accessToken)

  return {
    apiBase,
    workspaceId,
    workspaceName,
    profileId,
    userAccessToken,
    userRefreshToken: String(login.refreshToken || ''),
    userEmail: String(login?.user?.email || email),
    userTokenExpiresAt: toEpochFromExpiresIn(login.expiresIn),
    accessToken: String(bootstrap.accessToken),
    tokenExpiresAt: toEpochFromExpiresIn(bootstrap.expiresIn),
    supabaseAuthPath: '/bb-supabase',
    autoSync: false,
  }
}

export function storagePatchFromSession(session) {
  return {
    apiBase: session.apiBase,
    workspaceId: session.workspaceId,
    workspaceResolvedAt: new Date().toISOString(),
    profileId: session.profileId,
    userAccessToken: session.userAccessToken,
    userRefreshToken: session.userRefreshToken,
    userEmail: session.userEmail,
    userTokenExpiresAt: session.userTokenExpiresAt,
    accessToken: session.accessToken,
    tokenExpiresAt: session.tokenExpiresAt,
    supabaseAuthPath: session.supabaseAuthPath,
    autoSync: session.autoSync,
  }
}
