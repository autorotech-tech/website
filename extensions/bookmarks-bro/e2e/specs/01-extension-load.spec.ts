import { test, expect } from './fixtures'
import { getExtensionPath } from '../helpers/extension-context.ts'
import { openPopup } from './fixtures'

test.describe('Extension load', () => {
  test('loads MV3 service worker and popup UI', async ({ extensionId }) => {
    const extensionPath = getExtensionPath()
    expect(extensionPath).toBeTruthy()

    const page = await openPopup(extensionId)
    await expect(page.locator('#syncBtn')).toBeVisible()
    await expect(page.locator('#buildHint')).toContainText(/0\.1\.3-testing|Build/)
    await page.close()
  })
})
