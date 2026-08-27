---
name: browser-ops
description: >-
  Table-driven browser registrations and reverse/backlink form submissions
  with Playwright (or GoLogin CDP) and mousecrack human mouse. Use when the
  user has a CSV/spreadsheet of signup fields, needs mass job-board
  registration, directory/backlink submissions, profile-based form fill, or
  human-like clicks via mousecrack steps(). Refuse fraud, account farms,
  credential stuffing, and CAPTCHA bypass-as-service.
---

# browser-ops

Legitimate marketing / ops automation for **own-data** flows:

- Mass registrations on **job vacancy / career sites** (user's real contact data)
- **Reverse / backlink** directory and similar public form submissions
- Spreadsheet/CSV → open browser profile → fill → submit

## Refuse

- Credential stuffing, account farms, ToS-evasion framing
- CAPTCHA bypass-as-service / selling captcha solves
- Storing secrets in git (use `.env` / env vars only)

## Allowed

- Job-board signup + reverse links with the **user's own** data from their sheet
- CAPTCHA: **pause / manual / future provider stub** only

## Stack locations

| Piece | Path |
|-------|------|
| Runner CLI | `tools/browser-ops/` |
| Skill (project) | `.cursor/skills/browser-ops/SKILL.md` |
| Global skill link | `~/.cursor/skills/skills/browser-ops` |
| Playwright MCP | `~/.cursor/mcp.json` → `npx -y @playwright/mcp@latest` |
| Agent UI browser | Cursor built-in `cursor-ide-browser` |

Optional MCP: `browsermcp` (Chrome extension + Connect — interactive only, not batch CSV), `puppeteer` (often broken, leave disabled). Primary: Playwright MCP + this CLI + `cursor-ide-browser`. GoLogin MCP for profile management; automation via CDP in the runner.

## Workflow

1. Prepare CSV/TSV with flexible headers mapped to:
   `profile_id,url,email,password,name,phone,company,website,message,extra_json`
2. Choose profile:
   - **GoLogin:** `GOLOGIN_API_TOKEN` + `profile_id` → start profile / CDP
   - **Local:** Playwright `launchPersistentContext(profiles/<id>)` (default `BROWSER_CHANNEL=chrome`)
3. Per row: goto → heuristic fill → humanClick submit → captcha stub → results CSV
4. Rate limit via `ROW_DELAY_MS`

### Run

```bash
cd tools/browser-ops
npx tsx src/register-run.ts --csv examples/registrations.csv --dry-run
npx tsx src/register-run.ts --csv examples/registrations.csv --limit 1
```

## Human mouse (mousecrack)

For **browser** flows always:

```ts
import { steps } from 'mousecrack';
// steps(from, to) → replay with page.mouse.move / down / up
```

Use project helper: `tools/browser-ops/src/human-mouse.ts` (`humanClick`, `humanMove`, `generateSteps`).

If mousecrack/onnxruntime fails (common on macOS 13), the helper uses a Bezier fallback — still drives Playwright `page.mouse`, not OS cursor.

**Do not** use mousecrack `move()` (robotjs / OS cursor) against Cursor IDE tabs or browser pages — it moves the system pointer and needs macOS Accessibility. OS move is only for non-browser desktop experiments; document that separately.

Related skill: `move-mouse` from mousecrack (OS-level). For this stack, prefer `browser-ops` + `steps()`.

## CAPTCHA stub

`tools/browser-ops/src/captcha.ts`:

- `detectCaptcha(page)` — common selectors
- `solveCaptcha(page)` → `'manual' | 'skipped' | 'todo'`
- Env: `CAPTCHA_MODE=todo|manual|skip`, `CAPTCHA_WAIT_MS`

Next step for plug-in: implement a real provider behind `solveCaptcha` only (no standalone bypass service). Keep API stable.

## HH / Russian form text

When filling Russian job forms / HH-style text:

| Avoid | Use |
|-------|-----|
| `—` | `-` |
| `→` | `->` |
| «ёлочки» | `"` ASCII |

Example: `"Process -> result" - automation`

(Helper: `sanitizeRuFormText` in `sheet.ts`.)

## Agent checklist

1. Confirm use case is own-data registration / backlinks (not farms)
2. Read CSV; dry-run first
3. Prefer local persistent profile unless GoLogin token present
4. Sensitive clicks via `humanClick` / mousecrack `steps`
5. On CAPTCHA → stub (manual wait or log); do not invent bypass
6. Write/read `out/results-*.csv`
7. Never commit `.env`, `profiles/`, or secrets

## MCP quick status (document for user)

- **Playwright:** `command: npx`, `args: ["-y", "@playwright/mcp@latest"]`
- **cursor-ide-browser:** interactive agent UI (snapshot/ref)
- **browsermcp:** install Chrome extension → Connect tab → `npx -y @browsermcp/mcp@latest` in mcp.json (no `"disabled": true`) → restart Cursor. For exploration, not CSV batch.
- **puppeteer:** often broken — leave `"disabled": true`
- **gologin-mcp:** optional; token via env, not in repo

## Stack choice (when to use what)

| Need | Use |
|------|-----|
| CSV batch registrations, GoLogin, mousecrack | **This CLI (Playwright)** |
| Agent debugging in real Chrome session | **browsermcp** + extension |
| **Logged-in Google** (Gmail, Drive) | **browsermcp** (Connect on tab) or Playwright `--user-data-dir` — see `tools/browser-ops/README.md` § Logged-in Google profile |
| Quick agent UI in Cursor (no Google session) | **cursor-ide-browser** |
| Mass RU boards + captcha modules, no code | **BAS** (Windows VM only; no native macOS) |
| Legacy infra / Grid scaling | Selenium 4 (middle ground, weak MCP) |

**Puppeteer MCP:** leave disabled — fresh Chromium, no Google cookies, Ventura sandbox issues.
