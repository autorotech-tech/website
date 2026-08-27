# 🚀 Быстрый старт разработки блога

## 1️⃣ Подключение к серверу

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
```

## 2️⃣ Запуск Dev сервера

### Вариант A: В Docker контейнере (рекомендуется)

```bash
# Проверить статус
docker ps | grep blog

# Запустить dev сервер в контейнере
docker exec -it autoro-blog-nextjs npm run dev

# Или перезапустить контейнер
docker-compose restart
docker exec -it autoro-blog-nextjs npm run dev
```

### Вариант B: На сервере напрямую

```bash
npm run dev
```

## 3️⃣ Доступ к Dev серверу

Откройте в браузере:
- **http://46.250.228.229:3000**

Или локально на сервере:
- **http://localhost:3000**

## 4️⃣ Использование MCP в Cursor

В Cursor IDE просто упоминайте MCP серверы:

```
@nextjs-docs Как использовать Server Components?
@tailwindcss Покажи пример card с градиентом
@filesystem Покажи структуру components/ui
```

## 5️⃣ Добавление компонентов Shadcn UI

```bash
npx shadcn@latest add separator
npx shadcn@latest add avatar
npx shadcn@latest add tabs
```

## 📋 Чеклист

- [ ] Подключен к серверу через SSH
- [ ] Dev сервер запущен
- [ ] Доступен по http://46.250.228.229:3000
- [ ] MCP серверы активны в Cursor
- [ ] Готов к разработке!

