# browser-ops — table-driven registrations / reverse links

Legitimate marketing ops only:
- job-board / vacancy site signup with **your own** data
- reverse / backlink directory submissions
- similar form fills from a CSV

Not for: credential stuffing, account farms, CAPTCHA bypass-as-service.

## Setup

```bash
cd tools/browser-ops
npm install
# Chromium via Playwright may fail on older macOS (e.g. Ventura).
# Default BROWSER_CHANNEL=chrome uses installed Google Chrome.
npx playwright install chromium   # optional, if supported
cp .env.example .env
```

## Run

```bash
# Dry-run (parse CSV only)
npx tsx src/register-run.ts --csv examples/registrations.csv --dry-run

# Live: local persistent profile under profiles/<profile_id>
npx tsx src/register-run.ts --csv examples/registrations.csv --limit 1

# GoLogin: set GOLOGIN_API_TOKEN and use real profile_id column values
GOLOGIN_API_TOKEN=… npx tsx src/register-run.ts --csv examples/registrations.csv
```

Results: `out/results-<timestamp>.csv`.

## Mouse / CAPTCHA

- Human mouse: `mousecrack` `steps()` → Playwright `page.mouse` (see `src/human-mouse.ts`).
- On macOS Ventura (13) `onnxruntime-node` (mousecrack dependency) may fail to load — runner falls back to a Bezier trajectory automatically.
- Do **not** use `mousecrack` `move()` (robotjs / OS cursor) for browser flows — Accessibility permission only needed if you deliberately use OS move.
- CAPTCHA: stub in `src/captcha.ts` (`CAPTCHA_MODE=todo|manual|skip`). Plug a provider behind `solveCaptcha()` later.

## MCP notes

| Server | Role | Config |
|--------|------|--------|
| **Playwright MCP** | Agent scripts, multi-step flows | `npx -y @playwright/mcp@latest` |
| **cursor-ide-browser** | Built-in agent UI (snapshot/ref) | Cursor default |
| **browsermcp** | Your real Chrome tab via extension | see below |
| **gologin-mcp** | Profile management | token via env only |
| **puppeteer** | Legacy; often broken | leave `"disabled": true` |

### Enable Browser MCP (`browsermcp`)

