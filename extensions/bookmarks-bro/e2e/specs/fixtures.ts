import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { test as base, expect } from '@playwright/test'
import { buildAuthSession, storagePatchFromSession } from '../helpers/auth.mjs'
import { getE2EConfig, requireE2ECredentials } from '../helpers/env.mjs'
import {
  cleanupTestBookmarks,
  closeExtensionContext,
  extensionUrl,
  injectTestBookmarks,
  launchExtensionContext,
  readExtensionStorage,
  seedExtensionStorage,
} from '../helpers/extension-context.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const testBookmarks = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/test-bookmarks.json'), 'utf8'),
) as Array<{ title: string; url: string }>

type KeeptFixtures = {
  extensionId: string
  apiBase: string
  session: Awaited<ReturnType<typeof buildAuthSession>>
  bookmarkIds: string[]
}

export const test = base.extend<KeeptFixtures>({
  extensionId: async ({}, use) => {
    const { extensionId } = await launchExtensionContext()
    await use(extensionId)
  },
  apiBase: async ({}, use) => {
    const { apiBase } = getE2EConfig()
    await use(apiBase)
  },
  session: async ({ apiBase }, use) => {
    const { email, password } = requireE2ECredentials()
    const session = await buildAuthSession(apiBase, email, password, 'e2e-playwright')
    await use(session)
  },
  bookmarkIds: async ({ extensionId }, use) => {
    const ids = await injectTestBookmarks(extensionId, testBookmarks)
    await use(ids)
    await cleanupTestBookmarks(ids)
  },
})

export { expect }

export { readExtensionStorage }

export async function seedSession(extensionId: string, session: KeeptFixtures['session']) {
  await seedExtensionStorage(extensionId, storagePatchFromSession(session))
}

export async function openPopup(extensionId: string) {
  const { context } = await launchExtensionContext()
  const page = await context.newPage()
  await page.goto(extensionUrl(extensionId, 'popup.html'), { waitUntil: 'domcontentloaded' })
  return page
}

export async function openOptions(extensionId: string) {
  const { context } = await launchExtensionContext()
  const page = await context.newPage()
  await page.goto(extensionUrl(extensionId, 'options.html'), { waitUntil: 'domcontentloaded' })
  return page
}

export async function openLogin(extensionId: string) {
  const { context } = await launchExtensionContext()
  const page = await context.newPage()
  await page.goto(extensionUrl(extensionId, 'login.html'), { waitUntil: 'domcontentloaded' })
  return page
}

test.afterAll(async () => {
  await closeExtensionContext()
})
