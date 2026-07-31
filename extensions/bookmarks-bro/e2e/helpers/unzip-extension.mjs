import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../../../')
const defaultOut = path.join(repoRoot, '.tmp/bookmarks-bro-e2e')

/**
 * Returns path to unpacked extension for Playwright --load-extension.
 * Prefers zip artifact; falls back to canonical folder.
 */
export function resolveExtensionPath(outDir = defaultOut) {
  const canonical = path.join(repoRoot, 'extensions/bookmarks-bro')
  const useZip = String(process.env.BOOKMARKS_BRO_E2E_USE_ZIP || '').trim() === '1'

  if (!useZip && fs.existsSync(path.join(canonical, 'manifest.json'))) {
    return canonical
  }

  const zipCandidates = [
    path.join(repoRoot, 'extensions/bookmarks-bro-0.3.3.zip'),
    path.join(repoRoot, 'extensions/bookmarks-bro-0.3.2.zip'),
  ]
  const zipPath = zipCandidates.find((p) => fs.existsSync(p))

  if (zipPath) {
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(outDir), { recursive: true })
    fs.mkdirSync(outDir, { recursive: true })
    execSync(`unzip -q -o "${zipPath}" -d "${outDir}"`, { stdio: 'pipe' })
    const nested = path.join(outDir, 'bookmarks-bro')
    if (fs.existsSync(path.join(nested, 'manifest.json'))) {
      return nested
    }
    if (fs.existsSync(path.join(outDir, 'manifest.json'))) {
      return outDir
    }
    throw new Error(`Zip ${zipPath} did not contain manifest.json`)
  }

  if (fs.existsSync(path.join(canonical, 'manifest.json'))) {
    return canonical
  }

  throw new Error('Extension not found: add extensions/bookmarks-bro or bookmarks-bro-0.3.3.zip')
}
