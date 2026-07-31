import { test, expect, seedSession, openOptions } from './fixtures'
import { checkHealth, getMetrics } from '../helpers/api-verify.mjs'

test.describe('Options connection', () => {
  test('resolve workspace and test connection against staging', async ({ extensionId, session, apiBase }) => {
    const health = await checkHealth(apiBase)
    expect(health.ok, `health HTTP ${health.status}`).toBeTruthy()

    await seedSession(extensionId, session)
    const page = await openOptions(extensionId)

    await expect(page.locator('#apiBase')).toHaveValue(apiBase)
    await page.locator('#ensureBtn').click()
    await expect(page.locator('#status')).toContainText(/Workspace|id=/i, { timeout: 30_000 })

    const workspaceId = await page.locator('#workspaceId').inputValue()
    expect(workspaceId.trim()).not.toBe('')

    await page.locator('#testBtn').click()
    await expect(page.locator('#status')).toContainText('OK: API is available', { timeout: 60_000 })

    const metrics = await getMetrics(apiBase, workspaceId, session.accessToken)
    expect(metrics.ok, `metrics HTTP ${metrics.status}`).toBeTruthy()

    await page.close()
  })
})
