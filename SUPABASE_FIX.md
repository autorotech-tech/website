# 🔧 Исправление проблемы с Supabase Studio

## Проблема
Studio не загружает данные, ошибка: "Failed to retrieve tables"

## Причина
База данных Supabase (`supabase-db`) была в статусе `Restarting`, что означало проблемы с подключением.

## Решение

### 1. Перезапустить контейнеры Supabase

```bash
ssh -i ~/.ssh/id_ed25519_autoro vladx@46.250.228.229

# Перезапустить базу данных
docker restart supabase-db

# Подождать пока база запустится (5-10 секунд)
sleep 10

# Перезапустить мета сервис и Studio
docker restart supabase-meta supabase-studio-pquoc
```

### 2. Проверить статус контейнеров

```bash
docker ps | grep supabase
```

Все контейнеры должны быть в статусе `Up` (не `Restarting`).

### 3. Проверить логи при необходимости

```bash
# Логи базы данных
docker logs supabase-db --tail 50

# Логи мета сервиса (который предоставляет схемы в Studio)
docker logs supabase-meta --tail 50

# Логи Studio
docker logs supabase-studio-pquoc --tail 50
```

### 4. Если проблема сохраняется

Полная перезагрузка Supabase:

```bash
# Найти директорию с docker-compose.yml
cd /home/vladx/supabase  # или где находится ваша установка

# Перезапустить все сервисы
docker-compose restart

# Или если используете отдельные контейнеры
docker restart supabase-db supabase-kong supabase-auth supabase-meta supabase-rest supabase-studio supabase-studio-pquoc
```

## Проверка работы

1. Подключитесь через SSH туннель:
   ```bash
   ssh -i ~/.ssh/id_ed25519_autoro -L 3100:127.0.0.1:3100 vladx@46.250.228.229
   ```

2. Откройте http://127.0.0.1:3100/project/default/editor

3. Должны загрузиться таблицы без ошибок

## Возможные причины постоянных перезапусков

1. **Нехватка памяти** - проверьте `docker stats`
2. **Проблемы с диском** - проверьте `df -h`
3. **Конфликт портов** - проверьте `docker ps` на дубликаты портов
4. **Проблемы с сетью Docker** - проверьте `docker network inspect`

## Восстановление если база не стартует

Если база данных не запускается, возможно нужно:

1. Проверить логи на конкретные ошибки
2. Проверить место на диске: `df -h`
3. Возможно, нужно очистить старые контейнеры: `docker system prune` (осторожно!)
4. Проверить конфигурацию в docker-compose.yml

