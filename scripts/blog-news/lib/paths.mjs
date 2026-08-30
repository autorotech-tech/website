import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

export function repoRoot() {
  if (process.env.BLOG_NEWS_ROOT) {
    return path.resolve(process.env.BLOG_NEWS_ROOT)
  }
  return path.resolve(here, '../../..')
}

export function contentDir() {
  return path.join(repoRoot(), 'content', 'blog-news')
}

export function dataDir() {
  return path.join(repoRoot(), 'data')
}

export function configSourcesPath() {
  return path.join(repoRoot(), 'config', 'blog-news-sources.json')
}

export function runtimeSourcesPath() {
  return path.join(dataDir(), 'blog-news-sources.json')
}

export function ingestStatePath() {
  return path.join(dataDir(), 'blog-news-ingest-state.json')
}

export function settingsPath() {
  return path.join(dataDir(), 'blog-news-settings.json')
}

export function ensureDirs() {
  for (const dir of [contentDir(), dataDir()]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}
