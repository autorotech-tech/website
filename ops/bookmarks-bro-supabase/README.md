# Bookmarks Bro: изолированный Supabase (self-hosted)

Цель: поднять полностью отдельный Supabase-стек для `bookmarks-bro`, чтобы:

- данные закладок не пересекались с текущей базой знаний;
- пользователи `bookmarks-bro` были изолированы друг от друга через RLS;
- `agent-api` мог ходить в отдельный Auth/Postgres только для закладок.

## Что уже поддерживает `agent-api`

В `agent-api/main.py` уже есть отдельные переменные для изоляции Bookmarks:

- `BOOKMARKS_SUPABASE_URL`
- `BOOKMARKS_SUPABASE_ANON_KEY`
- `BOOKMARKS_PGHOST`
- `BOOKMARKS_PGPORT`
- `BOOKMARKS_PGDATABASE`
- `BOOKMARKS_PGUSER`
- `BOOKMARKS_PGPASSWORD`

Если они заданы, auth и БД для bookmarks идут в отдельный стек.

## Шаги (автономно на VPS)

1. Скопировать действующий self-hosted Supabase в отдельный каталог.
2. Создать отдельную сеть `bookmarks_bro_supabase_net`.
3. Задать уникальные порты и `COMPOSE_PROJECT_NAME=supabase-bb`.
4. Запустить отдельный стек.
5. Применить SQL `sql/001_bookmarks_bro_isolation.sql`.
6. Подключить `agent-api` к новым переменным (`.env.agent-api.bookmarks.example`).
7. Настроить nginx route `/bb-supabase/` на новый Kong.

## Быстрый старт

На VPS:

```bash
cd /home/vladx
git clone <этот_репозиторий_или_скопируйте_папку_ops> website-ops
cd website-ops/ops/bookmarks-bro-supabase
bash ./bootstrap.sh
```

### Если `bootstrap.sh` или compose падают (legacy `docker-compose`, volumes/networks)

Скопируйте на сервер актуальный **`recover_bb_stack.sh`** и выполните в каталоге с вашим `docker-compose.yml`
(например `/home/vladx/supabase-bookmarks-bro`):

```bash
export COMPOSE_DIR=/home/vladx/supabase-bookmarks-bro
# Опционально: лог NDJSON для отладки (можно прислать строки из файла)
export BB_DEBUG_LOG=/tmp/bb-recover.ndjson
bash /path/to/recover_bb_stack.sh
```

Скрипт сам: суффиксирует `container_name` как `*-bb`, смещает типичные порты, добавляет недостающие **named volumes** и **external networks**, создаёт сети в Docker и выбирает `docker compose` или `docker-compose`.

### Применить SQL изоляции

Через **роль `postgres`** внутри контейнера БД (часто `supabase_admin` как `-U` даёт `FATAL: role "supabase_admin" does not exist`):

```bash
cat ./sql/001_bookmarks_bro_isolation.sql | docker exec -i supabase-db-bb psql -U postgres -d postgres
```

Либо с хоста, если поднят pooler и известен пароль из `.env`:

```bash
# пример; пользователь и пароль — из вашего Supabase .env
psql "postgresql://postgres:<PASSWORD>@127.0.0.1:5435/postgres" \
  -f ./sql/001_bookmarks_bro_isolation.sql
```

### Подключить `agent-api` к изолированному Supabase

1. Скопируйте переменные:

```bash
cp ./ops/bookmarks-bro-supabase/.env.agent-api.bookmarks.example ./.env.bookmarks
```

2. Добавьте значения из `.env.bookmarks` в рабочий `.env` рядом с `website/docker-compose.yml`.

3. Перезапустите только `agent-api` с override:

```bash
docker compose \
  -f docker-compose.yml \
  -f ops/bookmarks-bro-supabase/docker-compose.agent-api.bookmarks.override.yml \
  up -d --build agent-api
```

### Проксирование нового Supabase в nginx

Добавьте содержимое `nginx.bb-supabase.location.conf` в `server {}` и примените:

```bash
nginx -t && sudo systemctl reload nginx
```

После этого URL для Bookmarks Auth:

- `https://swoop.autoro.tech/bb-supabase`

и в расширении (`Settings`) выставить:

- `API Base`: `https://swoop.autoro.tech`
- `Supabase Auth Path`: `/bb-supabase`

## Файлы в этой папке

- `bootstrap.sh` — автоматическое разворачивание отдельного Supabase-стека.
- `recover_bb_stack.sh` — «тяжёлое» восстановление: отдельный `docker-compose.bb.yml`, автодобавление volumes/networks, совместимость с legacy `docker-compose`.
- `sql/001_bookmarks_bro_isolation.sql` — отдельная схема + таблицы + RLS owner-only.
- `.env.agent-api.bookmarks.example` — env для `agent-api`.
- `docker-compose.agent-api.bookmarks.override.yml` — override подключения `agent-api`.
- `nginx.bb-supabase.location.conf` — location-блок для прокси нового Supabase.

