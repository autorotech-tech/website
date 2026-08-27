export const BLOG_LANGS = ['en', 'ru', 'es', 'it', 'fr', 'vi', 'kz']

export const LANG_LABELS = {
  en: 'English',
  ru: 'Russian',
  es: 'Spanish',
  it: 'Italian',
  fr: 'French',
  vi: 'Vietnamese',
  kz: 'Kazakh',
}

export const STATUSES = ['draft', 'pending', 'ready', 'rejected']

export const CATEGORIES = [
  'ai_marketing',
  'automation',
  'models',
  'business_cases',
  'implementation',
  'ai_news',
  'meta_ads',
  'google_ads',
  'reddit_social',
  'insights',
  'crypto',
  'manuals',
  'digital_marketing',
]

export function emptyLangBlock() {
  return {
    title: '',
    excerpt: '',
    html: '',
    metaTitle: '',
    metaDescription: '',
  }
}

export function emptyLangs() {
  return Object.fromEntries(BLOG_LANGS.map((lang) => [lang, emptyLangBlock()]))
}

export function langCoverage(item) {
  const langs = item?.langs || {}
  const present = BLOG_LANGS.filter((lang) => {
    const block = langs[lang]
    return Boolean(block?.title?.trim() && block?.html?.trim())
  })
  return { present, missing: BLOG_LANGS.filter((lang) => !present.includes(lang)) }
}
