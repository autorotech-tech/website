-- Chat Agent: Telegram connection metadata + RAG source conversion status.
-- Idempotent.

alter table public.chat_agents
  add column if not exists telegram_bot_username text;

alter table public.chat_agents
  add column if not exists telegram_webhook_url text;

alter table public.chat_agent_sources
  add column if not exists error text;

alter table public.chat_agent_sources
  add column if not exists markdown_path text;
