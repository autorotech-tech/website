/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_AUTH_REDIRECT_TO?: string
  readonly VITE_BOOKMARKS_API_KEY?: string
  /** Пусто = относительные URL /api/v1 (dev: прокси Vite → agent-api; prod: тот же хост за nginx) */
  readonly VITE_AGENT_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

