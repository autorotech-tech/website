"""
Settings module — reads API keys from Supabase service_settings table (global keys).
Falls back to environment variables if DB is unavailable.
"""
import os
import httpx
from functools import lru_cache

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SEARXNG_URL = os.getenv("SEARXNG_URL", "http://searxng:8080")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "google/gemini-2.0-flash-001")

# Env-var fallbacks (used in dev/local mode)
_ENV_OPENROUTER = os.getenv("OPENROUTER_API_KEY", "")
_ENV_BRAVE = os.getenv("BRAVE_API_KEY", "")


def get_supabase():
    """Return a Supabase Python client or None if not configured."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    except Exception as e:
        print(f"[settings] Supabase init failed: {e}")
        return None


async def get_settings() -> dict:
    """
    Fetch global API keys from service_settings (row id=1).
    Returns dict with keys: openrouter_keys[], brave_keys[], etc.
    """
    sb = get_supabase()
    if not sb:
        return {}
    try:
        result = sb.table("service_settings").select(
            "openrouter_keys, openrouter_default_model, brave_keys, gemini_keys, groq_keys, glm_keys, openai_keys"
        ).eq("id", 1).single().execute()
        return result.data or {}
    except Exception as e:
        print(f"[settings] Failed to load service_settings: {e}")
        return {}


async def get_openrouter_key(settings: dict) -> str:
    """Get first available OpenRouter key (from DB or env)."""
    keys = settings.get("openrouter_keys") or []
    if isinstance(keys, list) and keys:
        return keys[0]
    # Fallback to env var
    return _ENV_OPENROUTER


async def get_openrouter_model(settings: dict) -> str:
    """
    Default OpenRouter model slug to use when the caller doesn't specify `model`.
    Comes from `service_settings.openrouter_default_model`, falls back to env DEFAULT_MODEL.
    """
    m = str(settings.get("openrouter_default_model") or "").strip()
    return m or DEFAULT_MODEL


async def get_brave_keys(settings: dict) -> list[str]:
    """All Brave Search API keys from DB or env (order = rotation order)."""
    keys = settings.get("brave_keys") or []
    out: list[str] = []
    if isinstance(keys, list):
        for k in keys:
            s = str(k).strip()
            if s:
                out.append(s)
    if out:
        return out
    if _ENV_BRAVE.strip():
        return [_ENV_BRAVE.strip()]
    return []


async def get_brave_key(settings: dict) -> str:
    """First Brave key (compat). Prefer get_brave_keys for rotation."""
    all_k = await get_brave_keys(settings)
    return all_k[0] if all_k else ""
