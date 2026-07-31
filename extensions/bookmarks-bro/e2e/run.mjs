#!/usr/bin/env node
/**
 * Cross-platform runner for Keept extension E2E (xvfb on Linux CI).
 */
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const config = path.join(__dirname, 'playwright.config.ts')
const args = ['playwright', 'test', '--config', config, ...process.argv.slice(2)]

const useXvfb =
  Boolean(process.env.CI) &&
  process.platform === 'linux' &&
  process.env.BOOKMARKS_BRO_E2E_NO_XVFB !== '1'

const cmd = useXvfb ? 'xvfb-run' : 'npx'
const cmdArgs = useXvfb ? ['-a', 'npx', ...args] : args

const result = spawnSync(cmd, cmdArgs, {
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
