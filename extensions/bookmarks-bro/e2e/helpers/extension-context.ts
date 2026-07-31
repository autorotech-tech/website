import fs from 'fs'
import os from 'os'
import path from 'path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { resolveExtensionPath } from './unzip-extension.mjs'

export type ExtensionFixtures = {
  extensionPath: string
  context: BrowserContext
  extensionId: string
}

let sharedContext: BrowserContext | null = null
let sharedExtensionId = ''
let sharedExtensionPath = ''

export function getExtensionPath(): string {
  if (!sharedExtensionPath) {
    sharedExtensionPath = resolveExtensionPath()
  }
  return sharedExtensionPath
}

export async function launchExtensionContext(): Promise<{ context: BrowserContext; extensionId: string }> {
  if (sharedContext) {
    return { context: sharedContext, extensionId: sharedExtensionId }
  }

  const extensionPath = getExtensionPath()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keept-ext-e2e-'))

  const channelEnv = process.env.BOOKMARKS_BRO_E2E_CHANNEL
  const channel =
    channelEnv ||
    (process.platform === 'darwin' ? 'chrome' : undefined)

  const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--enable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  }
  if (channel) {
    launchOptions.channel = channel
  }

  const context = await chromium.launchPersistentContext(userDataDir, launchOptions)

  const bootstrap = await context.newPage()
  const swWait = context.waitForEvent('serviceworker', { timeout: 45_000 }).catch(() => null)
  await bootstrap.goto('about:blank', { waitUntil: 'load', timeout: 30_000 })
  await swWait

  const forcedId = String(process.env.BOOKMARKS_BRO_E2E_EXTENSION_ID || '').trim()
  if (forcedId) {
    const ok = await probeExtensionPage(context, forcedId, 'popup.html')
    if (!ok) {
      throw new Error(`BOOKMARKS_BRO_E2E_EXTENSION_ID=${forcedId} popup is not reachable`)
    }
    await bootstrap.close()
    sharedContext = context
    sharedExtensionId = forcedId
    return { context, extensionId: forcedId }
  }

  let extensionId = ''
  try {
    extensionId = await waitForExtensionId(context, 45_000)
  } catch (err) {
    throw new Error(
      `Failed to detect extension id from ${extensionPath}: ${err instanceof Error ? err.message : err}`,
    )
  }
  await bootstrap.close()
  sharedContext = context
  sharedExtensionId = extensionId
  return { context, extensionId }
}

export async function closeExtensionContext(): Promise<void> {
  if (sharedContext) {
    await sharedContext.close()
    sharedContext = null
    sharedExtensionId = ''
  }
}

const PLAYWRIGHT_HELPER_EXTENSION_ID = 'fignfifoniblkonapihmkfakmlgkbkcf'

async function waitForExtensionId(context: BrowserContext, timeoutMs = 60_000): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const candidateIds = collectExtensionIds(context).filter((id) => id !== PLAYWRIGHT_HELPER_EXTENSION_ID)
    for (const id of candidateIds) {
      const ok = await probeExtensionPage(context, id, 'popup.html')
      if (ok) return id
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Extension service worker not registered (check --load-extension path)')
}

function collectExtensionIds(context: BrowserContext): string[] {
  const ids = new Set<string>()
  for (const sw of context.serviceWorkers()) {
    const url = sw.url()
    if (url.startsWith('chrome-extension://')) {
      ids.add(new URL(url).host)
    }
  }
  for (const bg of context.backgroundPages()) {
    const url = bg.url()
    if (url.startsWith('chrome-extension://')) {
      ids.add(new URL(url).host)
    }
  }
  return [...ids]
}

async function probeExtensionPage(context: BrowserContext, extensionId: string, pageName: string): Promise<boolean> {
  const page = await context.newPage()
  try {
    const response = await page.goto(extensionUrl(extensionId, pageName), {
      waitUntil: 'domcontentloaded',
      timeout: 8_000,
    })
    return Boolean(response && response.ok())
  } catch {
    return false
  } finally {
    await page.close()
  }
}

export function extensionUrl(extensionId: string, page: string): string {
  return `chrome-extension://${extensionId}/${page}`
}

export async function openExtensionPage(extensionId: string, pageName: string): Promise<Page> {
  const { context } = await launchExtensionContext()
  const pg = await context.newPage()
  await pg.goto(extensionUrl(extensionId, pageName), { waitUntil: 'domcontentloaded' })
  return pg
}

export async function seedExtensionStorage(
  extensionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const page = await openExtensionPage(extensionId, 'options.html')
  await page.evaluate(async (data) => {
    await chrome.storage.local.set(data)
  }, patch)
  await page.close()
}

export async function readExtensionStorage(extensionId: string): Promise<Record<string, unknown>> {
  const page = await openExtensionPage(extensionId, 'options.html')
  const data = await page.evaluate(async () => chrome.storage.local.get(null))
  await page.close()
  return data as Record<string, unknown>
}

export async function injectTestBookmarks(
  extensionId: string,
  bookmarks: Array<{ title: string; url: string }>,
): Promise<string[]> {
  const page = await openExtensionPage(extensionId, 'options.html')
  const ids = await page.evaluate(async (items) => {
    const created: string[] = []
    for (const item of items) {
      const node = await chrome.bookmarks.create({
        title: item.title,
        url: item.url,
      })
      if (node?.id) created.push(String(node.id))
    }
    return created
  }, bookmarks)
  await page.close()
  return ids
}

export async function cleanupTestBookmarks(bookmarkIds: string[]): Promise<void> {
  if (!sharedContext || !bookmarkIds.length) return
  const page = await sharedContext.newPage()
  await page.goto(`chrome-extension://${sharedExtensionId}/options.html`)
  await page.evaluate(async (ids) => {
    for (const id of ids) {
      try {
        await chrome.bookmarks.remove(String(id))
      } catch {
        // already removed
      }
    }
  }, bookmarkIds)
  await page.close()
}
