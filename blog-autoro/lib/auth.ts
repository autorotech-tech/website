import { createClient } from '@supabase/supabase-js'
import { json } from './cors'

const ADMIN_EMAILS = (process.env.BLOG_ADMIN_EMAILS || 'autoro.tech@gmail.com')
  .split(',')
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean)

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://api.autoro.tech'
}

function supabaseAnon() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
}

export async function requireAdmin(request: Request) {
  const header = request.headers.get('authorization') || ''
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (!token) {
    return { error: json({ error: 'Unauthorized' }, { status: 401 }, request) }
  }
  const anon = supabaseAnon()
  if (!anon) {
    return { error: json({ error: 'Supabase anon key missing' }, { status: 500 }, request) }
  }
  const client = createClient(supabaseUrl(), anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user?.email) {
    return { error: json({ error: 'Unauthorized' }, { status: 401 }, request) }
  }
  const email = data.user.email.toLowerCase()
  if (!ADMIN_EMAILS.includes(email)) {
    return { error: json({ error: 'Forbidden' }, { status: 403 }, request) }
  }
  return { email, user: data.user, token }
}
