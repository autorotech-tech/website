# Финальные шаги после копирования файлов

## ✅ Файлы скопированы:
- ✅ `route.ts` - скопирован
- ✅ `api-client.ts` - скопирован  
- ✅ `cors.ts` - скопирован

## 🔧 Теперь нужно перезапустить контейнер:

### Шаг 1: Подключиться к серверу
```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229
```

### Шаг 2: Перезапустить контейнер (используя container_name)
```bash
docker restart autoro-blog-nextjs
```

### Шаг 3: Проверить логи
```bash
docker logs autoro-blog-nextjs --tail 50
```

Если видите ошибки компиляции TypeScript, нужно пересобрать:
```bash
cd /home/vladx/autoro-blog
docker-compose down
docker-compose up -d --build
```

### Шаг 4: Проверить работу API
```bash
curl -I "https://cdn.autoro.tech/api/blog/admin/posts?page=1&limit=20"
# Должен вернуть 401 (Unauthorized) - это нормально
```

## 🎯 Проверка в браузере:

1. Откройте: `https://swoop.autoro.tech/admin/blog`
2. Проверьте что посты загружаются (должны быть все, включая draft)
3. Проверьте фильтрацию: "All", "Draft", "Published"

