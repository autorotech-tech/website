-- Migration: add output_format and impersonate columns to scrapling_jobs
-- Run this on the Supabase Postgres instance

ALTER TABLE public.scrapling_jobs
  ADD COLUMN IF NOT EXISTS output_format text NOT NULL DEFAULT 'markdown',
  ADD COLUMN IF NOT EXISTS impersonate text;

COMMENT ON COLUMN public.scrapling_jobs.output_format IS 'Output format: markdown | html | text';
COMMENT ON COLUMN public.scrapling_jobs.impersonate IS 'Browser TLS fingerprint to impersonate (chrome, firefox, etc.)';
