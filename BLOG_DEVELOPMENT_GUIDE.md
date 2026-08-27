# Руководство по разработке блога Autoro.tech

## 📋 Содержание

1. [Подключение к серверу](#подключение-к-серверу)
2. [Работа с Docker контейнером](#работа-с-docker-контейнером)
3. [Использование MCP серверов](#использование-mcp-серверов)
4. [Работа с Shadcn UI](#работа-с-shadcn-ui)
5. [Обновление Node.js](#обновление-nodejs)

---

## 🔌 Подключение к серверу

### SSH подключение

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

### Навигация к проекту

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
```

### Доступ к Dev серверу

После запуска dev сервера, он будет доступен:
- **Локально на сервере**: http://localhost:3000
- **По сети**: http://46.250.228.229:3000

---

## 🐳 Работа с Docker контейнером

### Проверка статуса контейнера

```bash
# Все контейнеры блога
docker ps -a | grep blog

# Логи контейнера
docker logs autoro-blog-nextjs --tail 50 -f
```

### Запуск/остановка контейнера

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro

# Запуск
docker-compose up -d

# Остановка
docker-compose down

# Перезапуск
docker-compose restart

# Пересборка и запуск
docker-compose up -d --build
```

### Работа внутри контейнера

```bash
# Войти в контейнер
docker exec -it autoro-blog-nextjs sh

# Выполнить команду в контейнере
docker exec -it autoro-blog-nextjs npm run dev
docker exec -it autoro-blog-nextjs npm run build
```

### Запуск Dev сервера в контейнере

```bash
# Войти в контейнер и запустить dev сервер
docker exec -it autoro-blog-nextjs sh
npm run dev
```

Или напрямую:
```bash
docker exec -it autoro-blog-nextjs npm run dev
```

---

## 🤖 Использование MCP серверов

### Активные MCP серверы

В Cursor IDE подключены следующие MCP серверы:

1. **nextjs-docs** - Документация Next.js
   - Используйте `@nextjs-docs` для получения информации о Next.js API
   - Пример: "Как использовать Server Actions в Next.js 15?"

2. **tailwindcss** - Tailwind CSS помощник
   - Используйте `@tailwindcss` для работы с Tailwind CSS
   - Пример: "Покажи пример использования градиентов в Tailwind"

3. **filesystem** - Доступ к файловой системе
   - Используйте `@filesystem` для работы с файлами проекта
   - Автоматически работает в директории проекта

4. **puppeteer** - Автоматизация браузера
   - Используйте `@puppeteer` для тестирования и скриншотов
   - Полезно для проверки UI компонентов

5. **context7** - Контекстная помощь
   - Используйте `@context7` для получения контекстной информации

### Как использовать MCP в Cursor

1. **Упоминание в запросах**:
   ```
   @nextjs-docs Как создать Server Action в Next.js 15?
   @tailwindcss Покажи пример card компонента с градиентом
   ```

2. **Автоматическое использование**:
   - Cursor автоматически использует подключенные MCP серверы
   - При работе с кодом используются доступные серверы

3. **Проверка статуса**:
   - Settings → Features → MCP
   - Все серверы должны быть активны (зеленый статус)

---

## 🎨 Работа с Shadcn UI

### Установка компонентов

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro

# Добавить новый компонент
npx shadcn@latest add [component-name]

# Примеры популярных компонентов:
npx shadcn@latest add separator
npx shadcn@latest add avatar
npx shadcn@latest add tabs
npx shadcn@latest add dropdown-menu
npx shadcn@latest add dialog
npx shadcn@latest add input
npx shadcn@latest add textarea
```

### Использование компонентов в коде

```tsx
// Импорт компонентов
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"

// Пример использования
export default function BlogPostCard({ post }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{post.title}</CardTitle>
          <Badge variant="secondary">{post.status}</Badge>
        </div>
        <CardDescription>{post.excerpt}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{post.content}</p>
        <Separator className="my-4" />
        <Button variant="outline">Читать далее</Button>
      </CardContent>
    </Card>
  )
}
```

### Доступные компоненты

Установленные компоненты находятся в `components/ui/`:
- `button.tsx` - Кнопки
- `card.tsx` - Карточки
- `badge.tsx` - Бейджи/теги

### Варианты стилей

Компоненты Shadcn UI используют CSS переменные для тем:
- Настроены цвета в `app/globals.css`
- Поддержка темной темы (CSS переменные готовы)
- Кастомизация через Tailwind CSS

### Полезные команды

```bash
# Просмотреть все доступные компоненты
npx shadcn@latest add

# Обновить компонент
npx shadcn@latest add [component-name] --overwrite

# Инициализация (уже выполнено)
npx shadcn@latest init
```

---

## ⬆️ Обновление Node.js

### Текущая версия

```bash
node --version
# Должна быть: v20.x.x или выше
```

### Обновление через nvm (рекомендуется)

```bash
# Загрузить nvm (если не загружен)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Установить последнюю LTS версию
nvm install --lts
nvm use --lts
nvm alias default node

# Проверить версию
node --version
npm --version
```

### Добавить nvm в .bashrc/.zshrc

```bash
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"' >> ~/.bashrc
echo '[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"' >> ~/.bashrc

# Перезагрузить конфигурацию
source ~/.bashrc
```

### Для Docker контейнера

Node.js в Docker контейнере управляется через Dockerfile:
- Обновите `FROM node:XX` в Dockerfile
- Пересоберите контейнер: `docker-compose up -d --build`

---

## 🚀 Типичный workflow разработки

### 1. Подключение к серверу

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
```

### 2. Работа с кодом

**Локально (на вашем Mac):**
- Редактируйте код в Cursor IDE
- Используйте MCP серверы для помощи
- Синхронизируйте изменения на сервер

**Синхронизация:**
```bash
# С локальной машины
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  --exclude 'node_modules' \
  --exclude '.next' \
  /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro/ \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/
```

### 3. Запуск Dev сервера

**В Docker контейнере:**
```bash
docker exec -it autoro-blog-nextjs npm run dev
```

**На сервере напрямую:**
```bash
npm run dev
```

### 4. Тестирование

- Откройте http://46.250.228.229:3000 в браузере
- Проверьте изменения
- Используйте MCP серверы для помощи

### 5. Добавление компонентов Shadcn UI

```bash
npx shadcn@latest add [component-name]
# Синхронизируйте на сервер
```

### 6. Production сборка

```bash
npm run build
npm run start
```

---

## 📝 Полезные команды

### Проверка статуса

```bash
# Статус Docker контейнеров
docker ps | grep blog

# Логи контейнера
docker logs autoro-blog-nextjs -f

# Проверка версий
node --version
npm --version
next --version
```

### Управление зависимостями

```bash
# Установка зависимостей
npm install

# Обновление зависимостей
npm update

# Проверка уязвимостей
npm audit
```

### Сборка и деплой

```bash
# Development сборка
npm run dev

# Production сборка
npm run build

# Запуск production сервера
npm run start

# Линтинг
npm run lint
```

---

## 🔧 Решение проблем

### Контейнер не запускается

```bash
# Проверить логи
docker logs autoro-blog-nextjs --tail 100

# Пересобрать контейнер
docker-compose up -d --build

# Проверить переменные окружения
docker-compose config
```

### Проблемы с зависимостями

```bash
# Очистить и переустановить
rm -rf node_modules package-lock.json
npm install
```

### Проблемы с портами

```bash
# Проверить, занят ли порт 3000
netstat -tlnp | grep 3000
# или
ss -tlnp | grep 3000

# Остановить процесс на порту
# (найти PID и kill)
```

---

## 📚 Дополнительные ресурсы

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [React 19 Documentation](https://react.dev)
- [Shadcn UI Documentation](https://ui.shadcn.com)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

---

**Последнее обновление:** 2026-01-06  
**Версия Next.js:** 15.5.9  
**Версия React:** 19.2.3

