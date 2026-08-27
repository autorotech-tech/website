import { createHash } from 'node:crypto'
import { promises as dns } from 'node:dns'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join as joinPath, extname, basename } from 'node:path'
import { promises as fs } from 'node:fs'
import { textToMarkdown } from './pdfMarkdown.mjs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const CHROMA_URL = process.env.CHROMA_URL || 'http://chroma:8000'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434'
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'qwen2.5:3b'

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000)
const MAX_HTML_BYTES = Number(process.env.MAX_HTML_BYTES || 2_000_000) // 2MB
const URL_TIMEOUT_MS = Number(process.env.URL_TIMEOUT_MS || 12_000)
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 1200)
const CHUNK_OVERLAP = Number(process.env.CHUNK_OVERLAP || 200)

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function isPrivateIPv4(ip) {
  // Basic IPv4 checks (covers most SSRF cases)
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false
  const [a, b] = ip.split('.').map(Number)
  if (a === 10) return true
  if (a === 127) return true
  if (a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

async function urlPassesNetworkPolicy(url) {
  const u = new URL(url)
  const host = u.hostname.toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false
  if (host === '0.0.0.0' || host === '127.0.0.1') return false

  // DNS resolution check (best-effort)
  try {
    const res = await dns.lookup(host, { all: true })
    for (const r of res) {
      if (r.family === 4 && isPrivateIPv4(r.address)) return false
    }
  } catch {
    // If DNS fails, reject (safer default)
    return false
  }
  return true
}

function stripHtmlToText(html) {
  let s = html
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
  s = s.replace(/<!--([\s\S]*?)-->/g, ' ')
  s = s.replace(/<[^>]+>/g, ' ')
  s = s.replace(/&nbsp;/g, ' ')
  s = s.replace(/&amp;/g, '&')
  s = s.replace(/&lt;/g, '<')
  s = s.replace(/&gt;/g, '>')
  s = s.replace(/\s+/g, ' ').trim()
  return s
}

function chunkText(text) {
  const clean = (text || '').trim()
  if (!clean) return []
  if (clean.length <= CHUNK_SIZE) return [clean]
  const chunks = []
  let i = 0
  while (i < clean.length) {
    const end = Math.min(clean.length, i + CHUNK_SIZE)
    chunks.push(clean.slice(i, end))
    if (end === clean.length) break
    i = Math.max(0, end - CHUNK_OVERLAP)
  }
  return chunks
}

async function supabaseRest(path, { method = 'GET', query, body } = {}) {
  const url = new URL(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v))
  }
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
  if (method !== 'GET') headers.Prefer = 'return=minimal'
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${url.pathname} failed: ${res.status} ${text}`)
  }
  return text ? JSON.parse(text) : null
}

function encodeStoragePath(p) {
  return p.split('/').map(encodeURIComponent).join('/')
}

async function downloadStorageObject(bucket, objectPath) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeStoragePath(objectPath)}`
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!res.ok) throw new Error(`Storage download failed: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  return buf
}

async function uploadStorageObject(bucket, objectPath, buffer, contentType) {
  const url = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${encodeStoragePath(objectPath)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: buffer,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Storage upload failed: ${res.status} ${text}`)
  }
}

async function patchSource(sourceId, body) {
  try {
    await supabaseRest('chat_agent_sources', {
      method: 'PATCH',
      query: { id: `eq.${sourceId}` },
      body,
    })
  } catch (err) {
    if (body && Object.keys(body).length > 1) {
      await supabaseRest('chat_agent_sources', {
        method: 'PATCH',
        query: { id: `eq.${sourceId}` },
        body: { status: body.status },
      })
    } else {
      throw err
    }
  }
}

async function pdfToText(buffer) {
  const dir = await fs.mkdtemp(joinPath(tmpdir(), 'chat-indexer-'))
  const inPath = joinPath(dir, 'doc.pdf')
  const outPath = joinPath(dir, 'out.txt')
  await fs.writeFile(inPath, buffer)
  await new Promise((resolve, reject) => {
    const p = spawn('pdftotext', ['-layout', '-q', inPath, outPath], { stdio: 'ignore' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`pdftotext exit ${code}`))))
  })
  const txt = await fs.readFile(outPath, 'utf8')
  await fs.rm(dir, { recursive: true, force: true })
  return txt
}

