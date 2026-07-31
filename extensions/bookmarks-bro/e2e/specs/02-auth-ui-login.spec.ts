import { test, expect, openLogin, readExtensionStorage } from './fixtures'
import { requireE2ECredentials } from '../helpers/env.mjs'
import { seedExtensionStorage } from '../helpers/extension-context.ts'

test.describe('Auth UI login', () => {
  test('login.html email/password stores userAccessToken', async ({ extensionId, apiBase }) => {
    const { email, password } = requireE2ECredentials()

    await seedExtensionStorage(extensionId, {
      apiBase,
      supabaseAuthPath: '/bb-supabase',
    })

    const page = await openLogin(extensionId)

    await page.locator('#emailInput').fill(email)
    await page.locator('#passwordInput').fill(password)
    await page.locator('#loginSubmitBtn').click()

    await expect(page.locator('#success')).toContainText(/Login successful|logged in|Session/i, { timeout: 30_000 })

    const storage = await readExtensionStorage(extensionId)
    expect(String(storage.userAccessToken || '')).not.toBe('')
    expect(String(storage.userEmail || '')).toContain('@')

    await page.close()
  })
})
