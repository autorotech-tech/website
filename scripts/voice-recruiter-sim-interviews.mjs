#!/usr/bin/env node
/**
 * Симуляция 3 текстовых собеседований через Swoop LLM (без микрофона).
 * Ключ: AUTORO_SCRAPE_API_KEY | SWOOP_API_KEY | AGENT_API_KEY | VITE_BOOKMARKS_API_KEY
 * Не печатает ключ. Пишет docs/voice-recruiter/sim-results.json + фрагмент для SUBMISSION.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const BASE = (process.env.AGENT_API_BASE || process.env.VITE_AGENT_API_BASE || 'https://swoop.autoro.tech').replace(/\/$/, '')

function loadKey() {
  for (const name of ['.env.local', '.env']) {
    const p = resolve(ROOT, name)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line || line.startsWith('#') || !line.includes('=')) continue
      const i = line.indexOf('=')
      const k = line.slice(0, i).trim()
      let v = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
      if (['AUTORO_SCRAPE_API_KEY', 'SWOOP_API_KEY', 'AGENT_API_KEY', 'VITE_BOOKMARKS_API_KEY'].includes(k) && v) {
        return v
      }
    }
  }
  return (
    process.env.AUTORO_SCRAPE_API_KEY ||
    process.env.SWOOP_API_KEY ||
    process.env.AGENT_API_KEY ||
    process.env.VITE_BOOKMARKS_API_KEY ||
    ''
  )
}

const SYSTEM = (role) => `Ты профессиональный AI-рекрутер. Ведёшь собеседование на русском.
Должность: ${role}.
Задай ровно 5 вопросов по очереди. Каждый ход: короткая реакция + следующий вопрос.
После 5 ответов выдай:
===ИТОГ===
Общая оценка: …
Сильные стороны: …
Слабые стороны: …
Рекомендации по развитию: …
Итоговая рекомендация: рекомендуется к найму | можно рассмотреть | пока не рекомендуется`

const CANDIDATE_ANSWERS = {
  'Python-разработчик': [
    'Меня зовут Алексей, 4 года пишу на Python, Django и FastAPI.',
    'Делал API для биллинга, покрывал pytest, деплой в Docker.',
    'Оптимизировал SQL-запросы, снижал latency с 800 до 120 мс.',
    'Работал с Celery, Redis, PostgreSQL, немного с asyncio.',
    'Ищу команду с сильной инженерией и code review.',
  ],
  'Менеджер по продажам': [
    'Работаю в B2B продажах 5 лет, SaaS и интеграторы.',
    'Перевыполнял план 3 квартала подряд на 120–140%.',
    'Веду полный цикл: discovery, демо, закрытие, upsell.',
    'CRM — AmoCRM и HubSpot, умею строить воронку.',
    'Мотивирует сложный продукт и длинный цикл сделки.',
  ],
  Маркетолог: [
    'Performance + контент, 3 года в e-commerce.',
    'Запускала Meta и Google Ads, CPA снизила на 35%.',
    'Делаю CJM, гипотезы, A/B лендингов.',
    'Стек: GA4, GTM, Notion, Figma базово.',
    'Хочу расти в product marketing.',
  ],
}

function extractTextFromStructuredDump(raw) {
  const chunks = []
  const patterns = [
    /"type"\s*:\s*"text"\s*,\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/g,
    /'type'\s*:\s*'text'\s*,\s*'text'\s*:\s*'((?:\\'|[^'])*)'/g,
  ]
  for (const re of patterns) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(raw))) {
      const unescaped = m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
      if (unescaped.trim()) chunks.push(unescaped)
    }
  }
  return chunks.join('\n').trim()
}

function normalizeLlmContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return normalizeLlmContent(part)
        if (part && typeof part === 'object') {
          if (part.type === 'thinking') return ''
          return String(part.text || part.content || '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  if (typeof content === 'string') {
    const trimmed = content.trim()
    if (
      trimmed.includes("'type': 'text'") ||
      trimmed.includes('"type": "text"') ||
      trimmed.includes("'type': 'thinking'")
    ) {
      const extracted = extractTextFromStructuredDump(trimmed)
      if (extracted) return extracted
    }
    return trimmed
  }
  if (content && typeof content === 'object') {
    if (content.type === 'thinking') return ''
    return String(content.text || content.content || '').trim()
  }
  return ''
}

async function chat(apiKey, messages) {
  const res = await fetch(`${BASE}/api/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      model: 'glm/glm-4-flash',
      messages,
      temperature: 0.5,
      max_tokens: 900,
    }),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const text = normalizeLlmContent(data?.choices?.[0]?.message?.content)
  if (!text) throw new Error('empty llm')
  return text
}

async function runRole(apiKey, role, answers) {
  const history = [
    { role: 'system', content: SYSTEM(role) },
    {
      role: 'user',
      content: `Начни собеседование на «${role}»: приветствие и первый вопрос.`,
    },
  ]
  const transcript = []
  let reply = await chat(apiKey, history)
  history.push({ role: 'assistant', content: reply })
  transcript.push({ role: 'AI-рекрутер', content: reply })

  for (const answer of answers) {
    history.push({ role: 'user', content: answer })
    transcript.push({ role: 'Кандидат', content: answer })
    reply = await chat(apiKey, history)
    history.push({ role: 'assistant', content: reply })
    transcript.push({ role: 'AI-рекрутер', content: reply })
  }

  return { role, transcript }
}

async function main() {
  const apiKey = loadKey()
  if (!apiKey) {
    console.error('No API key in env / .env.local')
    process.exit(1)
  }
  console.log(`Base: ${BASE}`)
  console.log(`Key length: ${apiKey.length}`)

  const results = []
  for (const [role, answers] of Object.entries(CANDIDATE_ANSWERS)) {
    process.stdout.write(`Interview: ${role}… `)
    const r = await runRole(apiKey, role, answers)
    results.push(r)
    console.log('ok')
  }

  const outJson = resolve(ROOT, 'docs/voice-recruiter/sim-results.json')
  writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf8')

  const primary = results[0]
  const mdLines = [
    '# Результаты симуляции (LLM, без микрофона)',
    '',
    `Base: ${BASE}`,
    `Дата: ${new Date().toISOString()}`,
    '',
  ]
  for (const r of results) {
    mdLines.push(`## ${r.role}`, '')
    for (const turn of r.transcript) {
      mdLines.push(`**${turn.role}:** ${turn.content}`, '')
    }
  }
  writeFileSync(resolve(ROOT, 'docs/voice-recruiter/sim-transcripts.md'), mdLines.join('\n'), 'utf8')

  const submissionSnippet = [
    '## Полный текст собеседования (симуляция кандидата текстом)',
    '',
    `Должность: ${primary.role}`,
    '',
    ...primary.transcript.map((t) => `**${t.role}:** ${t.content}\n`),
  ].join('\n')
  writeFileSync(
    resolve(ROOT, 'docs/voice-recruiter/submission-dialog-snippet.md'),
    submissionSnippet,
    'utf8',
  )
  console.log('Wrote docs/voice-recruiter/sim-results.json and transcripts')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
