import { BLOG_LANGS, emptyLangBlock, LANG_LABELS, langCoverage } from './langs.mjs'
import { chatJson, chatCompletions } from './swoop-llm.mjs'

const SLOP = [
  /\u2014/g,
  /\u2013/g,
  /\bdelve(?:s|d|ing)?\b/gi,
  /\bin today's world\b/gi,
  /\bit's important to note that\b/gi,
  /\bunlock(?:s|ing)?\b/gi,
  /\belevate(?:s|d|ing)?\b/gi,
  /\bleverage(?:s|d|ing)?\b/gi,
  /\bgame-?changer\b/gi,
  /\bcutting-edge\b/gi,
]

export function stripAiSlop(text) {
  let out = String(text || '')
  out = out.replace(/\u2014/g, '-').replace(/\u2013/g, '-')
  out = out.replace(/[«»]/g, '"')
  out = out.replace(/→/g, '->')
  for (const re of SLOP) out = out.replace(re, '')
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

export function markdownToHtml(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  if (/<[a-z][\s\S]*>/i.test(text)) return text
  const lines = text.split(/\n/)
  const html = []
  let inList = false
  const closeList = () => {
    if (inList) {
      html.push('</ul>')
      inList = false
    }
  }
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        html.push('<ul>')
        inList = true
      }
      html.push(`<li>${inlineMd(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
      continue
    }
    closeList()
    if (/^###\s+/.test(line)) html.push(`<h3>${inlineMd(line.replace(/^###\s+/, ''))}</h3>`)
    else if (/^##\s+/.test(line)) html.push(`<h2>${inlineMd(line.replace(/^##\s+/, ''))}</h2>`)
    else if (/^#\s+/.test(line)) html.push(`<h1>${inlineMd(line.replace(/^#\s+/, ''))}</h1>`)
    else if (line.trim()) html.push(`<p>${inlineMd(line)}</p>`)
  }
  closeList()
  return html.join('\n')
}

function inlineMd(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function normalizeBlock(block) {
  const src = block || {}
  return {
    title: stripAiSlop(src.title || ''),
    excerpt: stripAiSlop(src.excerpt || ''),
    html: stripAiSlop(markdownToHtml(src.html || src.content || src.body || '')),
    metaTitle: stripAiSlop(src.metaTitle || src.meta_title || src.title || '').slice(0, 70),
    metaDescription: stripAiSlop(src.metaDescription || src.meta_description || src.excerpt || '').slice(0, 170),
  }
}

function sourceUserPayload(item) {
  return JSON.stringify({
    sourceUrl: item.sourceUrl,
    sourceTitle: item.sourceTitle,
    category: item.category,
    sourceText: String(item.sourceText || '').slice(0, 24000),
  })
}

export async function generateArticleTwoPhase(item, settings) {
  const model = settings.model
  const fallback = settings.fallbackModel
  const prompt = settings.rewritePrompt

  const en = await generateEn(item, prompt, model, fallback)
  const langs = { en }
  const others = BLOG_LANGS.filter((lang) => lang !== 'en')
  const batchSize = 3
  for (let i = 0; i < others.length; i += batchSize) {
    const batch = others.slice(i, i + batchSize)
    const translated = await generateLocales(en, batch, prompt, model, fallback)
    Object.assign(langs, translated)
  }

  if (settings.citeMode === 'footer' && item.sourceUrl) {
    for (const lang of BLOG_LANGS) {
      if (!langs[lang]) langs[lang] = emptyLangBlock()
      if (langs[lang].html && !/class="source-cite"/.test(langs[lang].html)) {
        langs[lang].html += `\n<p class="source-cite"><a href="${escapeAttr(item.sourceUrl)}" rel="nofollow noopener" target="_blank">Source</a></p>`
      }
    }
  }

  const coverage = langCoverage({ langs })
  return { langs, coverage }
}

async function generateEn(item, prompt, model, fallback) {
  const messages = [
    { role: 'system', content: `${prompt}\n\nLanguage: English only for this pass.\nReturn JSON: {"title","excerpt","html","metaTitle","metaDescription"}. html must be semantic HTML.` },
    { role: 'user', content: sourceUserPayload(item) },
  ]
  const json = await jsonWithFallback(messages, model, fallback)
  const block = normalizeBlock(json)
  if (!block.title || !block.html) throw new Error('EN rewrite missing title/html')
  return block
}

async function generateLocales(en, langs, prompt, model, fallback) {
  const messages = [
    {
      role: 'system',
      content: `${prompt}\n\nTranslate and adapt the English article. Do not add facts. Keep HTML structure. Locales: ${langs.map((l) => `${l} (${LANG_LABELS[l]})`).join(', ')}.\nReturn JSON object keyed by locale code, each {"title","excerpt","html","metaTitle","metaDescription"}.`,
    },
    { role: 'user', content: JSON.stringify({ en, locales: langs }) },
  ]
  const json = await jsonWithFallback(messages, model, fallback, 12000)
  const out = {}
  for (const lang of langs) {
    out[lang] = normalizeBlock(json[lang] || json[LANG_LABELS[lang]] || {})
  }
  return out
}

async function jsonWithFallback(messages, model, fallback, maxTokens = 8000) {
  try {
    const { json } = await chatJson({ model, messages, maxTokens, temperature: 0.2 })
    return json
  } catch (err) {
    if (!fallback || fallback === model) throw err
    const { json } = await chatJson({ model: fallback, messages, maxTokens, temperature: 0.2 })
    return json
  }
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export async function polishPlain(text, model) {
  const { content } = await chatCompletions({
    model,
    temperature: 0,
    maxTokens: 2000,
    messages: [
      { role: 'system', content: 'Remove AI slop. Keep meaning. ASCII quotes, hyphen -, arrow ->. Return the text only.' },
      { role: 'user', content: text },
    ],
  })
  return stripAiSlop(content)
}
