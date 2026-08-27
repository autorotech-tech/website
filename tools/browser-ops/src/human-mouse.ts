/**
 * Human-like mouse: prefer mousecrack steps(); fall back to cubic Bezier if
 * onnxruntime-node is unavailable (e.g. macOS < 14).
 * Do NOT use mousecrack move() (robotjs / OS cursor) for browser automation.
 */
import os from 'node:os';
import type { Page } from 'playwright';

export type Point = { x: number; y: number };
export type Step = { x: number; y: number; t: number };

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bezierFallback(from: Point, to: Point): Step[] {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const n = Math.max(12, Math.min(60, Math.round(dist / 8)));
  const cx1 = from.x + (to.x - from.x) * 0.25 + (Math.random() - 0.5) * dist * 0.2;
  const cy1 = from.y + (to.y - from.y) * 0.1 + (Math.random() - 0.5) * dist * 0.25;
  const cx2 = from.x + (to.x - from.x) * 0.75 + (Math.random() - 0.5) * dist * 0.2;
  const cy2 = from.y + (to.y - from.y) * 0.9 + (Math.random() - 0.5) * dist * 0.25;
  const totalMs = 180 + dist * (0.4 + Math.random() * 0.35);
  const out: Step[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x =
      (1 - u) ** 3 * from.x +
      3 * (1 - u) ** 2 * u * cx1 +
      3 * (1 - u) * u ** 2 * cx2 +
      u ** 3 * to.x;
    const y =
      (1 - u) ** 3 * from.y +
      3 * (1 - u) ** 2 * u * cy1 +
      3 * (1 - u) * u ** 2 * cy2 +
      u ** 3 * to.y;
    out.push({ x, y, t: u * totalMs + (Math.random() * 2 - 1) });
  }
  out[out.length - 1] = { x: to.x, y: to.y, t: totalMs };
  return out;
}

let mousecrackWarned = false;

/** onnxruntime-node in mousecrack is built for macOS 14+ (Darwin 23+). */
function mousecrackUnsupportedOs(): boolean {
  if (process.env.FORCE_MOUSECRACK === '1') return false;
  if (process.env.SKIP_MOUSECRACK === '1') return true;
  if (process.platform === 'darwin') {
    const major = Number(os.release().split('.')[0] || 0);
    // Darwin 22 = macOS 13 Ventura; mousecrack/onnx needs 14+
    return major > 0 && major < 23;
  }
  return false;
}

/** Generate trajectory: mousecrack steps() or Bezier fallback. */
export async function generateSteps(from: Point, to: Point): Promise<Step[]> {
  if (mousecrackUnsupportedOs()) {
    if (!mousecrackWarned) {
      mousecrackWarned = true;
      console.warn(
        '[human-mouse] Skipping mousecrack on this OS (use FORCE_MOUSECRACK=1 to override). Bezier fallback.'
      );
    }
    return bezierFallback(from, to);
  }
  try {
    const mod = await import('mousecrack');
    return await mod.steps(from, to);
  } catch (e) {
    if (!mousecrackWarned) {
      mousecrackWarned = true;
      console.warn(
        '[human-mouse] mousecrack unavailable (often macOS < 14 / onnxruntime). Using Bezier fallback.',
        e instanceof Error ? e.message : e
      );
    }
    return bezierFallback(from, to);
  }
}

/** Replay trajectory on Playwright page.mouse. */
export async function humanMove(page: Page, from: Point, to: Point): Promise<void> {
  const trajectory = await generateSteps(from, to);
  let prevT = 0;
  for (const step of trajectory) {
    const delay = Math.max(0, step.t - prevT);
    if (delay > 0) await sleep(delay);
    await page.mouse.move(step.x, step.y);
    prevT = step.t;
  }
}

/** Move from approximate current position to target and click. */
export async function humanClick(
  page: Page,
  selector: string,
  options?: { button?: 'left' | 'right' | 'middle' }
): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click({ button: options?.button ?? 'left' });
    return;
  }

  const to: Point = {
    x: box.x + box.width / 2 + (Math.random() * 4 - 2),
    y: box.y + box.height / 2 + (Math.random() * 4 - 2),
  };

  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };
  const from: Point = {
    x: viewport.width * (0.35 + Math.random() * 0.3),
    y: viewport.height * (0.35 + Math.random() * 0.3),
  };

  await humanMove(page, from, to);
  await sleep(40 + Math.random() * 120);
  await page.mouse.down({ button: options?.button ?? 'left' });
  await sleep(30 + Math.random() * 80);
  await page.mouse.up({ button: options?.button ?? 'left' });
}

/** Type with small inter-key delays (not OS-level). */
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await locator.click({ timeout: 5_000 });
  await locator.fill('');
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: 20 + Math.random() * 60 });
  }
}
