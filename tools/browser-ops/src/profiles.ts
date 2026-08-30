/**
 * Resolve browser: GoLogin CDP (if token + profile_id) or Playwright persistent context.
 */
import { chromium, type Browser, type BrowserContext } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROFILES_ROOT = path.resolve(__dirname, '..', 'profiles');

export type OpenedBrowser = {
  mode: 'gologin' | 'persistent';
  browser: Browser | null;
  context: BrowserContext;
  /** Call after row finishes (stop GoLogin profile if needed). */
  close: () => Promise<void>;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Prefer system Chrome on older macOS where Playwright bundled Chromium is unsupported. */
function launchChannel(): 'chrome' | 'chromium' | undefined {
  const ch = env('BROWSER_CHANNEL');
  if (ch === 'chrome' || ch === 'chromium') return ch;
  // Default: chrome (works without `npx playwright install` on many Macs)
  return 'chrome';
}

async function startGoLoginProfile(profileId: string): Promise<{ wsUrl: string; stop: () => Promise<void> }> {
  const token = env('GOLOGIN_API_TOKEN');
  if (!token) throw new Error('GOLOGIN_API_TOKEN missing');

  const startRes = await fetch(`https://api.gologin.com/browser/${profileId}/web`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`GoLogin start failed (${startRes.status}): ${body.slice(0, 400)}`);
  }

  const data = (await startRes.json()) as { wsUrl?: string; remoteOrbitaUrl?: string };
  const wsUrl = data.wsUrl || data.remoteOrbitaUrl;
  if (!wsUrl) throw new Error('GoLogin response missing wsUrl');

  return {
    wsUrl,
    stop: async () => {
      try {
        await fetch(`https://api.gologin.com/browser/${profileId}/web`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // ignore stop errors
      }
    },
  };
}

/**
 * Open a browser for one registration row.
 * - If GOLOGIN_API_TOKEN + profileId → CDP via GoLogin
 * - Else Playwright launchPersistentContext under profiles/<id>
 */
export async function openProfile(profileId: string): Promise<OpenedBrowser> {
  const token = env('GOLOGIN_API_TOKEN');
  const headless = env('HEADLESS') === '1' || env('HEADLESS') === 'true';

  if (token && profileId) {
    const { wsUrl, stop } = await startGoLoginProfile(profileId);
    const browser = await chromium.connectOverCDP(wsUrl);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    return {
      mode: 'gologin',
      browser,
      context,
      close: async () => {
        await browser.close().catch(() => undefined);
        await stop();
      },
    };
  }

  const userDataDir = path.join(PROFILES_ROOT, sanitizeProfileId(profileId || 'default'));
  fs.mkdirSync(userDataDir, { recursive: true });

  const channel = launchChannel();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    channel,
    viewport: { width: 1280, height: 800 },
    locale: 'ru-RU',
    args: ['--disable-blink-features=AutomationControlled'],
  });

  return {
    mode: 'persistent',
    browser: null,
    context,
    close: async () => {
      await context.close();
    },
  };
}

function sanitizeProfileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'default';
}
