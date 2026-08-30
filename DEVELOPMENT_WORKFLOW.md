# 🔄 Workflow разработки блога

## 📋 Полный процесс разработки

### 1. Подготовка

**На локальной машине (Mac):**
```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro
```

**Подключение к серверу:**
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
cd /home/vladx/projects/autoro.tech/website/blog-autoro
```

### 2. Разработка с использованием MCP

**В Cursor IDE:**

1. Откройте проект локально
2. Используйте MCP серверы для помощи:
   ```
   @nextjs-docs Как создать новый API route?
   @tailwindcss Покажи пример responsive grid
   @filesystem Покажи структуру app/blog
   ```

3. Редактируйте код с помощью MCP подсказок

### 3. Синхронизация на сервер

**С локальной машины:**
```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro

# Синхронизация изменений (исключая node_modules и .next)
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'package-lock.json' \
  ./ \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/
```

### 4. Установка зависимостей (если нужно)

**На сервере:**
```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npm install --legacy-peer-deps
```

### 5. Запуск Dev сервера

**Вариант A: В Docker контейнере**
```bash
# Перезапустить контейнер (если нужно)
docker-compose restart

# Запустить dev сервер в контейнере
docker exec -it autoro-blog-nextjs npm run dev
```

**Вариант B: На сервере напрямую**
```bash
# Убедитесь, что используете правильную версию Node.js
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
node --version  # Должна быть v24.x.x

# Запустить dev сервер
npm run dev
```

### 6. Тестирование

Откройте в браузере:
- **http://46.250.228.229:3000/blog**
- **http://46.250.228.229:3000/blog/[slug]**

### 7. Добавление компонентов Shadcn UI

**На сервере:**
```bash
npx shadcn@latest add [component-name]
```

**Синхронизация обратно на локальную машину:**
```bash
# С сервера на локальную машину
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/components/ \
  /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro/components/
```

### 8. Production сборка и деплой

**На сервере:**
```bash
# Production сборка
npm run build

# Проверка сборки
npm run start

# Или через Docker
docker-compose up -d --build
```

## 🔄 Типичный цикл разработки

```
1. Разработка (локально) 
   ↓
2. Использование MCP для помощи
   ↓
3. Синхронизация на сервер
   ↓
4. Запуск dev сервера
   ↓
5. Тестирование
   ↓
6. Исправления
   ↓
7. Повтор с шага 1
```

## 📝 Чеклист для новой функции

- [ ] Создан план с использованием MCP серверов
- [ ] Код написан локально
- [ ] Использованы компоненты Shadcn UI (если нужно)
- [ ] Код синхронизирован на сервер
- [ ] Dev сервер запущен
- [ ] Функция протестирована
- [ ] Production сборка успешна
- [ ] Изменения закоммичены

## 🚀 Быстрые команды

### Синхронизация всех файлов
```bash
# Локально → Сервер
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  --exclude 'node_modules' --exclude '.next' \
  ./ vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/
```

### Запуск dev сервера
```bash
# SSH → Сервер → Dev
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "cd /home/vladx/projects/autoro.tech/website/blog-autoro && export NVM_DIR=\"\$HOME/.nvm\" && [ -s \"\$NVM_DIR/nvm.sh\" ] && \. \"\$NVM_DIR/nvm.sh\" && npm run dev"
```

### Проверка статуса
```bash
# Проверка Docker
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep blog"

# Проверка порта
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -I http://localhost:3000"
```

---

## Идеи и задачи разработки: Telegram → план в Cursor

Цель: с телефона зафиксировать идею/задачу (текст или голос) и далее в Cursor быстро перейти к реализации с контекстом, не теряя формулировки.

### Сравнение вариантов

| Критерий | 1) Obsidian + MCP (рекомендуемый для «второго мозга») | 2) n8n + файлы / API | 3) GitHub / GitLab Issues |
|----------|--------------------------------------------------------|------------------------|----------------------------|
| Где живёт контекст | Локальный vault, связь с заметками и ссылками | Пайплайн, при желании LLM-структурирование | Репозиторий, трекинг, PR |
| Интеграция с Cursor | MCP к vault: ассистент читает заметки в чате | `@TODO.md` в репо или кастомный endpoint | `@` issue, ветки, automation |
| Сложность внедрения | Средняя (MCP + соглашения по Inbox) | Средняя (уже есть n8n + Telegram) | Ниже, если репо всегда под рукой |
| Сильные стороны | Навигация, теги, долгая память, не только «таски» | Гибкость, STT, маршрутизация, несколько выходов | Код-ревью, обсуждения, релизы |
| Риски | Дисциплина Inbox, дубли | Секреты/среда (см. n8n), обслуживание воркфлоу | Шум в issues, не вся идея = issue |

### План реализации (поэтапно)

1. **MVP n8n (уже в движении):** личный Telegram-бот → вебхук n8n → память/сводки; довести ноды под task runner (без `fetch` в Code — `this.helpers.httpRequest`, см. `vectorize-with-key-rotation.code.js`).
2. **Obsidian-ветка:** настроить запись в Inbox (файл или папка) из n8n (webhook/плагин/файловая шаря) + MCP в Cursor; договориться о шаблоне заметки (дата, теги, ссылка на проект).
3. **Опционально Issues:** привязка к репозиторию (создание issue с лейблом `from-telegram` + ссылка на Obsidian/n8n execution).

**Последнее обновление:** 2026-04-28

