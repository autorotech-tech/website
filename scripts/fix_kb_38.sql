-- ID 38: восстановить оригинальный текст поста (после ошибочного LLM-enrich).
UPDATE public.knowledge_items SET
  source = 'telegram_forward',
  title = 'Claude Code — стек тулз для фабрики разработки',
  content_text = $body$🤖 Превращаем Claude Code в фабрику разработки — в сети собрали стек тулз, который закрывает почти весь цикл создания проектов.
🕤Claude Flow — огромный набор агентов и навыков.
🕤SuperClaude Framework — полноценная команда разработчиков.
🕤Claude Code Router — маршрутизация моделей и автоматизация генерации кода.
🕤CCPlugins — полезные плагины и автоматизация рутины.
🕤Claude Code Action — помощь с кодом, оптимизацией и исправлением багов.
🕤Claude Squad — управление агентами через терминал.
🕤Claude Code Templates — готовые шаблоны проектов.
🕤Agentic Project Management — менеджер для координации агентов и задач.$body$,
  ai_summary = 'Стек инструментов вокруг Claude Code: Flow, SuperClaude, Router, CCPlugins, Actions, Squad, Templates, Agentic PM.',
  category = 'note',
  tags = '["telegram", "note", "dev-tools", "claude-code"]'::jsonb,
  note_path = 'Knowledge Inbox/note-claude-code-stek-tulz-fabrika-razrabotki.md',
  status = 'embedded',
  updated_at = now()
WHERE id = 38 AND workspace_id = 1;
