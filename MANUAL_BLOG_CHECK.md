# Ручная проверка доступности блога

## Выполните эти команды на вашем Mac:

```bash
# 1. Проверка что блог отвечает на localhost
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w 'localhost:3002 - HTTP: %{http_code}\n' http://localhost:3002/api/admin/posts"

# 2. Проверка через Docker bridge IP
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "curl -s -o /dev/null -w '172.17.0.1:3002 - HTTP: %{http_code}\n' http://172.17.0.1:3002/api/admin/posts"

# 3. Проверка из Nginx контейнера
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker exec autoro-site curl -s -o /dev/null -w 'From Nginx - HTTP: %{http_code}\n' http://172.17.0.1:3002/api/admin/posts 2>&1"

# 4. Проверка статуса контейнеров
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker ps | grep -E 'blog|nginx|site'"

# 5. Проверка портов блога
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker port autoro-blog-nextjs"

# 6. Логи Nginx
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker logs autoro-site --tail 30 | grep -i '503\|error\|upstream'"

# 7. Логи блога
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229 "docker logs autoro-blog-nextjs --tail 30"
```

## Или используйте готовый скрипт:

```bash
cd /Users/vlad_x/Desktop/n8n/autoro.tech/website
bash SIMPLE_BLOG_CHECK.sh
```

## Ожидаемые результаты:

- ✅ **200** или **401** от `localhost:3002` - блог работает
- ✅ **200** или **401** от `172.17.0.1:3002` - доступен через bridge
- ✅ **200** или **401** из Nginx контейнера - проблема не в сети
- ❌ **503** или ошибка подключения - проблема в конфигурации или сети

