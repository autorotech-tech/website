import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../../')

export function loadDotEnv() {
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

export function getE2EConfig() {
  const dotenv = loadDotEnv()
  const email =
    process.env.KEEPT_E2E_EMAIL ||
    process.env.BOOKMARKS_E2E_EMAIL ||
    dotenv.KEEPT_E2E_EMAIL ||
    dotenv.BOOKMARKS_E2E_EMAIL ||
    ''
  const password =
    process.env.KEEPT_E2E_PASSWORD ||
    process.env.BOOKMARKS_E2E_PASSWORD ||
    dotenv.KEEPT_E2E_PASSWORD ||
    dotenv.BOOKMARKS_E2E_PASSWORD ||
    ''
  const apiBase = (
    process.env.AGENT_API_BASE ||
    process.env.VITE_AGENT_API_BASE ||
    dotenv.AGENT_API_BASE ||
    dotenv.VITE_AGENT_API_BASE ||
    'https://swoop.autoro.tech'
  )
    .trim()
    .replace(/\/$/, '')

  return { email, password, apiBase, repoRoot }
}

export function requireE2ECredentials() {
  const cfg = getE2EConfig()
  if (!cfg.email || !cfg.password) {
    throw new Error(
      'Set KEEPT_E2E_EMAIL and KEEPT_E2E_PASSWORD (env or .env) for staging extension E2E.',
    )
  }
  return cfg
}
