/**
 * CAPTCHA stub — plug a provider later. No bypass-as-service.
 */
import type { Page } from 'playwright';

export type CaptchaResult = 'manual' | 'skipped' | 'todo';

const CAPTCHA_SELECTORS = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  'iframe[src*="turnstile"]',
  '.g-recaptcha',
  '.h-captcha',
  '[data-sitekey]',
  '#cf-challenge-running',
  'text=/captcha/i',
];

export async function detectCaptcha(page: Page): Promise<boolean> {
  for (const sel of CAPTCHA_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) return true;
    } catch {
      // continue
    }
  }
  return false;
}

/**
 * Stub solver.
 * CAPTCHA_MODE=manual → wait CAPTCHA_WAIT_MS (default 120s) for human
 * CAPTCHA_MODE=skip → return skipped
 * default → todo (log + short pause)
 */
export async function solveCaptcha(page: Page): Promise<CaptchaResult> {
  const mode = (process.env.CAPTCHA_MODE || 'todo').toLowerCase();
  const waitMs = Number(process.env.CAPTCHA_WAIT_MS || 120_000);

  const present = await detectCaptcha(page);
  if (!present) return 'skipped';

  console.warn('[captcha] Detected CAPTCHA on', page.url());

  if (mode === 'skip') {
    console.warn('[captcha] CAPTCHA_MODE=skip — leaving unresolved');
    return 'skipped';
  }

  if (mode === 'manual') {
    console.warn(`[captcha] Manual mode: solve in browser, waiting ${waitMs}ms…`);
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      await page.waitForTimeout(2000);
      if (!(await detectCaptcha(page))) {
        console.warn('[captcha] Appears cleared');
        return 'manual';
      }
    }
    console.warn('[captcha] Manual wait timed out');
    return 'manual';
  }

  // Future: 2captcha / CapSolver / etc. — implement behind this interface only.
  console.warn('[captcha] Stub: provider not configured (CAPTCHA_MODE=todo)');
  await page.waitForTimeout(1500);
  return 'todo';
}
