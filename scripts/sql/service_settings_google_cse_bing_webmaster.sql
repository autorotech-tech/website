-- Google Custom Search + Bing Webmaster key pools on service_settings.
-- Idempotent. Keys themselves stay out of git (seeded on VPS).

alter table public.service_settings
  add column if not exists google_cse_keys jsonb not null default '[]'::jsonb;

alter table public.service_settings
  add column if not exists google_cse_cx text not null default '';

alter table public.service_settings
  add column if not exists bing_webmaster_keys jsonb not null default '[]'::jsonb;

alter table public.service_settings
  add column if not exists bing_webmaster_site_url text not null default 'https://autoro.tech';
