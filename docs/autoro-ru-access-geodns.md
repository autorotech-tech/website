# autoro.tech — доступ из РФ: анализ и план фиксов

> **Дата анализа:** 2026-07-13  
> **Референс (тот же VPS):** [pquoc.com/docs/ru-access-and-indexing.md](../../pquoc.com/docs/ru-access-and-indexing.md), [geodns-implementation-checklist.md](../../pquoc.com/docs/geodns-implementation-checklist.md)  
> **Preflight:** `bash scripts/geodns-preflight-autoro.sh`

---

## 1. Вердикт

Сайт **недоступен из РФ не потому что origin «лежит»**, а потому что весь публичный трафик идёт через **Cloudflare**, а с июня 2025 российские ТСПУ **режут HTTPS к Cloudflare примерно после первых 16 КБ**. Главная `autoro.tech/` весит **~675 КБ** → страница физически не догружается. Origin `46.250.228.229` из РФ доступен напрямую.

**GeoDNS split ещё не включён:** Yandex DNS (`77.88.8.8`) отдаёт те же Cloudflare A-записи, что и Google.

---

## 2. Диагностика (факт на 2026-07-13)

| Проверка | Результат | Смысл |
|---|---|---|
| NS `@8.8.8.8` | `beau.ns.cloudflare.com`, `carlane.ns.cloudflare.com` | DNS только Cloudflare |
| A `@8.8.8.8` | `104.21.48.61`, `172.67.179.212` | Cloudflare anycast |
| A `@77.88.8.8` | **те же IP** | РФ-ветка не отделена |
| `server` / `cf-ray` | `cloudflare`, `…-LAX` | Edge не в РФ |
| Origin TLS `--resolve …:46.250.228.229` | OK | Прямой путь жив |
| Размер `/` | **675 364 B** | ≫ 16 КБ → RF throttle fail |
| `/ru/` | **670 668 B** | то же |
| `/resume/` | **27 519 B** | тоже > 16 КБ |
| `/services-catalog.json` | 12 209 B | < 16 КБ (но без index бесполезен) |
| `/assets/js/chat.js` | 11 239 B | < 16 КБ |
| `swoop.autoro.tech` | CF proxied | тоже под троттлингом |
| `chat.autoro.tech` | CF proxied | то же |
| `tech.autoro.tech` | **A → origin**, `server: nginx` | уже DNS-only / прямой |

### Почему check-host / «HTTP 200 из РФ» врут

TCP handshake и первые байты ответа проходят → автопроверки видят 200. Браузеру нужны сотни КБ HTML/CSS/JS → соединение рвётся после ~16 КБ. **Заголовочные проверки ≠ доступность.**

---

## 3. Корневая причина (не баг nginx)

```
Клиент в РФ → Cloudflare edge → throttle ~16KB → index 675KB не грузится
Клиент в РФ → Origin 46.250.228.229 → OK (доказано tech.autoro.tech + preflight)
```

Cloudflare это со своей стороны не чинит. Нужен **обходной путь для РФ** (Gcore / прямой origin / другой CDN в РФ).

---

## 4. Цели фикса

1. Пользователи в РФ открывают `https://autoro.tech/` и `/resume/` без VPN.  
2. YandexBot дочитывает страницы → индексация в Яндексе.  
3. Остальной мир остаётся на Cloudflare (защита, cache, WAF).  
4. Не сломать почту (MX/SPF/DKIM), `swoop`/`chat`/`tech` и API.

---

## 5. Рекомендуемый план (Plan A — GeoDNS)

Тот же подход, что для pquoc.com: **РФ + Yandex → Gcore CDN → origin; Default → Cloudflare**.

### Фаза 0 — Preflight (готово)

```bash
bash scripts/geodns-preflight-autoro.sh
```

Сейчас: NS Cloudflare, origin OK, index ≫ 16 КБ. Нужен `GCORE_CDN_CNAME` от пользователя.

### Фаза 1 — Gcore CDN resource (нужен вы)

| Поле | Значение |
|---|---|
| Custom domain | `autoro.tech` (+ опционально `www`) |
| Origin | `46.250.228.229` |
| Origin protocol | HTTPS |
| Host header | `autoro.tech` |
| SSL | Let's Encrypt / Force HTTPS |
| Bypass cache | `/api/*`, `/api/chat-*` |
| Cache HTML | короткий TTL или bypass |

Записать:

```
GCORE_CDN_CNAME=________.gcdn.co
GCORE_CDN_IP=$(dig +short $GCORE_CDN_CNAME | head -1)
```

Проверка до смены NS:

```bash
GCORE_CNAME=xxxx.gcdn.co bash scripts/geodns-preflight-autoro.sh --gcore
# ожидание: size ≥ 16KB, нет cf-ray
```

### Фаза 2 — Gcore DNS zone

1. Export BIND из Cloudflare (все A/CNAME/MX/TXT).  
2. Импорт в Gcore DNS zone `autoro.tech`.  
3. Сохранить Gcore NS (`ns1.gcorelabs.net` / факт из UI).  
4. Почту (MX/SPF/DKIM/DMARC) перенести **1:1**.

