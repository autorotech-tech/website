# Cursor Rules в этом проекте

**Сводная справка** (skills, rules, MCP, команды): [`.cursor/CURSOR-HANDBOOK.md`](../CURSOR-HANDBOOK.md) и автогенерируемый [`.cursor/CURSOR-INVENTORY.generated.md`](../CURSOR-INVENTORY.generated.md) (`npm run cursor:inventory`).

Правила в `.cursor/rules/` автоматически подмешиваются в контекст Cursor (системный промпт). Подробнее: [Cursor Docs — Rules](https://docs.cursor.com/context/rules).

## Текущие правила

| Файл | Назначение |
|------|------------|
| `check-task-solutions.mdc` | Перед решением задач на парсинг, API, скрапинг, SEO, соцсети, лиды и т.п. — проверять базу решений (`KNOWLEDGE_SCRAPING_APIS_REFERENCE.md` и др.) и предлагать готовые инструменты из справочника. |
| `hh-vacancy-responses.mdc` | Оформление откликов HH: `-` вместо `—`, `->` вместо `→`, ASCII `"`. |
| `no-ai-slop-writing.mdc` | Перед финалом писем/откликов/WhatsApp читать skill `no-ai-slop` и убирать AI-slop. Вызов: `/no-ai-slop`. |

## Как добавить новую инструкцию в «системный промпт»

1. **Создай файл в `.cursor/rules/`** с расширением `.md` или `.mdc`.

2. **Для `.mdc` укажи frontmatter:**
   ```yaml
   ---
   description: Краткое описание, когда правило нужно (для "Apply Intelligently").
   globs: "**/*.ts"   # опционально: только для этих файлов
   alwaysApply: false # true = всегда, false = по релевантности
   ---
   ```
   - **alwaysApply: true** — правило всегда в контексте.
   - **alwaysApply: false** + **description** — Cursor подключает правило, когда считает описание релевантным задаче.
   - **globs** — правило применяется при работе с файлами, подходящими под паттерн.

3. **Ниже frontmatter** напиши саму инструкцию в Markdown (что делать, в каком порядке, какие файлы смотреть).

4. **Сохрани файл** — Cursor подхватит новое правило без перезапуска.

## Как заставить Cursor проверять список решений

Уже настроено в `check-task-solutions.mdc`: при формулировках вроде «как получить данные», «парсинг», «какой API использовать», «подбери инструмент» Cursor по описанию правила подключает его и перед решением смотрит `KNOWLEDGE_SCRAPING_APIS_REFERENCE.md` (и другие справочники при добавлении).

Чтобы проверка срабатывала чаще, можно:
- Включить **alwaysApply: true** в `check-task-solutions.mdc` (тогда правило всегда в контексте), или
- Добавить в **description** дополнительные ключевые слова (например, «автоматизация», «интеграция», «n8n»).
