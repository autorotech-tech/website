# Cloudflare DNS — keept.me и поддомены

**Origin:** VPS `46.250.228.229` (тот же хост, что `swoop.autoro.tech`)  
**Registrar:** keept.me → nameservers на Cloudflare  
**Staging reference:** `https://swoop.autoro.tech/bookmarks-bro`, BB Supabase `https://swoop.autoro.tech/bb-supabase`

---

## Схема хостов

| Host | Назначение | Пользователь | Origin (nginx) |
|------|------------|--------------|----------------|
| `keept.me` | Marketing / redirect → app | Public | SPA `index.html` или 302 → `app.keept.me` |
| `www.keept.me` | Alias | Public | CNAME → `keept.me` |
| `app.keept.me` | User app (Bookmarks Bro) | BB Supabase auth | SPA, base path `/` или `/bookmarks-bro` |
| `admin.keept.me` | Keept Admin (moderation) | BB Supabase auth (admin role TBD) | SPA route `/keept/admin` |
| `auth.keept.me` | BB Supabase Kong (REST + Auth) | SDK | `proxy_pass` → `127.0.0.1:54325` |
| `api.keept.me` | agent-api (optional split) | Bearer / session | `proxy_pass` → agent-api (uvicorn) |

**Минимальный MVP:** один origin `app.keept.me` с path-based routing (как swoop) + `auth.keept.me` для Supabase.  
**Рекомендуемый prod:** split subdomains для CSP и cookie isolation.

---

## Cloudflare — DNS records

Зона: **keept.me**

| Type | Name | Content | Proxy | TTL |
|------|------|---------|-------|-----|
| `A` | `@` | `46.250.228.229` | Proxied 🟠 | Auto |
| `A` | `app` | `46.250.228.229` | Proxied | Auto |
| `A` | `admin` | `46.250.228.229` | Proxied | Auto |
| `A` | `auth` | `46.250.228.229` | Proxied | Auto |
| `A` | `api` | `46.250.228.229` | Proxied | Auto |
| `CNAME` | `www` | `keept.me` | Proxied | Auto |

> Если позже origin за другим IP — обновить все `A` записи разом.

---

## SSL/TLS (Cloudflare dashboard)

**SSL/TLS → Overview:** `Full (strict)`

1. **Edge Certificates:** Always Use HTTPS = ON, Automatic HTTPS Rewrites = ON, Minimum TLS 1.2
2. **Origin Server:** создать **Cloudflare Origin Certificate** (15 years), установить на nginx:
   - `/etc/ssl/cloudflare/keept.me.pem`
   - `/etc/ssl/cloudflare/keept.me.key`
3. На origin nginx: `listen 443 ssl` с origin cert; Cloudflare ↔ origin encrypted

**Staging на autoro.tech** — отдельная зона; keept.me не смешивать с `swoop.autoro.tech` сертификатами unless SAN includes both.

---

## Cloudflare — рекомендуемые настройки

### Speed

- **Brotli:** ON  
- **HTTP/2, HTTP/3:** ON  
- **Auto Minify:** OFF для JS/CSS (Vite уже минифицирует; двойная минификация ломает source maps)

### Caching

| Pattern | Cache |
|---------|--------|
| `app.keept.me/assets/*` | Cache Everything, Edge TTL 1 month |
| `app.keept.me/index.html` | Bypass cache |
| `admin.keept.me/*` | Bypass cache (authenticated admin) |
| `auth.keept.me/*` | Bypass cache |
| `api.keept.me/*` | Bypass cache |

**Cache Rule (example):**  
`(http.host eq "app.keept.me" and starts_with(http.request.uri.path, "/assets/"))` → Eligible for cache

### Security

- **WAF:** Managed rules ON  
- **Bot Fight Mode:** ON для `app` / `admin` (настроить allowlist для health checks)  
- **Rate limiting** (optional): `POST /api/v1/knowledge/capture` — 30 req/min per IP  

### Page Rules / Redirect Rules (optional)

| Rule | Action |
|------|--------|
| `http://keept.me/*` | Always HTTPS |
| `https://keept.me/` | 302 → `https://app.keept.me/` |
| `https://www.keept.me/*` | 301 → `https://app.keept.me$1` |

---

## nginx на origin (шаблон)

Файл: `/etc/nginx/sites-available/keept.me` (на VPS)

