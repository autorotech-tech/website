#!/usr/bin/env node
/**
 * Merges SafeDep cloud MCP into ~/.cursor/mcp.json using credentials from repo .env.
 * Docs: https://docs.safedep.io/apps/mcp/overview
 * Headers: Authorization = raw API key, X-Tenant-ID = tenant domain.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const MCP_URL = 'https://mcp.safedep.io/model-context-protocol/threats/v1/mcp'

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) {
    console.error('Не найден .env:', envPath)
    process.exit(1)
  }
  const out = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    out[key] = val
  }
  return out
}

function main() {
  const env = loadEnv(path.join(repoRoot, '.env'))
  const apiKey =
    env.SAFEDEP_CLOUD_API_KEY?.trim() || env.SAFEDEP_API_KEY?.trim() || ''
  const tenant =
    env.SAFEDEP_CLOUD_TENANT_DOMAIN?.trim() ||
    env.SAFEDEP_TENANT_ID?.trim() ||
    env.SAFEDEP_TENANT_DOMAIN?.trim() ||
    ''

  if (!apiKey || !tenant) {
    console.error(
      'Задайте в .env: SAFEDEP_CLOUD_API_KEY и SAFEDEP_CLOUD_TENANT_DOMAIN (см. .env.example).',
    )
    process.exit(1)
  }

  const mcpPath = path.join(os.homedir(), '.cursor', 'mcp.json')
  let cfg = { mcpServers: {} }

  if (fs.existsSync(mcpPath)) {
    try {
      cfg = JSON.parse(fs.readFileSync(mcpPath, 'utf8'))
    } catch {
      console.error('Некорректный JSON:', mcpPath)
      process.exit(1)
    }
  }

  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') {
    cfg.mcpServers = {}
  }

  cfg.mcpServers.safedep = {
    url: MCP_URL,
    headers: {
      Authorization: apiKey,
      'X-Tenant-ID': tenant,
    },
  }

  fs.mkdirSync(path.dirname(mcpPath), { recursive: true })
  fs.writeFileSync(mcpPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8')

  console.log('SafeDep MCP записан в', mcpPath)
  console.log('Дальше: перезапустите Cursor → Settings → MCP Servers → проверьте safedep.')
  console.log('Тест: попросите агента установить npm-пакет safedep-test-pkg — должен быть блок.')
}

main()
