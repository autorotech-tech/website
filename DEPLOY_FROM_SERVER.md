# Деплой с сервера (если файлы уже там)

Если вы уже подключены к серверу, можно создать файлы напрямую:

## 📋 Вариант 1: Создать файлы на сервере напрямую

### 1. Подключиться к серверу:
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

### 2. Создать директории:
```bash
mkdir -p /home/vladx/autoro-blog/app/api/admin/posts
mkdir -p /home/vladx/autoro-blog/lib/supabase
mkdir -p /home/vladx/autoro-blog/lib
```

### 3. Создать файлы через nano/vim или через heredoc

Я создам скрипт который создаст файлы на сервере.

## 📋 Вариант 2: Скопировать файлы с локальной машины

**ВАЖНО:** Команды `scp` нужно выполнять с **ЛОКАЛЬНОЙ машины (Mac)**, а не с сервера!

```bash
# На ЛОКАЛЬНОЙ машине (Mac), НЕ на сервере:
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/app/api/admin/posts/route.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/supabase/api-client.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/supabase/

scp -i ~/.ssh/id_ed25519_autoro \
  blog-autoro/lib/cors.ts \
  vladx@46.250.228.229:/home/vladx/autoro-blog/lib/
```

