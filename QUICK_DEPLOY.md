# Быстрый деплой исправлений блога

## ⚡ Выполните команды по порядку:

### 1. Скопировать файлы (выполнить на ЛОКАЛЬНОЙ машине):

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website

scp -i ~/.ssh/id_ed25519_autoro blog-autoro/app/api/admin/posts/route.ts vladx@46.250.228.229:/home/vladx/autoro-blog/app/api/admin/posts/

scp -i ~/.ssh/id_ed25519_autoro blog-autoro/lib/supabase/api-client.ts vladx@46.250.228.229:/home/vladx/autoro-blog/lib/supabase/

scp -i ~/.ssh/id_ed25519_autoro blog-autoro/lib/cors.ts vladx@46.250.228.229:/home/vladx/autoro-blog/lib/
```

### 2. Перезапустить контейнер (на сервере):

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

cd /home/vladx/autoro-blog
docker-compose restart autoro-blog-nextjs
```

### 3. Проверить логи:

```bash
docker logs autoro-blog-nextjs --tail 50
```

### 4. Проверить работу:

Откройте: `https://swoop.autoro.tech/admin/blog`

---

## 📝 Альтернатива: Если scp не работает

Можно создать файлы напрямую на сервере через SSH. Файлы готовы в:
- `blog-autoro/app/api/admin/posts/route.ts`
- `blog-autoro/lib/supabase/api-client.ts`
- `blog-autoro/lib/cors.ts`

Скопируйте содержимое этих файлов на сервер вручную через `nano` или `vim`.

