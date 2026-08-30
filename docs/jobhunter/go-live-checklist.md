# Go-live checklist (тест → активный аккаунт)

- [ ] 7 дней на тестовом аккаунте без `blocked` / captcha storm
- [ ] Ingest стабилен (api.hh.ru app token; Apify fallback проверен)
- [ ] Enrich пишет `route` корректно на выборке ≥30 вакансий
- [ ] Human gate: 10 ручных approve без ложных auto-send
- [ ] `POST /negotiations` успешен ≥5 раз на тесте
- [ ] Direct email drafts проверены визуально (no-ai-slop + HH formatting)
- [ ] daily_cap и pause_on_block работают (искусственный 429-тест)
- [ ] Секреты не попали в Sheets / git / Obsidian
- [ ] Профиль и resume_id активного аккаунта обновлены в `profile`
- [ ] Playbooks `hh-uz` / `hh-kz` / `hh-ru` актуализированы

Только после всех пунктов: переключить credentials на активный аккаунт, поднять `daily_cap` постепенно (5 → 10 → 15).
