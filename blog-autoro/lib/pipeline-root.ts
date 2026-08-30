import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

export function pipelineRoot() {
  if (process.env.BLOG_NEWS_ROOT) return path.resolve(process.env.BLOG_NEWS_ROOT)
  return path.resolve(process.cwd(), '..')
}

export async function loadPipelineLib<T = Record<string, unknown>>(name: string): Promise<T> {
  const file = path.join(pipelineRoot(), 'scripts', 'blog-news', 'lib', name)
  return import(pathToFileURL(file).href) as Promise<T>
}

export function scriptPath(name: string) {
  return path.join(pipelineRoot(), 'scripts', 'blog-news', name)
}

export function runNodeScript(script: string, args: string[] = [], timeoutMs = 15 * 60 * 1000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: pipelineRoot(),
      env: process.env,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`script timeout: ${script}`))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}