1. Install [Browser MCP Chrome extension](https://chromewebstore.google.com/detail/browser-mcp-automate-your/bjfgambnhccakkhmkepdoekmckoijdlc) (Chrome / Brave).
2. Pin extension → open panel → **Connect** on the tab you want to automate.
3. In `~/.cursor/mcp.json` ensure entry exists (no `"disabled": true`):

```json
"browsermcp": {
  "command": "npx",
  "args": ["-y", "@browsermcp/mcp@latest"]
}
```

4. **Restart Cursor** → Settings → MCP → refresh `browsermcp`. Tools should appear (not "0 tools").
5. If `Client closed`: remove `@latest` or run `npm install -g @browsermcp/mcp@latest` and point `command` to global `dist/index.js` ([troubleshooting](https://docs.browsermcp.io/troubleshooting)).

**Limits:** Browser MCP controls one connected Chrome tab — good for agent exploration, not CSV batch runs. Use this CLI + Playwright for table-driven jobs.

## Stack comparison (brief)

| | Playwright + browser-ops | BrowserMCP + cursor-ide-browser | Selenium 4 + Grid | BAS |
|--|--------------------------|----------------------------------|-------------------|-----|
| CSV batch registrations | **Best** | No | Possible | **Best (Windows)** |
| GoLogin / anti-detect | CDP in runner | Extension session only | undetected-chromedriver | Built-in profiles |
| Human mouse | mousecrack `steps()` | N/A | Custom | Built-in |
| Cursor MCP / skills | **Best** | Good (interactive) | Weak | None |
| CAPTCHA plug-in | stub ready | manual in tab | provider DIY | RU modules common |
| macOS Ventura | **Yes** (Chrome channel) | **Yes** | Yes | **No** (Windows only) |

**Verdict:** keep Playwright + browser-ops as primary; BrowserMCP for live debugging in your Chrome; consider BAS only via Windows VM if captcha-heavy RU boards dominate and dev integration is secondary; Selenium is a middle ground without MCP upside.

## Logged-in Google profile (getting started)

Use this when the agent must act inside **your real Google session** (Gmail, Drive, OAuth apps). Headless/fresh contexts have no cookies — Puppeteer MCP and `cursor-ide-browser` alone will not work.

### Puppeteer MCP — leave disabled

| | |
|---|---|
| Package | `@modelcontextprotocol/server-puppeteer` (~2025.5.12) |
| Problem | Launches a **fresh Chromium** — no Google cookies; no connect-to-existing-Chrome in MCP |
| macOS Ventura | Sandbox / headless Chromium often fails; use `BROWSER_CHANNEL=chrome` with Playwright instead |
| Verdict | Keep `"disabled": true` in `~/.cursor/mcp.json` |

### Path A — BrowserMCP (interactive, fastest start)

Best for agent tasks in Cursor on an **already open** Chrome tab.

1. Install [Browser MCP extension](https://chromewebstore.google.com/detail/browser-mcp-automate-your/bjfgambnhccakkhmkepdoekmckoijdlc) (Chrome / Brave).
2. Open Gmail (or any Google app) and confirm you are logged in.
3. Extension panel → **Connect** on that tab (`Connected to tab: …`).
4. Restart Cursor if needed → Settings → MCP → refresh `browsermcp` (tools must appear, not `0 tools`).
5. Example prompt in Cursor:

```text
In BrowserMCP on the connected Gmail tab: open the latest unread message and return its subject.
```

**Limits:** one connected tab; not for CSV batch (use Path B or the CLI).

### Path B — Playwright persistent context (scripts / batch with Google session)

Best for scheduled runs or `browser-ops` with a profile that keeps Google cookies.

1. Find your Chrome profile (macOS):

```text
~/Library/Application Support/Google/Chrome/Default   # often "Person 1"
~/Library/Application Support/Google/Chrome/Profile 1 # "Person 2", etc.
```

2. **Close Chrome completely** (`Cmd+Q`), then copy profile once:

```bash
cp -r "$HOME/Library/Application Support/Google/Chrome/Default" \
  tools/browser-ops/profiles/google-main
```

3. Smoke test:

```bash
cd tools/browser-ops
BROWSER_CHANNEL=chrome npx tsx -e "
import { chromium } from 'playwright';
const ctx = await chromium.launchPersistentContext('profiles/google-main', {
  channel: 'chrome', headless: false
});
const page = await ctx.newPage();
await page.goto('https://mail.google.com');
await page.waitForTimeout(3000);
console.log('Title:', await page.title());
await ctx.close();
"
```

If the title contains `Gmail`, the session is preserved.

4. Optional — Playwright MCP with the same profile (agent in Cursor). In `~/.cursor/mcp.json`:

```json
"Playwright": {
  "command": "npx",
  "args": [
    "-y",
    "@playwright/mcp@latest",
    "--browser", "chrome",
    "--user-data-dir", "/Users/vlad_x/Desktop/n8n/autoro.tech/website/tools/browser-ops/profiles/google-main"
  ],
  "env": {}
}
```

Restart Cursor after editing. Chrome must be closed while Playwright uses this dir.

5. Example prompt:

```text
Use Playwright MCP: open https://mail.google.com and list the subjects of the 5 most recent inbox messages.
```

Refresh the profile copy when Google asks to sign in again (`cp -r …` step 2).

### What not to use for Google login

| Tool | Why |
|------|-----|
| `cursor-ide-browser` | Fresh browser context, no Google cookies |
| Puppeteer MCP | Fresh Chromium, no session |
| GoLogin profiles | Separate anti-detect profiles, not your personal Google |
| Playwright MCP without `--user-data-dir` | No saved session |

### macOS Ventura troubleshooting

| Issue | Fix |
|-------|-----|
| Playwright Chromium crash | `BROWSER_CHANNEL=chrome` |
| BrowserMCP `Client closed` | `npm install -g @browsermcp/mcp@latest`; point mcp.json to global `dist/index.js` |
| Profile locked | Quit Chrome fully before Playwright |
| Google re-login in copy | Re-copy `Default` → `profiles/google-main` |
| mousecrack / onnx fails | Auto Bezier fallback in `src/human-mouse.ts` |

## Skill

Project: `.cursor/skills/browser-ops/`  
Global symlink: `~/.cursor/skills/skills/browser-ops`
