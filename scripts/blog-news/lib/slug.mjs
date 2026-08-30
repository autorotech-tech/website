export function slugify(input, max = 80) {
  const raw = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
  const cut = raw.slice(0, max).replace(/-+$/g, '')
  return cut || 'item'
}

export function normalizeUrl(url) {
  try {
    const u = new URL(String(url).trim())
    u.hash = ''
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1)
    }
    return u.toString()
  } catch {
    return String(url || '').trim()
  }
}

export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
