-- v4: CSV templates, proxy lists, proxy rotation

-- 1) Extraction templates (CSV column mapping)
CREATE TABLE IF NOT EXISTS public.scrapling_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  name text NOT NULL,
  columns jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE public.scrapling_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scrapling_templates' AND policyname = 'Admins manage scrapling templates'
  ) THEN
    CREATE POLICY "Admins manage scrapling templates" ON public.scrapling_templates
      FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

COMMENT ON TABLE public.scrapling_templates IS 'Saved CSV extraction templates with column→selector mappings';
COMMENT ON COLUMN public.scrapling_templates.columns IS '[{name, selector, attribute?}] — attribute is optional (href, src, etc), null = text content';

-- 2) Proxy lists with optional rotate URL
CREATE TABLE IF NOT EXISTS public.scrapling_proxy_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  name text NOT NULL,
  proxies jsonb NOT NULL DEFAULT '[]'::jsonb,
  rotate_url text
);

ALTER TABLE public.scrapling_proxy_lists ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'scrapling_proxy_lists' AND policyname = 'Admins manage scrapling proxy lists'
  ) THEN
    CREATE POLICY "Admins manage scrapling proxy lists" ON public.scrapling_proxy_lists
      FOR ALL USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
      );
  END IF;
END $$;

COMMENT ON TABLE public.scrapling_proxy_lists IS 'Reusable proxy lists for scraping jobs';
COMMENT ON COLUMN public.scrapling_proxy_lists.proxies IS 'JSON array of proxy URLs: ["http://user:pass@host:port", ...]';
COMMENT ON COLUMN public.scrapling_proxy_lists.rotate_url IS 'URL to call to trigger IP rotation (for providers that support it)';

-- 3) Add references to scrapling_jobs
ALTER TABLE public.scrapling_jobs
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.scrapling_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proxy_list_id uuid REFERENCES public.scrapling_proxy_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proxy_rotate_url text;

COMMENT ON COLUMN public.scrapling_jobs.template_id IS 'CSV extraction template to use';
COMMENT ON COLUMN public.scrapling_jobs.proxy_list_id IS 'Proxy list for round-robin rotation';
COMMENT ON COLUMN public.scrapling_jobs.proxy_rotate_url IS 'URL to call to trigger single-proxy IP rotation';
