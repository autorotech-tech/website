# Job Responder - ultra-short prompts (runtime default)

Runtime system instruction (extension `jrPromptExtra` default + backend `build_system_prompt`) is token-efficient.

Side panel: **Сохранить промпт** (dirty vs last saved) / **Сбросить**. Storage key: `jrPromptExtra`.

## Ultra-short (default)

```
[ROLE] Ассистент откликов. Пишешь только по фактам кандидата. Без воды.

[INPUT] vacancy | profile | cover_template? | custom_instructions? | contacts?

[RULES]
1. Не выдумывай опыт, метрики, контакты, URL, ownership продуктов. Нет факта в profile -> пропусти пункт.
2. Адаптируй cover_template под вакансию; стиль кандидата сохрани.
3. В письме: 3-4 коротких факта из Resume KB / compact profile (продукты, tools, метрики). Акцент на отраслевой/доменный опыт, когда он подтверждён в profile (domains_matched, industry_experience, matched_projects, конкретные продукты/метрики). Запрет пустых обобщений без факта ("механика применима", аналогии без названий). Нет факта -> пропусти пункт.
4. Блок ## Контакты: ТОЛЬКО email/Telegram/телефон (+ portfolio/GitHub/LinkedIn/сайт если даны). Блок ## Ссылки: все релевантные URL с подписями из template/profile/правок. Без опыта, навыков, smoke/test URL (example.com, jr-smoke). Не выдумывай URL.
5. Честность: только tools/уровни/метрики из profile. Запрет без источника: "senior"/"сеньор", "эксперт", "свободно", CEFR (C1/C2). Proficient ≠ C1. Зеркаль RAG, не усиливай. Лексика как в profile.
6. HH: ASCII ", дефис - (не —), -> (не →); без «ёлочек».
7. no-ai-slop: без воды, клише и AI-обобщений (delve/leverage/utilize/cutting-edge; "выразить заинтересованность"; "в современном мире"; "широкий опыт"; "механика переноса" без факта). Только факты и названия как в profile. Русский, если не просили иначе.
8. Отрасль/домен: если в вакансии есть отрасль и в profile есть domains_matched / industry_experience / matched_projects - обязательно 1 пункт про отраслевой опыт с реальными фактами. Не приукрашивай.
9. Transferable: если JD skill нет в profile - пропусти ИЛИ макс. 1 пункт с именованным фактом из profile ("Смежный: [продукт/метрика] -> [JD]"). Без абстрактных "переносимо через механику", без чужих KPI, без senior/CEFR. Нет факта -> skip.

[OUT cover_letter]
# ОТКЛИК НА ВАКАНСИЮ
...
```

Generate temperature: `JR_GENERATE_TEMPERATURE = 0.15` (openmodel / gemini / glm + File Search).

Cover `max_tokens`: **550** (soft-retry 650 if mid-word truncate detected); QA: 700. Post-process: `strip_incomplete_trailing_text` before contacts rewrite.

## HH + no-ai-slop post-process

Backend `hh_format_text` (вызывается из `finalize_cover_letter_contacts_and_links` **после** rewrite ## Контакты / ## Ссылки, и в QA answers):

| Transform | Result |
|---|---|
| `—` / `–` | `-` |
| `→` / `⇒` | `->` |
| `«»` / curly quotes | ASCII `"` |
| RU/EN cover fluff phrases | stripped |
| EN banned words (word-boundary): delve, leverage, utilize, cutting-edge, … | stripped |
| `strip_incomplete_trailing_text` (до contacts rewrite) | mid-word / incomplete bullet -> last sentence or drop bullet |
| `strip_embellished_language_claims` (до contacts rewrite) | CEFR / senior / эксперт без опоры в profile -> soften/drop |

Skill source: [autorotech-tech/no-ai-slop](https://github.com/autorotech-tech/no-ai-slop) (локально `.cursor/skills/no-ai-slop`). Контакты/ссылки не ломаем - rewrite ## Контакты / ## Ссылки идёт до финального scrub.

## Cover template (structured)

```
[COVER_TEMPLATE]
Приветствие: ...
О себе (1-2 предложения): ...
Ключевые факты (bullet): ...
CTA: ...

[CONTACTS]
Telegram: @autoro_tech
Email: autoro.tech@gmail.com
Portfolio: ...
LinkedIn: ...
GitHub: ...
```

## Contacts + links post-process (backend)

`collect_generate_contacts` + `collect_generate_links` + `finalize_cover_letter_contacts_and_links`:

- Priority contacts: cover_template `[CONTACTS]` > `profileOverrides` > profile
- Links sources: `## Ссылки` / labeled `label: url` from template, Правки профиля, инструкции генерации, `rag_edits`, profile.links
- Contacts = Telegram / email / phone (+ classic portfolio/GitHub/LinkedIn/site if labeled as such)
- Links = резюме, youtube, demos, forum, … (any non-smoke http URL with label)
- Filter smoke/test URLs only: `example.com`, `jr-smoke`, `localhost`, …
- Never invent contacts or URLs

## Fuller reference (not runtime default)

Use when debugging or expanding docs only. Prefer ultra-short in production.

- First person, facts only from RESUME CONTEXT / File Search.
- HH formatting: `-`, `->`, ASCII `"`, plain text.
- Cover: header (должность/компания/формат) -> letter with 3-4 relevance points -> CTA -> contacts.
- QA: JSON array `[{"question","answer"}]`; copy question text literally.
- Side panel `jrPromptExtra` = ultra-short system instructions; «Правки профиля» persist to knowledge base.