async function fetchHtmlText(url) {
  const u = new URL(url)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http/https allowed')
  if (!(await urlPassesNetworkPolicy(url))) throw new Error('URL blocked by network policy')
  if (/\.pdf($|\?)/i.test(url)) throw new Error('PDF by URL is not allowed')

  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), URL_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    })
    if (res.status >= 300 && res.status < 400) throw new Error('Redirects are not allowed')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!ct.includes('text/html') && !ct.includes('application/xhtml')) throw new Error(`Unsupported content-type: ${ct}`)
    const cl = res.headers.get('content-length')
    if (cl && Number(cl) > MAX_HTML_BYTES) throw new Error('HTML too large')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_HTML_BYTES) throw new Error('HTML too large')
    return stripHtmlToText(buf.toString('utf8'))
  } finally {
    clearTimeout(t)
  }
}

async function ollamaEmbedding(text) {
  const res = await fetch(`${OLLAMA_URL.replace(/\/$/, '')}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`Ollama embeddings error: ${res.status} ${JSON.stringify(data)}`)
  const emb = data?.embedding
  if (!Array.isArray(emb)) throw new Error('Ollama embedding missing')
  return emb
}

async function chromaIdentity() {
  const res = await fetch(`${CHROMA_URL.replace(/\/$/, '')}/api/v2/auth/identity`)
  if (!res.ok) throw new Error(`Chroma identity failed: ${res.status}`)
  return await res.json()
}

async function chromaRequest(path, { method = 'GET', body } = {}) {
  const url = `${CHROMA_URL.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Chroma ${method} ${path} failed: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

async function getTenantDb() {
  const id = await chromaIdentity()
  const tenant = id?.tenant || 'default_tenant'
  const db = (id?.databases && id.databases[0]) || 'default_database'
  return { tenant, db }
}

async function ensureCollection({ tenant, db, name, metadata }) {
  // Try get by name (collection_id path accepts name)
  try {
    const c = await chromaRequest(`/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}`)
    return c
  } catch {
    // create
  }
  const c = await chromaRequest(`/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections`, {
    method: 'POST',
    body: { name, get_or_create: true, metadata: metadata || null },
  })
  return c
}

async function deleteCollectionIfExists({ tenant, db, name }) {
  try {
    await chromaRequest(`/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    })
  } catch {
    // ignore
  }
}

async function upsertEmbeddings({ tenant, db, collectionId, ids, embeddings, documents, metadatas }) {
  return chromaRequest(
    `/api/v2/tenants/${encodeURIComponent(tenant)}/databases/${encodeURIComponent(db)}/collections/${encodeURIComponent(collectionId)}/upsert`,
    {
      method: 'POST',
      body: {
        ids,
        embeddings,
        documents,
        metadatas,
      },
    },
  )
}

function stableId(parts) {
  const h = createHash('sha256')
  for (const p of parts) h.update(String(p || ''))
  return h.digest('hex')
}

async function processJob(job) {
  const jobId = job.id
  console.log(`[job ${jobId}] start bot=${job.bot_id}`)
  const { tenant, db } = await getTenantDb()

  // load bot + role
  const bots = await supabaseRest('chat_agents', {
    query: { id: `eq.${job.bot_id}`, select: 'id,owner_user_id,name,bot_role,data_region' },
  })
  const bot = bots?.[0]
  if (!bot) throw new Error('Bot not found')
  const botRole = bot.bot_role || 'support'

  // sources (user)
  const sources = await supabaseRest('chat_agent_sources', {
    query: { bot_id: `eq.${job.bot_id}`, order: 'created_at.desc', select: '*' },
  })

  // base kb
  const baseKb = await supabaseRest('chat_agent_base_kb', {
    query: { role: `eq.${botRole}`, order: 'created_at.desc', select: '*' },
  })

  // reset collection for full index
  const collectionName = `chat_agent_${job.bot_id}`
  await deleteCollectionIfExists({ tenant, db, name: collectionName })
  const collection = await ensureCollection({
    tenant,
    db,
    name: collectionName,
    metadata: { bot_id: job.bot_id, role: botRole, data_region: bot.data_region || 'global' },
  })
  const collectionId = collection.id || collectionName

  // gather items
  const items = []
  for (const s of [...(baseKb || []), ...(sources || [])]) {
    const isBase = !!s.role
    items.push({ ...s, __is_base: isBase })
  }

  let upserted = 0
  const sourceErrors = []

  for (const item of items) {
    const sourceType = item.source_type
    const sourceId = item.id
    const title = item.title || item.url || item.storage_path || 'untitled'
    console.log(`[job ${jobId}] source ${sourceId} type=${sourceType} title=${title}`)

    try {
      if (!item.__is_base) {
        await patchSource(sourceId, { status: 'converting', error: null })
      }

      let text = ''
      let markdownPath = null
      if (sourceType === 'url') {
        text = await fetchHtmlText(item.url)
      } else if (sourceType === 'upload') {
        if (!item.storage_path) throw new Error('Missing storage_path')
        const buf = await downloadStorageObject('user_uploads', item.storage_path)
        const ext = extname(item.storage_path || item.title || '').toLowerCase()
        if (ext === '.pdf') {
          const raw = await pdfToText(buf)
          text = textToMarkdown(raw, basename(item.title || item.storage_path || 'document.pdf'))
          markdownPath = `${item.storage_path}.md`
          try {
            await uploadStorageObject('user_uploads', markdownPath, Buffer.from(text, 'utf8'), 'text/markdown; charset=utf-8')
          } catch (uploadErr) {
            console.error(`[job ${jobId}] markdown sidecar failed`, uploadErr)
            markdownPath = null
          }
        } else if (ext === '.md' || ext === '.txt' || ext === '.csv') {
          text = buf.toString('utf8')
        } else {
          text = buf.toString('utf8')
        }
      } else {
        throw new Error(`Unsupported source_type: ${sourceType}`)
      }

      const chunks = chunkText(text)
      if (!chunks.length) throw new Error('empty_document')

      const ids = []
      const documents = []
      const metadatas = []
      const embeddings = []

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i]
        const chunkId = stableId([job.bot_id, sourceId, i, chunk.slice(0, 200)])
        ids.push(chunkId)
        documents.push(chunk)
        metadatas.push({
          bot_id: job.bot_id,
          role: botRole,
          source_id: sourceId,
          source_type: sourceType,
          is_base: !!item.__is_base,
          title: String(title).slice(0, 300),
          chunk_index: i,
          converted: extname(item.storage_path || '').toLowerCase() === '.pdf' ? 'pdf_markdown' : 'none',
        })
        embeddings.push(await ollamaEmbedding(chunk))
      }

      await upsertEmbeddings({ tenant, db, collectionId, ids, embeddings, documents, metadatas })
      upserted += ids.length

      if (!item.__is_base) {
        const doneBody = { status: 'done', error: null }
        if (markdownPath) doneBody.markdown_path = markdownPath
        await patchSource(sourceId, doneBody)
      }
    } catch (sourceErr) {
      const message = String(sourceErr?.message || sourceErr)
      console.error(`[job ${jobId}] source ${sourceId} error`, sourceErr)
      sourceErrors.push(`${title}: ${message}`)
      if (!item.__is_base) {
        await patchSource(sourceId, { status: 'error', error: message.slice(0, 500) }).catch(() => {})
      }
    }
  }

  console.log(`[job ${jobId}] done upserted=${upserted} errors=${sourceErrors.length}`)
  if (!upserted && sourceErrors.length) {
    throw new Error(sourceErrors.join('; '))
  }
  return { upserted, errors: sourceErrors }
}

async function claimNextJob() {
  // find oldest queued job
  const list = await supabaseRest('chat_agent_index_jobs', {
    query: { status: 'eq.queued', order: 'created_at.asc', limit: 1, select: '*' },
  })
  const job = list?.[0]
  if (!job) return null

  // try claim
  const updated = await supabaseRest('chat_agent_index_jobs', {
    method: 'PATCH',
    query: { id: `eq.${job.id}`, status: 'eq.queued' },
    body: { status: 'running', started_at: new Date().toISOString() },
  })

  // PostgREST returns [] unless Prefer header; we just re-fetch to confirm
  const check = await supabaseRest('chat_agent_index_jobs', {
    query: { id: `eq.${job.id}`, select: '*' },
  })
  const claimed = check?.[0]
  if (!claimed || claimed.status !== 'running') return null
  return claimed
}

async function finishJob(jobId, { status, error, result }) {
  const body = {
    status,
    error: error || null,
    finished_at: new Date().toISOString(),
  }
  await supabaseRest('chat_agent_index_jobs', { method: 'PATCH', query: { id: `eq.${jobId}` }, body })
  if (result) console.log(`[job ${jobId}] result`, result)
}

async function mainLoop() {
  console.log('Chat Indexer started', {
    CHROMA_URL,
    OLLAMA_URL,
    OLLAMA_EMBED_MODEL,
    POLL_INTERVAL_MS,
  })

  while (true) {
    try {
      const job = await claimNextJob()
      if (!job) {
        await sleep(POLL_INTERVAL_MS)
        continue
      }
      try {
        const result = await processJob(job)
        await finishJob(job.id, { status: 'done', error: null, result })
      } catch (e) {
        console.error(`[job ${job.id}] error`, e)
        await finishJob(job.id, { status: 'error', error: String(e?.message || e) })
      }
    } catch (e) {
      console.error('loop error', e)
      await sleep(Math.min(30_000, POLL_INTERVAL_MS * 3))
    }
  }
}

await mainLoop()


