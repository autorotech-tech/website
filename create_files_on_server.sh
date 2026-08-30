#!/bin/bash
# Создать файлы напрямую на сервере через SSH

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 << 'ENDSSH'

# Создать директории
mkdir -p /home/vladx/autoro-blog/app/api/admin/posts
mkdir -p /home/vladx/autoro-blog/lib/supabase
mkdir -p /home/vladx/autoro-blog/lib

# Backup существующих файлов
cd /home/vladx/autoro-blog
if [ -f "app/api/admin/posts/route.ts" ]; then
    cp app/api/admin/posts/route.ts app/api/admin/posts/route.ts.backup.$(date +%Y%m%d_%H%M%S)
    echo "Backup создан"
fi

ENDSSH

# Теперь создадим файлы через heredoc
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 'cat > /home/vladx/autoro-blog/lib/cors.ts' << 'EOF'
/**
 * CORS configuration for blog API
 */

export const ALLOWED_ORIGINS = [
  'https://swoop.autoro.tech',
  'https://autoro.tech',
  'https://cdn.autoro.tech',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
]

export function getCorsHeaders(origin?: string | null) {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Credentials'] = 'true'
  } else {
    // For development flexibility, allow all origins if not in list
    headers['Access-Control-Allow-Origin'] = origin || '*'
  }

  return headers
}

export const corsHeaders = getCorsHeaders()
EOF

ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 'cat > /home/vladx/autoro-blog/lib/supabase/api-client.ts' << 'EOF'
import { createClient } from '@supabase/supabase-js'

/**
 * Create a Supabase client using a provided JWT token
 * Used in API routes where token comes from Authorization header
 */
export function createClientWithToken(token: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables')
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
EOF

# route.ts слишком большой, скопируем через scp из локального файла
echo "Копирование route.ts..."
scp -i ~/.ssh/id_ed25519_autoro blog-autoro/app/api/admin/posts/route.ts vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

echo "Файлы созданы! Теперь перезапустите контейнер:"
echo "ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 'cd /home/vladx/autoro-blog && docker-compose restart autoro-blog-nextjs'"

