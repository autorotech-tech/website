#!/usr/bin/env npx tsx
/**
 * Table-driven registration / reverse-link runner.
 *
 * Usage:
 *   npx tsx src/register-run.ts --csv examples/registrations.csv
 *   npx tsx src/register-run.ts --csv examples/registrations.csv --dry-run
 *   npx tsx src/register-run.ts --help
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from 'playwright';
import { openProfile } from './profiles.js';
import { humanClick, humanType } from './human-mouse.js';
import { detectCaptcha, solveCaptcha } from './captcha.js';
import {
  loadSheet,
  parseExtraJson,
  sanitizeRuFormText,
  type RegistrationRow,
} from './sheet.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

type ResultRow = {
  profile_id: string;
  url: string;
  status: 'ok' | 'error' | 'dry-run' | 'captcha';
  final_url: string;
  error: string;
};

function parseArgs(argv: string[]) {
  const out = {
    csv: '',
    dryRun: false,
    help: false,
    limit: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--csv' || a === '-c') out.csv = argv[++i] || '';
    else if (a === '--limit') out.limit = Number(argv[++i] || 0);
  }
  return out;
}

function printHelp() {
  console.log(`browser-ops register-run

Usage:
  npx tsx src/register-run.ts --csv <path> [--dry-run] [--limit N]

Env:
  GOLOGIN_API_TOKEN   If set + profile_id → GoLogin CDP
  BROWSER_CHANNEL     chrome (default) | chromium
  HEADLESS            1/true for headless
  ROW_DELAY_MS        Delay between rows (default 3000)
  CAPTCHA_MODE        todo | manual | skip
  CAPTCHA_WAIT_MS     Manual wait (default 120000)

CSV columns (flexible headers):
  profile_id,url,email,password,name,phone,company,website,message,extra_json

Allowed use: own-data job-board signup, reverse/backlink submissions.
Refused: credential stuffing, account farms, CAPTCHA bypass-as-service.
`);
}

async function fillHeuristics(page: Page, row: RegistrationRow): Promise<void> {
  const fields: Array<{ value: string; selectors: string[] }> = [
    {
      value: row.email,
      selectors: [
        'input[type="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
        'input[autocomplete="email"]',
        '[data-testid*="email" i]',
      ],
    },
    {
      value: row.password,
      selectors: [
        'input[type="password"]',
        'input[name*="pass" i]',
        'input[id*="pass" i]',
        '[data-testid*="password" i]',
      ],
    },
    {
      value: row.name,
      selectors: [
        'input[name*="name" i]',
        'input[id*="name" i]',
        'input[autocomplete="name"]',
        'input[placeholder*="имя" i]',
        'input[placeholder*="name" i]',
        '[data-testid*="name" i]',
      ],
    },
    {
      value: row.phone,
      selectors: [
        'input[type="tel"]',
        'input[name*="phone" i]',
        'input[id*="phone" i]',
        'input[autocomplete="tel"]',
        '[data-testid*="phone" i]',
      ],
    },
    {
      value: row.company,
      selectors: [
        'input[name*="company" i]',
        'input[id*="company" i]',
        'input[placeholder*="компани" i]',
        '[data-testid*="company" i]',
      ],
    },
    {
      value: row.website,
      selectors: [
        'input[name*="website" i]',
        'input[name*="url" i]',
        'input[id*="website" i]',
        'input[type="url"]',
        '[data-testid*="website" i]',
      ],
    },
  ];

  for (const field of fields) {
    if (!field.value) continue;
    const value = sanitizeRuFormText(field.value);
    for (const sel of field.selectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await humanType(page, sel, value);
        break;
      }
    }
  }

  if (row.message) {
    const msg = sanitizeRuFormText(row.message);
    const msgSelectors = [
      'textarea',
      'textarea[name*="message" i]',
      'textarea[name*="comment" i]',
      '[contenteditable="true"]',
    ];
    for (const sel of msgSelectors) {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 400 }).catch(() => false)) {
        await humanType(page, sel, msg);
        break;
      }
    }
  }

  const extra = parseExtraJson(row.extra_json);
  for (const [selector, value] of Object.entries(extra)) {
    if (!value) continue;
    const loc = page.locator(selector).first();
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) {
      await humanType(page, selector, sanitizeRuFormText(value));
    }
  }
}

async function trySubmit(page: Page): Promise<void> {
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Зарегистрир")',
    'button:has-text("Register")',
    'button:has-text("Sign up")',
    'button:has-text("Submit")',
    'button:has-text("Отправить")',
    '[data-testid*="submit" i]',
  ];
  for (const sel of submitSelectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
      await humanClick(page, sel);
      return;
    }
  }
  console.warn('[register] No submit button found — skipping click');
}

async function processRow(row: RegistrationRow, dryRun: boolean): Promise<ResultRow> {
  const base: ResultRow = {
    profile_id: row.profile_id,
    url: row.url,
    status: 'ok',
    final_url: '',
    error: '',
  };

  if (dryRun) {
    console.log(`[dry-run] profile=${row.profile_id} url=${row.url} email=${row.email}`);
    return { ...base, status: 'dry-run', final_url: row.url };
  }

  const opened = await openProfile(row.profile_id);
  try {
    const page = opened.context.pages()[0] ?? (await opened.context.newPage());
    await page.goto(row.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800 + Math.random() * 700);

    if (await detectCaptcha(page)) {
      const captcha = await solveCaptcha(page);
      if (captcha === 'todo') {
        base.status = 'captcha';
        base.error = 'captcha_stub_todo';
        base.final_url = page.url();
        return base;
      }
    }

    await fillHeuristics(page, row);
    await page.waitForTimeout(400 + Math.random() * 600);
    await trySubmit(page);
    await page.waitForTimeout(1000);

    if (await detectCaptcha(page)) {
      const captcha = await solveCaptcha(page);
      if (captcha === 'todo') {
        base.status = 'captcha';
        base.error = 'captcha_after_submit';
      }
    }

    base.final_url = page.url();
    return base;
  } catch (e) {
    base.status = 'error';
    base.error = e instanceof Error ? e.message : String(e);
    return base;
  } finally {
    await opened.close();
  }
}

function writeResults(rows: ResultRow[]): string {
  const outDir = path.join(ROOT, 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(outDir, `results-${stamp}.csv`);
  const header = 'profile_id,url,status,final_url,error\n';
  const body = rows
    .map((r) =>
      [r.profile_id, r.url, r.status, r.final_url, r.error]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(',')
    )
    .join('\n');
  fs.writeFileSync(outPath, header + body + '\n', 'utf8');
  return outPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.csv) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const csvPath = path.isAbsolute(args.csv) ? args.csv : path.resolve(process.cwd(), args.csv);
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }

  let rows = loadSheet(csvPath);
  if (args.limit > 0) rows = rows.slice(0, args.limit);

  console.log(`Loaded ${rows.length} row(s) from ${csvPath}`);
  const delay = Number(process.env.ROW_DELAY_MS || 3000);
  const results: ResultRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    console.log(`\n=== Row ${i + 1}/${rows.length} ===`);
    const result = await processRow(rows[i], args.dryRun);
    results.push(result);
    console.log(result);
    if (i < rows.length - 1 && !args.dryRun && delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  const outPath = writeResults(results);
  console.log(`\nResults → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
