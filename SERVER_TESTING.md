# Тестирование на сервере

## ✅ Выполнено

1. **Синхронизация файлов**
   - package.json (Next.js 15, React 19)
   - tsconfig.json
   - components.json (Shadcn UI)
   - tailwind.config.ts
   - globals.css
   - lib/utils.ts
   - lib/i18n/config.ts
   - lib/supabase/server.ts (обновлен для Next.js 15)
   - components/ui/* (Shadcn UI компоненты)

2. **Установка зависимостей**
   - Все зависимости установлены
   - 229 пакетов установлено
   - 0 уязвимостей

## 🚀 Запуск dev сервера

Для запуска и просмотра логов используйте:

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/projects/autoro.tech/website/blog-autoro

# Запуск в screen (рекомендуется)
screen -S blog-dev
npm run dev
# Нажмите Ctrl+A, затем D для отсоединения от screen

# Подключиться к screen снова
screen -r blog-dev

# Или запустить напрямую
npm run dev
```

## 📋 Проверка статуса

```bash
# Проверить, запущен ли сервер
curl http://localhost:3000
netstat -tlnp | grep 3000
# или
ss -tlnp | grep 3000

# Проверить screen сессию
screen -list

# Посмотреть логи screen
screen -S blog-dev -X hardcopy /tmp/blog-dev.log
tail -30 /tmp/blog-dev.log
```

## 🧪 Тестирование компонентов Shadcn UI

Компоненты установлены и готовы к использованию:
- `components/ui/button.tsx`
- `components/ui/card.tsx`
- `components/ui/badge.tsx`

Использование в коде:
```tsx
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
```

## 📦 Добавление новых компонентов Shadcn UI

```bash
cd /home/vladx/projects/autoro.tech/website/blog-autoro
npx shadcn@latest add [component-name]
```

Популярные компоненты для блога:
- `separator` - разделители
- `avatar` - аватары авторов
- `tabs` - вкладки
- `dropdown-menu` - выпадающие меню
- `dialog` - модальные окна

## ✅ Версии на сервере

- Node.js: v18.20.8 (работает, но рекомендуется обновить до 20+)
- npm: 10.8.2
- Next.js: 15.1.3 ✅
- React: 19.2.3 ✅
- Shadcn UI: установлен ✅

## 🔄 Синхронизация изменений

Для синхронизации локальных изменений на сервер:

```bash
# С локальной машины
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website/blog-autoro

# Синхронизация файлов
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  package.json tsconfig.json components.json tailwind.config.ts \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/

# Синхронизация компонентов
rsync -avz -e "ssh -i ~/.ssh/id_ed25519_autoro" \
  components/ lib/ app/globals.css \
  vladx@46.250.228.229:/home/vladx/projects/autoro.tech/website/blog-autoro/
```

---

**Статус:** ✅ Файлы синхронизированы, зависимости установлены  
**Дата:** 2026-01-06