```nginx
# User app
server {
    listen 443 ssl http2;
    server_name app.keept.me;

    ssl_certificate     /etc/ssl/cloudflare/keept.me.pem;
    ssl_certificate_key /etc/ssl/cloudflare/keept.me.key;

    root /var/www/autoro-website/dist;
    index index.html;

    # SPA — React Router
    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;  # agent-api port — уточнить на VPS
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    include /path/to/ops/bookmarks-bro-supabase/nginx.bb-supabase.location.conf;
    # Или отдельный server на auth.keept.me — см. ниже
}

# Keept Admin — тот же dist, deep link /keept/admin
server {
    listen 443 ssl http2;
    server_name admin.keept.me;

    ssl_certificate     /etc/ssl/cloudflare/keept.me.pem;
    ssl_certificate_key /etc/ssl/cloudflare/keept.me.key;

    root /var/www/autoro-website/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# BB Supabase Kong — dedicated host (рекомендуется)
server {
    listen 443 ssl http2;
    server_name auth.keept.me;

    ssl_certificate     /etc/ssl/cloudflare/keept.me.pem;
    ssl_certificate_key /etc/ssl/cloudflare/keept.me.key;

    location / {
        proxy_pass http://127.0.0.1:54325/;
        proxy_http_version 1.1;
        proxy_set_header Connection close;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Optional: API-only subdomain
server {
    listen 443 ssl http2;
    server_name api.keept.me;

    ssl_certificate     /etc/ssl/cloudflare/keept.me.pem;
    ssl_certificate_key /etc/ssl/cloudflare/keept.me.key;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Apex marketing
server {
    listen 443 ssl http2;
    server_name keept.me www.keept.me;

    ssl_certificate     /etc/ssl/cloudflare/keept.me.pem;
    ssl_certificate_key /etc/ssl/cloudflare/keept.me.key;

    return 302 https://app.keept.me$request_uri;
}
```

**Deploy:** symlink `sites-enabled`, `nginx -t`, `systemctl reload nginx`.

Существующий snippet для path `/bb-supabase/`:  
`ops/bookmarks-bro-supabase/nginx.bb-supabase.location.conf`

---

## Frontend env (production build)

```bash
# .env.production на CI или VPS перед npm run build
VITE_AGENT_API_BASE=https://api.keept.me
# или единый origin:
# VITE_AGENT_API_BASE=https://app.keept.me

VITE_BOOKMARKS_SUPABASE_URL=https://auth.keept.me
```

**Supabase Dashboard (BB stack):** Site URL / Redirect URLs добавить:

- `https://app.keept.me/**`
- `https://admin.keept.me/**`
- `http://localhost:5173/**` (dev)

**Google OAuth** (если используется): Authorized redirect URIs → `https://auth.keept.me/auth/v1/callback`

---

## CSP / connect-src

Расширить CSP meta или nginx header для prod:

```
connect-src 'self'
  https://auth.keept.me
  https://api.keept.me
  https://app.keept.me
  wss://auth.keept.me;
```

См. текущие headers на `swoop.autoro.tech` и зеркалировать для keept hostnames.

---

## agent-api / CORS

В `agent-api` (или reverse proxy) разрешить origins:

- `https://app.keept.me`
- `https://admin.keept.me`
- staging: `https://swoop.autoro.tech`

---

## Чеклист перед go-live

- [ ] Cloudflare: зона keept.me, NS делегированы
- [ ] DNS A/CNAME записи (таблица выше)
- [ ] Origin certificate на VPS
- [ ] nginx vhost + `nginx -t`
- [ ] `npm run build` с prod env vars
- [ ] BB Supabase: redirect URLs + JWT audience
- [ ] OAuth providers updated
- [ ] Smoke: login → `app.keept.me/bookmarks-bro` → capture → `admin.keept.me/keept/admin` approve
- [ ] Cloudflare SSL mode = Full (strict)

---

## Staging vs prod

| | Staging | Prod |
|---|---------|------|
| App | `swoop.autoro.tech/bookmarks-bro` | `app.keept.me` |
| Admin | `swoop.autoro.tech/keept/admin` | `admin.keept.me/keept/admin` |
| Auth API | `swoop.autoro.tech/bb-supabase` | `auth.keept.me` |
| Agent API | same host `/api/v1` | `api.keept.me` or path |

Antigravity и Cursor тестируют на staging до переключения DNS keept.me.

---

## Связанные документы

- [ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md](./ANTIGRAVITY-KEEPT-ADMIN-CAPSTONE.md)
- [AUTH-SETUP.md](./AUTH-SETUP.md)
- [ops/bookmarks-bro-supabase/README.md](../../ops/bookmarks-bro-supabase/README.md)
