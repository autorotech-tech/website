# 🔧 Исправления и начало разработки

## ⚠️ Проблемы и решения

### 1. SSL ошибка 525 на pquoc.com

**Проблема:** Cloudflare не может установить SSL соединение с origin сервером (возвращается 503).

**Причина:** Конфигурация nginx указывает на несуществующий WordPress путь.

**Решение:** Обновить конфигурацию nginx для pquoc.com.

### 2. Dev сервер недоступен по http://46.250.228.229:3000

**Проблема:** Порт 3000 не проброшен из контейнера.

**Решение:** 
- ✅ Добавлен `ports: - "3000:3000"` в docker-compose.yml
- Использовать SSH туннель для доступа

---

## 🚀 Команды для исправления

### Исправление pquoc.com

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Создать конфигурацию для nginx-proxy
cat > /tmp/pquoc.com_location << 'EOF'
root /home/vladx/projects/pquoc.com/html;
index index.html index.htm;

location / {
    try_files $uri $uri/ /index.html;
}

location ~ /\. {
    deny all;
    return 404;
}
EOF

# Скопировать в nginx-proxy
docker cp /tmp/pquoc.com_location nginx-proxy:/etc/nginx/vhost.d/pquoc.com_location

# Перезапустить nginx-proxy
docker restart nginx-proxy

# Проверить
curl -I -H "Host: pquoc.com" http://localhost/
```

### Запуск Dev сервера с доступом

**Вариант A: Через Docker (с проброшенным портом)**

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
docker-compose down
docker-compose up -d

# Проверить, что порт проброшен
docker ps | grep blog
# Должен показать 0.0.0.0:3000->3000/tcp
```

**Вариант B: SSH туннель (рекомендуется)**

```bash
# С локальной машины (Mac)
ssh -i ~/.ssh/id_ed25519_autoro -L 3000:localhost:3000 vladx@46.250.228.229

# Затем на сервере в другом терминале:
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npm run dev
```

После этого откройте: **http://localhost:3000** на вашем Mac.

---

## 📋 План разработки блога

### Этап 1: Улучшение списка постов

**Компоненты для установки:**
```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npx shadcn@latest add skeleton separator
```

**Создать компонент PostCard:**
- `components/blog/PostCard.tsx`

**Обновить:**
- `app/blog/page.tsx` - использовать новые компоненты

### Этап 2: Улучшение страницы поста

**Улучшения:**
- Markdown рендеринг с подсветкой синтаксиса
- Breadcrumbs
- SEO meta tags
- Structured Data

### Этап 3: Редактор постов

**Компоненты:**
```bash
npx shadcn@latest add form input textarea dialog toast tabs
```

**Создать:**
- `app/admin/blog/[id]/edit/page.tsx`
- `components/admin/BlogEditor.tsx`

### Этап 4: GEO оптимизация

**Библиотеки:**
```bash
npm install remark-geo rehype-pretty-code
```

**Создать:**
- `lib/markdown/geo.ts` - обработка GEO тегов
- `lib/markdown/schema.ts` - Schema.org разметка

---

Подробный план в файле `BLOG_DEVELOPMENT_PLAN.md`.

---

**Дата:** 2026-01-06

