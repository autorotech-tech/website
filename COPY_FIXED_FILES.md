# Копирование исправленных файлов блога

## ✅ Исправления:

1. **Преобразование `locale` → `language`** в API ответах (для совместимости с фронтендом)
2. **Создан файл `[id]/route.ts`** для GET, PUT, DELETE отдельных постов
3. **OPTIONS возвращает 204** вместо 200

## 📋 Команды для копирования:

```bash
# На ЛОКАЛЬНОЙ машине (Mac)
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

# 1. Копировать исправленный route.ts
scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

# 2. Создать директорию [id] и скопировать файл
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 \
  "mkdir -p /home/vladx/autoro-blog/app/api/admin/posts/\[id\]"

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/\[id\]/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/\[id\]/

# 3. Перезапустить блог
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 \
  "cd /home/vladx/autoro-blog && docker restart autoro-blog-nextjs"

# 4. Проверить логи
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 \
  "docker logs autoro-blog-nextjs --tail 30"
```

## 🔍 Проверка работы:

После перезапуска проверьте в браузере:
1. Откройте: `https://swoop.autoro.tech/admin/blog`
2. Посты должны отображаться (включая draft)
3. Проверьте фильтрацию: All, Draft, Published

