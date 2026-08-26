# Исправление CORS 503 для OPTIONS запросов

## Проблема:
- OPTIONS запрос (preflight) возвращает **503 Service Unavailable**
- CORS заголовки не возвращаются
- Браузер блокирует запрос

## Причины:
1. Nginx не обрабатывает OPTIONS для `/api/blog/`
2. Блог контейнер не отвечает на OPTIONS
3. Middleware не обрабатывает OPTIONS

## Решение:

### 1. Проверить что блог контейнер запущен и отвечает:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Проверить статус
docker ps | grep blog

# Проверить логи
docker logs autoro-blog-nextjs --tail 50

# Проверить что блог отвечает напрямую
curl -X OPTIONS http://localhost:3002/api/admin/posts \
  -H "Origin: https://swoop.autoro.tech" \
  -H "Access-Control-Request-Method: GET" \
  -v
```

### 2. Проверить Nginx конфигурацию для `/api/blog/`:

Нужно убедиться что в `/home/vladx/projects/autoro.tech/html/default.conf` есть обработка OPTIONS:

```nginx
location /api/blog/ {
    # Handle OPTIONS preflight
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
        add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
        add_header Access-Control-Max-Age "86400" always;
        return 204;
    }
    
    proxy_pass http://172.17.0.1:3002;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    
    # CORS headers
    add_header Access-Control-Allow-Origin "https://swoop.autoro.tech" always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;
}
```

### 3. Проверить middleware.ts в блоге:

Должен обрабатывать OPTIONS на уровне middleware:

```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://swoop.autoro.tech',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    })
  }
  // ... остальной код
}
```

### 4. Проверить что API route обрабатывает OPTIONS:

В `route.ts` уже есть:
```typescript
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}
```

Но нужно вернуть 204 вместо 200:
```typescript
export async function OPTIONS() {
  return new NextResponse(null, { 
    status: 204,
    headers: corsHeaders 
  })
}
```

## Быстрое исправление:

1. Исправить OPTIONS в route.ts (вернуть 204)
2. Проверить Nginx конфигурацию
3. Перезапустить контейнеры