### Фаза 3 — Geo routing на apex (+ www)

| Geo | Запись | Значение |
|---|---|---|
| **Russia (+ YandexBot geo, если есть)** | A `@` | `GCORE_CDN_IP` (или Point to CDN) |
| **Default** | A `@` | текущие CF `104.21.48.61`, `172.67.179.212` |
| Russia `www` | CNAME/A | Gcore CDN |
| Default `www` | A | Cloudflare |

TTL на миграции: **300**.

### Фаза 4 — Поддомены (критично для Autoro)

| Host | Рекомендация для РФ |
|---|---|
| `autoro.tech`, `www` | GeoDNS → Gcore |
| `swoop.autoro.tech` | отдельный CDN resource **или** Russia → origin IP / Gcore; Default → CF |
| `chat.autoro.tech` | то же (иначе чат/виджет из РФ мёртв) |
| `tech.autoro.tech` | уже на origin — **оставить** |
| `mail` / MX | без proxied CDN |

### Фаза 5 — NS cutover у регистратора

CF NS → Gcore NS. Зону в Cloudflare **не удалять** (откат).

```bash
bash scripts/geodns-preflight-autoro.sh --post-cutover
# PASS: A @77.88.8.8 ≠ Cloudflare; index ≥ 16KB на Gcore path
```

### Фаза 6 — Origin / nginx

- Host header `autoro.tech` с Gcore pull.  
- Валидный TLS на origin (Full strict).  
- Не редиректить Gcore pull в петлю (см. `GCORE_REDIRECT_FIX*.md` в репо).  
- При необходимости: `X-Forwarded-For` / real IP от Gcore.

### Фаза 7 — Верификация из РФ

1. Браузер без VPN: `/`, `/ru/`, `/resume/`, chat widget.  
2. check-host **полный body**, не только headers.  
3. Яндекс.Вебмастер: переобход главной.  
4. Purge Gcore cache после деплоев HTML.

---

## 6. Альтернативы (если GeoDNS откладывается)

| Вариант | Плюсы | Минусы |
|---|---|---|
| **B. Grey-cloud apex → origin** | Быстро | Нет CF WAF для мира; нужен другой антибот |
| **C. Только Gcore для всех** | Проще DNS | Теряем CF-экосистему |
| **D. Зеркало `autoro.ru` / IP** | Обход | SEO split, два бренда |

**Рекомендация:** Plan A (GeoDNS), как у pquoc.

---

## 7. Риски и откат

| Риск | Митигация |
|---|---|
| Почта после NS | Сверить MX/TXT до cutover |
| SSL на Gcore до DNS | LE после Russia A; или DNS-01 |
| API через CDN | Bypass `/api/*` |
| Откат | Вернуть NS на Cloudflare (зона жива) |

---

## 8. Статус Gcore (заполнено 2026-07-13)

Регистратор: **Namecheap**. CDN resource уже есть:

```
GCORE_CDN_RESOURCE_ID=923970
GCORE_CDN_CUSTOM=cdn.autoro.tech
GCORE_CDN_CNAME=cl-glc03b3ef4.gcdn.co
GCORE_CDN_IP=81.28.12.12
ORIGIN_GROUP=autoro-origin-auth
ACCELERATION=Only static assets   # ← НЕ подходит для HTML-главной
SSL=Active
```

Проверка сейчас: `https://cdn.autoro.tech/` → **HTTP 503** (origin pull / Host / TLS).

### Следующие шаги в Portal (до NS cutover)

1. **Acceleration type** → режим полного сайта (не «Only static assets»).
2. Починить **503**: Origin `46.250.228.229`, Host header `autoro.tech` или `cdn.autoro.tech`, HTTPS к origin.
3. Добавить custom domain **`autoro.tech`** (apex) к ресурсу *или* новый CDN resource для apex.
4. Bypass cache: `/api/*`, `/api/chat-*`.
5. Проверка:

```bash
GCORE_CNAME=cl-glc03b3ef4.gcdn.co bash scripts/geodns-preflight-autoro.sh --gcore
curl -sI https://cdn.autoro.tech/ | head -12
curl -s https://cdn.autoro.tech/ -o /dev/null -w "size=%{size_download}\n"
# PASS: 200, size ≥ 16384, нет cf-ray
```

Ещё нужны: **Gcore DNS NS** (для cutover на Namecheap).

---

## 9. Чеклист исполнения (коротко)

- [ ] Создать CDN resource `autoro.tech` → origin `46.250.228.229`
- [ ] Получить `GCORE_CDN_CNAME` / IP; прогнать `--gcore`
- [ ] CDN для `swoop` / `chat` (или Russia → origin)
- [ ] DNS zone + импорт записей + Geo A для RU vs Default
- [ ] NS cutover у регистратора
- [ ] `--post-cutover` + ручной тест из РФ
- [ ] Яндекс.Вебмастер переобход

Preflight:

```bash
bash scripts/geodns-preflight-autoro.sh
GCORE_CNAME=xxxx.gcdn.co bash scripts/geodns-preflight-autoro.sh --gcore
bash scripts/geodns-preflight-autoro.sh --post-cutover
```
