import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function serviceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://api.autoro.tech'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
