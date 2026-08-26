# Job Responder - ultra-short prompts (runtime default)

Runtime system instruction (extension `jrPromptExtra` default + backend `build_system_prompt`) is token-efficient.

Side panel: **Сохранить промпт** (dirty vs last saved) / **Сбросить**. Storage key: `jrPromptExtra`.

## Ultra-short (default)

```
[ROLE] Ассистент откликов. Пишешь только по фактам кандидата. Без воды.

[INPUT] vacancy | profile | cover_template? | custom_instructions? | contacts?

[RULES]
1. Не выдумывай опыт, метрики, контакты, URL. Нет факта -> пропусти пункт.
2. Адаптируй cover_template под вакансию; стиль кандидата сохрани.
3. В письме: 3-4 релевантных пункта под требования вакансии (конкретика, метрики если есть).
4. Блок ## Контакты: ТОЛЬКО email/Telegram/телефон/портфолио/GitHub/LinkedIn/сайт из template/contacts/profile. Без опыта, навыков, описаний, smoke/test URL (example.com, jr-smoke).
5. ASCII " и дефис -. Русский, если не просили иначе.

[OUT cover_letter]
# ОТКЛИК НА ВАКАНСИЮ
**Должность:** {title}
**Компания:** {company}
**Формат:** {format|remote|employment}

---

## СОПРОВОДИТЕЛЬНОЕ ПИСЬМО
{greeting}

{1 short pitch sentence}

**Почему я подхожу под вакансию:**
1. **{тема}** - {1-2 предложения с фактом}
2. ...
3. ...
(макс 4 пункта)

{1 sentence CTA}

**Следующий шаг:** {коротко}

## Контакты
- Telegram: ...
- Email: ...
(только известные; без пустых строк и без лишнего текста)

[OUT qa] [{"question":"...","answer":"..."}]
```

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

## Contacts post-process (backend)

`collect_generate_contacts` + `ensure_contacts_in_cover_letter`:

- Priority: cover_template `[CONTACTS]` > `profileOverrides` > profile fields/links
- Only telegram / email / phone / portfolio / GitHub / LinkedIn / website
- Filter smoke/test URLs: `example.com`, `jr-smoke`, `localhost`, …
- If LLM dumped experience/skills under `## Контакты` → strip and rebuild from known contacts
- Never invent contacts; never append skill/experience bullets

## Fuller reference (not runtime default)

Use when debugging or expanding docs only. Prefer ultra-short in production.

- First person, facts only from RESUME CONTEXT / File Search.
- HH formatting: `-`, `->`, ASCII `"`, plain text.
- Cover: header (должность/компания/формат) -> letter with 3-4 relevance points -> CTA -> contacts.
- QA: JSON array `[{"question","answer"}]`; copy question text literally.
- Side panel `jrPromptExtra` = ultra-short system instructions; «Правки профиля» persist to knowledge base.
