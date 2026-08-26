import crypto from 'node:crypto'
import fs from 'node:fs/promises'

// We will create workflows by calling n8n CLI via docker exec (requires docker socket in container).
const N8N_CONTAINER = process.env.N8N_CONTAINER || 'n8n'
const SUPABASE_DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER || 'supabase-db'
const N8N_DB_CONTAINER = process.env.N8N_DB_CONTAINER || 'n8n-db'
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'https://tech.autoro.tech'

const TEMPLATE_PATH = process.env.TEMPLATE_PATH || '/app/chat-agent-template.json'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 15_000)
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 5)

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function mustEnv(name, value) {
  if (!value) throw new Error(`Missing env: ${name}`)
}

function uuid() {
  return crypto.randomUUID()
}

function randomId(len = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  const bytes = crypto.randomBytes(len)
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''")
}

function patchWorkflowTemplate(rawTemplate, { botId, botName }) {
  const wf = JSON.parse(JSON.stringify(rawTemplate))

  // Export format is [ { ...workflow } ]
  const w = Array.isArray(wf) ? wf[0] : wf
  if (!w) throw new Error('Invalid template JSON')

  // We are cloning as a NEW workflow, but CLI import in this n8n version needs a workflowId.
  // We'll create a stub workflow in DB first (so clearing webhooks won't error), then import will update it.
  const newWorkflowId = randomId(16)
  w.id = newWorkflowId
  w.active = false
  w.name = `Chat Agent - ${botName || botId.slice(0, 8)}`

  // Required fields in n8n DB schema
  const v = uuid()
  w.versionId = v
  w.activeVersionId = v
  w.versionCounter = 1
  w.triggerCount = 1
  w.isArchived = false
  w.createdAt = new Date().toISOString()
  w.updatedAt = new Date().toISOString()

  // Strip export-only / instance-specific fields that break imports when cloning
  // (they reference old workflowId/projectId). Keep shared, but rewrite workflowId to the new one.
  if (Array.isArray(w.shared)) {
    w.shared = w.shared.map((s) => ({ ...s, workflowId: newWorkflowId }))
  }
  delete w.tags
  // Keep pinData/staticData/meta as empty values to satisfy types without carrying old instance data
  w.pinData = {}
  w.staticData = null
  w.meta = null

  const newWebhookId = uuid()

  // Patch webhook node
  const webhookNode = (w.nodes || []).find((n) => n?.type === 'n8n-nodes-base.webhook')
  if (!webhookNode) throw new Error('Template has no Webhook node')
  webhookNode.parameters = webhookNode.parameters || {}
  webhookNode.parameters.path = newWebhookId
  webhookNode.webhookId = newWebhookId

  // Return both workflow and production URL
  const productionUrl = `${WEBHOOK_BASE_URL.replace(/\/$/, '')}/webhook/${newWebhookId}`
  return { workflow: w, productionUrl, workflowId: newWorkflowId }
}

async function dockerExecIn(container, args) {
  // We rely on docker CLI inside this container (docker:cli image) + docker socket mount.
  const { spawn } = await import('node:child_process')
  return await new Promise((resolve, reject) => {
    const p = spawn('docker', ['exec', '-i', container, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    p.stdout.on('data', (d) => (out += d.toString('utf8')))
    p.stderr.on('data', (d) => (err += d.toString('utf8')))
    p.on('error', reject)
    p.on('close', (code) => {
      if (code === 0) resolve({ out, err })
      else reject(new Error(`docker exec failed (${code}): ${err || out}`))
    })
  })
}

async function listPendingBots() {
  const q = `select id, name from public.chat_agents where n8n_webhook_url is null and status = 'active' order by created_at desc limit ${BATCH_SIZE};`
  const raw = await dockerExecIn(SUPABASE_DB_CONTAINER, ['psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-F', '\t', '-c', q]).then(r => r.out)
  const rows = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, name] = l.split('\t')
      return { id, name }
    })
  return rows
}

