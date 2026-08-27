# Job Responder - ultra-short prompts (runtime default)

Runtime system instruction (extension `jrPromptExtra` default + backend `build_system_prompt`) is token-efficient.

Side panel: **Сохранить промпт** (dirty vs last saved) / **Сбросить**. Storage key: `jrPromptExtra`.

**Important:** saved ultra-short (`[ROLE]…[RULES]…[OUT…]`) is sent as `promptExtra` and **replaces** the default system prompt on generate (not discarded as duplicate). «Сбросить» restores live default from API / bundled `DEFAULT_PROMPT_EXTRA`. Migration only upgrades empty / legacy / exact previous shipped defaults - never wipes user edits.

## Ultra-short (default)

```
[ROLE] Ассистент откликов. Пишешь только по фактам кандидата. Без воды.

[INPUT] vacancy | profile | cover_template? | custom_instructions? | contacts?

[RULES]
1. Не выдумывай опыт, метрики, контакты, URL, ownership продуктов. Нет факта в profile -> пропусти пункт.
2. Адаптируй cover_template под вакансию; стиль кандидата сохрани.
3. В письме: 4-6 коротких факта … + маркетинговые / automation skills из KB.
4. ## Контакты vs ## Ссылки (только факты; YouTube @ ≠ Telegram).
5. Честность (без senior/CEFR без источника).
6. HH: ASCII ", дефис -, ->.
7. no-ai-slop.
8. Отрасль/домен (1 пункт с фактом, если совпало).
9. Transferable (макс. 1 именованный факт или skip).
10. TOOL PIN: JD∩KB tools must be named.
11. Специалист широкого профиля: честная адаптация смежного KB-опыта под JD (без выдуманных PO/roadmap/метрик).

[OUT cover_letter]
**Должность:** {title}
**Формат:** {format|remote|employment}
---
{Approximate Relevance of a Vacancy}   ← backend подставляет "Релевантность: N/100"
…
**Специалист широкого профиля**
…
**Полное резюме и портфолио во вложении, или по ссылке**
## Ссылки
…
[OUT qa] [{"question":"...","answer":"..."}]
```

Keep in sync: `agent-api/job_responder.py` `ULTRA_SHORT_SYSTEM_PROMPT` ↔ `extensions/job-responder/sidepanel.js` `DEFAULT_PROMPT_EXTRA`.

**Промпт оценки эффективности (dev):** side panel → «Промпт оценки эффективности (dev)» (`jrEffectivenessPrompt`). Default = `DEFAULT_EFFECTIVENESS_EVAL_PROMPT`. Уходит в `/relevance` и `/generate` как `effectivenessPrompt`; ответ: `effectivenessNotes` (эвристика; LLM только при `JOB_RESPONDER_EFFECTIVENESS_LLM=1` + `jrUseLlmRelevanceEval`).

Generate temperature: `JR_GENERATE_TEMPERATURE = 0.15`.

Cover `max_tokens`: **550** (soft-retry 650 if mid-word truncate); QA: 700.

## LLM cascade (soft wall ~24–27s)

On hang / FuturesTimeout / empty: fail-fast slice → rotate openmodel key → next model (`haiku` → `deepseek-v4-flash` → `gemini-3.5-flash`) while budget remains. HTTP timeout aligned with slice (no 45s zombie urlopen → CF 502).

## HH + no-ai-slop post-process

Backend `hh_format_text` (из `finalize_cover_letter_contacts_and_links` **после** rewrite ## Контакты / ## Ссылки):

| Transform | Result |
|---|---|
| `—` / `–` | `-` |
| `→` / `⇒` | `->` |
| `«»` / curly quotes | ASCII `"` |
| leftover `{Approximate Relevance of a Vacancy}` | `Релевантность: N/100` or stripped |

Skill source: [autorotech-tech/no-ai-slop](https://github.com/autorotech-tech/no-ai-slop).
