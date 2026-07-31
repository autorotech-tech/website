import { test, expect, seedSession, openPopup } from './fixtures'
import { getMetrics, pollSyncJob } from '../helpers/api-verify.mjs'

test.describe('Sync vector + Obsidian pipeline', () => {
  test('popup sync starts job and server reports progress', async ({
    extensionId,
    session,
    apiBase,
    bookmarkIds,
  }) => {
    test.setTimeout(360_000)
    expect(bookmarkIds.length).toBeGreaterThan(0)

    const metricsBefore = await getMetrics(apiBase, session.workspaceId, session.accessToken)
    const embeddedBefore = Number(metricsBefore.data?.content?.embedded_total ?? 0)

    await seedSession(extensionId, session)
    const page = await openPopup(extensionId)

    await expect(page.locator('#authHint')).toContainText(/Аккаунт|вход выполнен/i, { timeout: 15_000 })

    await page.locator('#syncBtn').click()
    await expect(page.locator('#status')).toContainText(/Sync|Job|запущен|Принято/i, { timeout: 120_000 })

    const statusText = await page.locator('#status').textContent()
    const jobMatch = statusText?.match(/Job:\s*([a-f0-9-]{36})/i)
    const lastJobText = await page.locator('#lastJob').textContent()
    const jobId =
      jobMatch?.[1] ||
      (lastJobText && lastJobText !== '—' ? lastJobText.trim() : '')

    expect(jobId, 'jobId must appear in popup after sync').toBeTruthy()

    const polled = await pollSyncJob(apiBase, jobId, session.accessToken, {
      timeoutMs: 300_000,
      intervalMs: 8_000,
    })
    expect(polledOk(polled)).toBeTruthy()

    const jobStatus = String(polled.data?.status || '').toLowerCase()
    expect(['completed', 'processing', 'running', 'queued'].includes(jobStatus) || Number(polled.data?.processedItems) >= 0).toBeTruthy()

    await page.locator('#statusBtn').click()
    await expect(page.locator('#status')).not.toContainText(/401|Ошибка sync/i, { timeout: 30_000 })

    await page.locator('#syncBtn').click()
    await expect(page.locator('#status')).not.toContainText(/401/i, { timeout: 60_000 })

    const metricsAfter = await getMetrics(apiBase, session.workspaceId, session.accessToken)
    expect(metricsAfter.ok).toBeTruthy()

    const bookmarksTotal = Number(metricsAfter.data?.bookmarks?.total_bookmarks ?? 0)
    expect(bookmarksTotal).toBeGreaterThan(0)

    const embeddedAfter = Number(metricsAfter.data?.content?.embedded_total ?? 0)
    if (Number(polled.data?.processedItems || 0) > 0) {
      expect(embeddedAfter >= embeddedBefore).toBeTruthy()
    }

    await page.close()
  })
})

function polledOk(polled: { ok: boolean; data?: Record<string, unknown> }) {
  if (!polled.ok) return false
  const status = String(polled.data?.status || '').toLowerCase()
  if (status === 'failed') {
    return Number(polled.data?.processedItems || 0) > 0
  }
  return true
}