async function setBotWebhook(botId, webhookUrl) {
  const id = sqlEscape(botId)
  const url = sqlEscape(webhookUrl)
  const q = `update public.chat_agents set n8n_webhook_url = '${url}' where id = '${id}'::uuid;`
  await dockerExecIn(SUPABASE_DB_CONTAINER, ['psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', q])
}

async function createN8nWorkflowStub({ workflowId, name, versionId }) {
  const id = sqlEscape(workflowId)
  const nm = sqlEscape(name)
  const v = sqlEscape(versionId)
  const now = new Date().toISOString()
  // Minimal viable workflow row (will be overwritten by import)
  const q =
    'insert into public.workflow_entity (' +
    'id, name, active, nodes, connections, ' +
    '"createdAt", "updatedAt", settings, "staticData", "pinData", "versionId", "triggerCount", "isArchived", "versionCounter", "activeVersionId"' +
    ') ' +
    // activeVersionId has FK to workflow_history; keep it NULL in stub (import will set correct values)
    `values ('${id}', '${nm}', false, '[]'::json, '{}'::json, '${now}', '${now}', '{}'::json, null, '{}'::json, '${v}', 1, false, 1, null) ` +
    `on conflict (id) do nothing;`
  await dockerExecIn(N8N_DB_CONTAINER, ['psql', '-U', 'n8n', '-d', 'n8n', '-v', 'ON_ERROR_STOP=1', '-c', q])
}

async function importWorkflow(jsonPathInContainer) {
  await dockerExecIn(N8N_CONTAINER, ['n8n', 'import:workflow', '--input', jsonPathInContainer])
}

async function findWorkflowIdByName(name) {
  const { out } = await dockerExecIn(N8N_CONTAINER, ['n8n', 'list:workflow', '--all'])
  const line = out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .find((l) => l.endsWith('|' + name))
  if (!line) return null
  return line.split('|')[0]
}

async function activateWorkflow(id) {
  await dockerExecIn(N8N_CONTAINER, ['n8n', 'update:workflow', `--id=${id}`, '--active=true'])
}

async function writeTemplateToContainer(localJson) {
  // Copy via docker cp is not available from inside container; instead we write into /tmp via heredoc through docker exec sh.
  const payload = JSON.stringify(localJson)
  const b64 = Buffer.from(payload, 'utf8').toString('base64')
  const cmd = `echo '${b64}' | base64 -d > /tmp/chat-agent-new.json`
  await dockerExecIn(N8N_CONTAINER, ['sh', '-lc', cmd])
  return '/tmp/chat-agent-new.json'
}

async function loadTemplate() {
  const raw = await fs.readFile(TEMPLATE_PATH, 'utf8')
  return JSON.parse(raw)
}

async function provisionOne(bot) {
  const template = await loadTemplate()
  const { workflow, productionUrl, workflowId } = patchWorkflowTemplate(template, { botId: bot.id, botName: bot.name })

  // Create stub row first to avoid n8n import trying to clear webhooks for a non-existing workflow
  await createN8nWorkflowStub({ workflowId, name: workflow.name, versionId: workflow.versionId })

  const tmpPath = await writeTemplateToContainer([workflow])
  await importWorkflow(tmpPath)

  const wfId = await findWorkflowIdByName(workflow.name)
  if (!wfId) throw new Error(`Cannot find imported workflow by name: ${workflow.name}`)

  await activateWorkflow(wfId)
  await setBotWebhook(bot.id, productionUrl)
  // eslint-disable-next-line no-console
  console.log(`Provisioned bot ${bot.id} -> ${productionUrl} (workflow ${wfId})`)
}

async function main() {
  mustEnv('WEBHOOK_BASE_URL', WEBHOOK_BASE_URL)

  // eslint-disable-next-line no-console
  console.log('Provisioner started', { POLL_INTERVAL_MS, BATCH_SIZE, N8N_CONTAINER, SUPABASE_DB_CONTAINER })

  while (true) {
    try {
      const pending = await listPendingBots()
      for (const bot of pending) {
        try {
          await provisionOne(bot)
        } catch (e) {
          console.error('Provision failed for bot', bot?.id, e?.message || e)
        }
      }
    } catch (e) {
      console.error('Loop error', e?.message || e)
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})


