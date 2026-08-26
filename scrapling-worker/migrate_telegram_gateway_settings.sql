-- Telegram autoro-gateway: маршрутизация апдейтов n8n (ассистент) vs Hermes (fallback).
-- Агент добавляет столбцы и при старте (ensure_service_settings_schema); этот файл — для ручного применения / документации.

ALTER TABLE public.service_settings
  ADD COLUMN IF NOT EXISTS telegram_gateway_routing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telegram_n8n_assistant_webhook_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS telegram_hermes_fallback_webhook_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS telegram_gateway_public_base TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.service_settings.telegram_gateway_routing_enabled IS
  'Если true и env TELEGRAM_ASSISTANT_ROUTING_ENABLED не задан — шлюз /api/v1/telegram/autoro-gateway включён';
COMMENT ON COLUMN public.service_settings.telegram_n8n_assistant_webhook_url IS
  'Полный HTTPS URL вебхука n8n (Telegram Personal Assistant Memory)';
COMMENT ON COLUMN public.service_settings.telegram_hermes_fallback_webhook_url IS
  'Полный HTTPS URL текущего Hermes/other secondary webhook';
COMMENT ON COLUMN public.service_settings.telegram_gateway_public_base IS
  'Публичный HTTPS origin agent-api для setWebhook, напр. https://swoop.autoro.tech';
