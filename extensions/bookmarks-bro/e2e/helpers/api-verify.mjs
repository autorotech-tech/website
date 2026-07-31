/**
 * Server-side verification for extension E2E (Bearer bootstrap token).
 */

export async function checkHealth(apiBase) {
  const res = await fetch(`${apiBase}/api/v1/health`)
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function getSyncJob(apiBase, jobId, bootstrapToken) {
  const res = await fetch(`${apiBase}/api/v1/bookmarks/sync/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${bootstrapToken}` },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function getMetrics(apiBase, workspaceId, bootstrapToken) {
  const ws = encodeURIComponent(String(workspaceId))
  const res = await fetch(`${apiBase}/api/v1/bookmarks/metrics?workspaceId=${ws}`, {
    headers: { Authorization: `Bearer ${bootstrapToken}` },
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function searchKnowledge(apiBase, workspaceId, query, bootstrapToken) {
  const res = await fetch(`${apiBase}/api/v1/bookmarks/knowledge/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bootstrapToken}`,
    },
    body: JSON.stringify({
      workspaceId: String(workspaceId),
      query: String(query),
      limit: 10,
      semantic: true,
    }),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export async function pollSyncJob(
  apiBase,
  jobId,
  bootstrapToken,
  { timeoutMs = 300_000, intervalMs = 5_000 } = {},
) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await getSyncJob(apiBase, jobId, bootstrapToken)
    if (!last.ok) {
      return last
    }
    const status = String(last.data?.status || '').toLowerCase()
    const processed = Number(last.data?.processedItems || 0)
    const total = Number(last.data?.totalItems || 0)
    if (status === 'completed' || status === 'failed') {
      return last
    }
    if (total > 0 && processed >= total) {
      return last
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return last || { ok: false, status: 408, data: { error: 'poll_timeout' } }
}
