#!/usr/bin/env node
/**
 * Интеграционный тест Bookmarks Bro API (agent-api).
 * Читает .env: VITE_BOOKMARKS_API_KEY, VITE_AGENT_API_BASE (опционально).
 * AGENT_API_BASE — полный URL API без /api/v1 (например http://127.0.0.1:8900).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

function loadEnv() {
  const envPath = path.join(repoRoot, '.env')
  const out = {}
  if (!fs.existsSync(envPath)) return out
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    let val = t.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    out[t.slice(0, eq).trim()] = val
  }
  return out
}

const env = loadEnv()
const apiKey =
  process.env.VITE_BOOKMARKS_API_KEY ||
  process.env.BOOKMARKS_API_KEY ||
  process.env.AGENT_API_KEY ||
  env.VITE_BOOKMARKS_API_KEY ||
  env.BOOKMARKS_API_KEY ||
  env.AGENT_API_KEY ||
  ''
const devBypass =
  String(process.env.AGENT_API_DEV_BYPASS_AUTH || env.AGENT_API_DEV_BYPASS_AUTH || '').toLowerCase() in
  { '1': true, true: true, yes: true, on: true }
const base = (
  process.env.AGENT_API_BASE ||
  process.env.VITE_AGENT_API_BASE ||
  env.VITE_AGENT_API_BASE ||
  ''
)
  .trim()
  .replace(/\/$/, '')

function apiUrl(pathname) {
  const p = pathname.startsWith('/') ? pathname : `/${pathname}`
  return base ? `${base}${p}` : p
}

function headers(extra = {}) {
  const h = { ...extra }
  if (apiKey) h['X-API-Key'] = apiKey
  return h
}

async function request(method, pathname, body) {
  try {
    const res = await fetch(apiUrl(pathname), {
      method,
      headers: headers(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { raw: text.slice(0, 200) }
    }
    return { ok: res.ok, status: res.status, data, networkError: null }
  } catch (err) {
    return { ok: false, status: 0, data: null, networkError: String(err?.cause?.code || err?.message || err) }
  }
}

let failed = 0

function pass(name, detail) {
  console.log(`[OK] ${name}: ${detail}`)
}

function fail(name, detail) {
  console.log(`[FAIL] ${name}: ${detail}`)
  failed += 1
}

console.log('Bookmarks Bro API test (0.1.1-testing)')
console.log('Base:', base || '(relative — задайте AGENT_API_BASE=http://127.0.0.1:8900)')

if (!apiKey && !devBypass) {
  fail('auth', 'Задайте VITE_BOOKMARKS_API_KEY в .env или AGENT_API_DEV_BYPASS_AUTH=1 для локального dev')
  console.error('\nAPI test aborted (auth).')
  process.exit(1)
}

const ensure = await request('POST', '/api/v1/bookmarks/workspaces/ensure')
if (ensure.networkError) {
  fail('network', `${ensure.networkError} — запустите agent-api (порт 8900) или укажите AGENT_API_BASE`)
  console.error('\nAPI test aborted (network).')
  process.exit(1)
}
if (!ensure.ok) {
  const hint =
    ensure.status === 502 || ensure.status === 504
      ? ' — staging upstream down/stale nginx DNS (check autoro-agent-api + reload autoro-frontend nginx)'
      : ensure.status === 401 || ensure.status === 403
        ? ' — check KEEPT_BOOKMARKS_API_KEY matches agent_api_key'
        : ''
  fail('workspaces/ensure', `HTTP ${ensure.status}${hint} ${JSON.stringify(ensure.data)}`)
} else {
  const ws = String(ensure.data?.workspaceId ?? '')
  pass('workspaces/ensure', `workspaceId=${ws}`)

  const sampleIdea = {
    id: `test-idea-${Date.now()}`,
    title: 'API test idea',
    context: 'Created by bookmarks-bro-api-test.mjs',
    originRefs: ['api-test'],
    priority: 'medium',
    status: 'draft',
    createdAt: new Date().toISOString(),
  }

  const put = await request('PUT', '/api/v1/bookmarks/workspace-ui-state', {
    workspaceId: ws,
    ideas: [sampleIdea],
    reminders: [],
    knowledgeItems: [],
  })
  if (!put.ok) {
    fail('workspace-ui-state PUT', `HTTP ${put.status} ${JSON.stringify(put.data)}`)
  } else {
    pass('workspace-ui-state PUT', JSON.stringify(put.data?.counts ?? put.data))
  }

  const get = await request('GET', `/api/v1/bookmarks/workspace-ui-state?workspaceId=${encodeURIComponent(ws)}`)
  if (!get.ok) {
    fail('workspace-ui-state GET', `HTTP ${get.status}`)
  } else {
    const ideas = get.data?.ideas ?? []
    const found = ideas.some((i) => i.id === sampleIdea.id)
    if (found) pass('workspace-ui-state GET', `round-trip idea id=${sampleIdea.id}`)
    else fail('workspace-ui-state GET', `idea not found in ${ideas.length} items`)
  }

  const exportRes = await request('POST', '/api/v1/knowledge/export', {
    workspaceId: ws,
    query: 'test',
    semantic: false,
    limit: 5,
  })
  if (!exportRes.ok) {
    fail('knowledge/export', `HTTP ${exportRes.status} (может быть пустая KB — проверьте вручную)`)
  } else {
    const md = String(exportRes.data?.markdown ?? '')
    pass('knowledge/export', `items=${exportRes.data?.itemCount ?? '?'} markdownLen=${md.length}`)
  }
}

if (failed > 0) {
  console.error(`\nAPI test failed: ${failed} check(s)`)
  process.exit(1)
}
console.log('\nAPI test passed.')
