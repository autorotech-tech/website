"""
Autoro Scraping Agent — public API for web scraping without an account.
Authentication via X-API-Key header, validated against service_settings.agent_api_key
(единый ключ для клиентов; LLM-вызовы маршрутизируются по типу задачи к провайдерам из Swoop settings).
"""

import os
import time
import uuid
import hmac
import base64
import datetime
import re
import shlex
import subprocess
from contextlib import asynccontextmanager, suppress
import secrets
import logging
import hashlib
import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from urllib.request import Request as UrlRequest, urlopen
from urllib.error import URLError, HTTPError

import psycopg2
import psycopg2.extras
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from swoop_lmarena import (
    lmarena_api_base as _lmarena_api_base,
    verify_lmarena_key as _verify_lmarena_key,
)
from swoop_provider_catalog import (
    build_openai_models_list,
    get_cached_openrouter_meta,
    get_cached_provider_catalogs,
    refresh_openrouter_catalog,
    resolve_model_for_provider,
    search_openrouter_models,
)
from swoop_expired_domains import configure_expired_domains, ensure_expired_domains_schema, router as expired_domains_router
from security import screen_capture_content

PGHOST = os.environ.get("PGHOST", "supabase-db")
PGPORT = int(os.environ.get("PGPORT") or "5433")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")
PGUSER = os.environ.get("PGUSER", "supabase_admin")
PGPASSWORD = os.environ.get("PGPASSWORD", "supabase_password_e97577f974376e8d")
INTERNAL_API_USER = os.environ.get("INTERNAL_API_USER", "n8n")
INTERNAL_API_PASSWORD = os.environ.get("INTERNAL_API_PASSWORD", "")
EXTENSION_BOOTSTRAP_SECRET = os.environ.get("EXTENSION_BOOTSTRAP_SECRET", INTERNAL_API_PASSWORD or PGPASSWORD)
EXTENSION_BOOTSTRAP_TTL_SEC = int(os.environ.get("EXTENSION_BOOTSTRAP_TTL_SEC") or "900")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://swoop.autoro.tech/supabase").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY") or os.environ.get("VITE_SUPABASE_ANON_KEY", "")
# Изолированный Supabase + Postgres только для Bookmarks Bro (опционально).
BOOKMARKS_SUPABASE_URL = (os.environ.get("BOOKMARKS_SUPABASE_URL") or "").strip().rstrip("/")
BOOKMARKS_SUPABASE_ANON_KEY = (os.environ.get("BOOKMARKS_SUPABASE_ANON_KEY") or "").strip()
BOOKMARKS_PGHOST = (os.environ.get("BOOKMARKS_PGHOST") or "").strip()
BOOKMARKS_PGPORT_RAW = os.environ.get("BOOKMARKS_PGPORT")
BOOKMARKS_PGDATABASE = (os.environ.get("BOOKMARKS_PGDATABASE") or "").strip()
BOOKMARKS_PGUSER = (os.environ.get("BOOKMARKS_PGUSER") or "").strip()
BOOKMARKS_UNAUTHORIZED_MAX_ITEMS = int(os.environ.get("BOOKMARKS_UNAUTHORIZED_MAX_ITEMS") or "5")
BOOKMARKS_UNAUTHORIZED_LIMIT_ENABLED = str(os.environ.get("BOOKMARKS_UNAUTHORIZED_LIMIT_ENABLED", "0")).lower() in ("1", "true", "yes", "on")
BOOKMARKS_PERPLEXICA_API_BASE = os.environ.get("BOOKMARKS_PERPLEXICA_API_BASE", "https://perplexica.autoro.tech").strip().rstrip("/")
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
TELEGRAM_WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
TELEGRAM_DEFAULT_WORKSPACE_ID = int(os.environ.get("TELEGRAM_DEFAULT_WORKSPACE_ID") or "1")
# Если Telegram webhook смотрит сюда, а часть команд обрабатывается в n8n (память/ассистент), а всё остальное — Hermes-другому URL.
TELEGRAM_N8N_ASSISTANT_WEBHOOK_URL = os.environ.get("TELEGRAM_N8N_ASSISTANT_WEBHOOK_URL", "").strip().rstrip("/")
TELEGRAM_WEBHOOK_SECONDARY_FALLBACK_URL = os.environ.get("TELEGRAM_WEBHOOK_SECONDARY_FALLBACK_URL", "").strip().rstrip("/")
_TELEGRAM_ASSIST_ROUTE_RAW = os.environ.get("TELEGRAM_ASSISTANT_ROUTING_ENABLED", "")
_TELEGRAM_ASSIST_ROUTE_STRIP = str(_TELEGRAM_ASSIST_ROUTE_RAW).strip()
# Если переменная задана (в т.ч. "0") — только env решает; если не задана — берём флаг из service_settings (Swoop).
TELEGRAM_ASSISTANT_ROUTING_ENV_EXPLICIT = bool(_TELEGRAM_ASSIST_ROUTE_STRIP)
TELEGRAM_ASSISTANT_ROUTING_FROM_ENV = _TELEGRAM_ASSIST_ROUTE_STRIP.lower() in ("1", "true", "yes", "on")
# Публичный origin agent-api (HTTPS, без пути), например https://swoop.autoro.tech — для setWebhook на /api/v1/telegram/autoro-gateway
TELEGRAM_AUTORO_GATEWAY_PUBLIC_BASE = os.environ.get("TELEGRAM_AUTORO_GATEWAY_PUBLIC_BASE", "").strip().rstrip("/")

TELEGRAM_N8N_SLASH_ROUTE_PREFIXES = frozenset(
    (
        "/research",
        "/optimize",
        "/prompt_optimize",
        "/ask",
        "/assistant",
        "/json",
        "/tojson",
        "/hermes",
        "/cursor",
        "/context",
        "/help",
        "/start",
        "/clear_context",
        "/clear",
        "/reset_context",
        "/status",
        "/ctx",
        "/monitor",
        "/obsidian_test",
        "/obs_test",
    )
)

TELEGRAM_N8N_INLINE_CALLBACK_COMMANDS = frozenset(("cmd:deepen", "cmd:json", "cmd:optimize", "cmd:save"))

HERMES_SINGLE_USER_EMAIL = (
    os.environ.get("HERMES_SINGLE_USER_EMAIL", "autoro.tech@gmail.com").strip().lower()
    or "autoro.tech@gmail.com"
)

logger = logging.getLogger("autoro-agent-api")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))

TELEGRAM_GATEWAY_SETTINGS_CACHE_SEC = float(os.environ.get("TELEGRAM_GATEWAY_SETTINGS_CACHE_SEC") or "10")
_telegram_gateway_settings_cache: Dict[str, Any] = {"t": 0.0, "row": None}


def _fetch_telegram_gateway_db_row() -> Dict[str, Any]:
    ensure_service_settings_schema()
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT COALESCE(telegram_gateway_routing_enabled, false) AS telegram_gateway_routing_enabled,
                       COALESCE(telegram_n8n_assistant_webhook_url, '') AS telegram_n8n_assistant_webhook_url,
                       COALESCE(telegram_hermes_fallback_webhook_url, '') AS telegram_hermes_fallback_webhook_url,
                       COALESCE(telegram_gateway_public_base, '') AS telegram_gateway_public_base
                FROM public.service_settings WHERE id = 1 LIMIT 1
                """
            )
            row = cur.fetchone()
        return dict(row) if row else {}
    except Exception as exc:
        logger.warning("telegram gateway: service_settings read failed: %s", exc)
        return {}
    finally:
        conn.close()


def get_telegram_gateway_db_cached() -> Dict[str, Any]:
    now = time.time()
    t0 = float(_telegram_gateway_settings_cache.get("t", 0.0))
    cached = _telegram_gateway_settings_cache.get("row")
    if cached is not None and (now - t0) < TELEGRAM_GATEWAY_SETTINGS_CACHE_SEC:
        return dict(cached)
    row = _fetch_telegram_gateway_db_row()
    _telegram_gateway_settings_cache["t"] = now
    _telegram_gateway_settings_cache["row"] = row
    return dict(row)


def resolve_telegram_gateway_config() -> Dict[str, Any]:
    """Env перекрывает БД для URL/base (если непустой env). Включение: явный env или флаг telegram_gateway_routing_enabled в БД."""
    db = get_telegram_gateway_db_cached()
    if TELEGRAM_ASSISTANT_ROUTING_ENV_EXPLICIT:
        routing = TELEGRAM_ASSISTANT_ROUTING_FROM_ENV
    else:
        routing = bool(db.get("telegram_gateway_routing_enabled"))
    env_n = (TELEGRAM_N8N_ASSISTANT_WEBHOOK_URL or "").strip().rstrip("/")
    env_f = (TELEGRAM_WEBHOOK_SECONDARY_FALLBACK_URL or "").strip().rstrip("/")
    env_b = (TELEGRAM_AUTORO_GATEWAY_PUBLIC_BASE or "").strip().rstrip("/")
    db_n = str(db.get("telegram_n8n_assistant_webhook_url") or "").strip().rstrip("/")
    db_f = str(db.get("telegram_hermes_fallback_webhook_url") or "").strip().rstrip("/")
    db_b = str(db.get("telegram_gateway_public_base") or "").strip().rstrip("/")
    return {
        "routingEnabled": routing,
        "n8nAssistantUrl": env_n or db_n,
        "fallbackUrl": env_f or db_f,
        "publicBase": env_b or db_b,
    }


def _telegram_update_message_text(update: Any) -> str:
    if not isinstance(update, dict):
        return ""
    msg = update.get("message") or update.get("edited_message")
    if isinstance(msg, dict):
        return str(msg.get("text") or msg.get("caption") or "").strip()
    cb = update.get("callback_query")
    if isinstance(cb, dict):
        return str(cb.get("data") or "").strip()
    return ""


def _telegram_should_route_to_n8n_assistant(raw_text: str) -> bool:
    t = raw_text.strip()
    if not t:
        return False
    tl = t.lower()
    if tl.startswith("cmd:"):
        head = tl.split()[0].split("@", 1)[0].strip()
        return head in TELEGRAM_N8N_INLINE_CALLBACK_COMMANDS
    if not tl.startswith("/"):
        return False
    tok = tl.split()[0].split("@", 1)[0]
    return tok in TELEGRAM_N8N_SLASH_ROUTE_PREFIXES


def _telegram_forward_raw_update(url: str, body: bytes, secret: str, timeout: float = 18.0) -> None:
    headers = {"Content-Type": "application/json"}
    tok = (secret or "").strip()
    if tok:
        headers["X-Telegram-Bot-Api-Secret-Token"] = tok
    req = UrlRequest(url=url, data=body, headers=headers, method="POST")
    with urlopen(req, timeout=timeout) as resp:
        resp.read()


async def _telegram_forward_background(url: str, body: bytes, secret: str) -> None:
    try:
        await asyncio.to_thread(_telegram_forward_raw_update, url, body, secret)
    except Exception as exc:
        logger.warning("Telegram forward failed url=%s err=%s", url, exc)


def _openrouter_catalog_refresh_job() -> Dict[str, int]:
    try:
        settings = load_swoop_llm_key_settings()
    except Exception:
        settings = {}
    stats = refresh_openrouter_catalog(settings)
    logger.info(
        "OpenRouter catalog auto-refresh: total=%s free=%s",
        stats.get("total"),
        stats.get("free_total"),
    )
    return stats


async def _openrouter_catalog_refresh_loop() -> None:
    interval = max(300.0, float(os.environ.get("OPENROUTER_CATALOG_REFRESH_SEC", "21600")))
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(_openrouter_catalog_refresh_job)
        except Exception as exc:
            logger.warning("OpenRouter catalog refresh loop failed: %s", exc)


@asynccontextmanager
async def _app_lifespan(app: FastAPI):
    """Схема bookmarks при старте; без доступной БД сервис всё равно поднимается (локальный dev)."""
    try:
        ensure_bookmarks_worker_schema()
        ensure_bookmarks_enrichment_schema()
        ensure_knowledge_schema()
        ensure_capture_moderation_queue_schema()
        ensure_bookmarks_token_usage_schema()
        ensure_bookmarks_bro_ui_workspace_schema()
        ensure_service_settings_schema()
        ensure_expired_domains_schema()
        ensure_telegram_assistant_schema()
    except Exception as exc:
        logger.warning("Bookmarks schema bootstrap skipped (DB unreachable?): %s", exc)
    refresh_task: Optional[asyncio.Task] = None
    try:
        await asyncio.to_thread(_openrouter_catalog_refresh_job)
    except Exception as exc:
        logger.warning("OpenRouter catalog warm-up skipped: %s", exc)
    refresh_task = asyncio.create_task(_openrouter_catalog_refresh_loop())
    yield
    if refresh_task is not None:
        refresh_task.cancel()
        with suppress(asyncio.CancelledError):
            await refresh_task


app = FastAPI(
    title="Autoro Scraping Agent",
    description="Public API for web scraping. Authenticate with X-API-Key header.",
    version="1.0.0",
    lifespan=_app_lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_rate_store: Dict[str, List[float]] = defaultdict(list)


def pg_connect():
    return psycopg2.connect(
        host=PGHOST, port=PGPORT, dbname=PGDATABASE,
        user=PGUSER, password=PGPASSWORD,
    )


def _bookmarks_pg_password() -> str:
    if "BOOKMARKS_PGPASSWORD" in os.environ:
        return os.environ.get("BOOKMARKS_PGPASSWORD") or ""
    return PGPASSWORD


def pg_connect_bookmarks():
    """Postgres для таблиц закладок; при отсутствии BOOKMARKS_PGHOST совпадает с pg_connect()."""
    host = BOOKMARKS_PGHOST or PGHOST
    port = int(BOOKMARKS_PGPORT_RAW or PGPORT)
    dbname = BOOKMARKS_PGDATABASE or PGDATABASE
    user = BOOKMARKS_PGUSER or PGUSER
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=_bookmarks_pg_password(),
    )


def bookmarks_auth_public_url() -> str:
    return BOOKMARKS_SUPABASE_URL or SUPABASE_URL


def bookmarks_auth_anon_key() -> str:
    return BOOKMARKS_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY


def load_agent_settings() -> Dict[str, Any]:
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT agent_api_key, agent_enabled, agent_rate_limit FROM public.service_settings WHERE id = 1")
            row = cur.fetchone()
        return dict(row) if row else {"agent_api_key": "", "agent_enabled": False, "agent_rate_limit": 30}
    except Exception:
        return {"agent_api_key": "", "agent_enabled": False, "agent_rate_limit": 30}
    finally:
        conn.close()


def load_swoop_service_settings_row() -> Dict[str, Any]:
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.service_settings WHERE id = 1 LIMIT 1")
            row = cur.fetchone()
        return dict(row) if row else {}
    except Exception as exc:
        logger.warning("load_swoop_service_settings_row: %s", exc)
        return {}
    finally:
        conn.close()


def verify_agent_key_header(x_api_key: Optional[str]) -> None:
    cfg = load_agent_settings()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not expected or (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


configure_expired_domains(
    pg_connect=pg_connect,
    load_agent_settings=load_agent_settings,
    load_swoop_settings=load_swoop_service_settings_row,
    verify_agent_key=verify_agent_key_header,
)

app.include_router(expired_domains_router)


def check_rate_limit(client_ip: str, limit: int) -> bool:
    now = time.time()
    window = 60.0
    timestamps = _rate_store[client_ip]
    _rate_store[client_ip] = [t for t in timestamps if now - t < window]
    if len(_rate_store[client_ip]) >= limit:
        return False
    _rate_store[client_ip].append(now)
    return True


def get_request_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("x-real-ip")
    if xri:
        return xri.strip()
    return request.client.host if request.client else "unknown"


def parse_telegram_domain(target_tg_url: str) -> str:
    url = (target_tg_url or "").strip()
    if not url:
        raise ValueError("target_tg_url is empty")
    if "domain=" in url:
        return url.split("domain=", 1)[1].split("&", 1)[0].strip().lstrip("@")
    if "t.me/" in url:
        path = url.split("t.me/", 1)[1]
        domain = path.split("?", 1)[0].split("/", 1)[0].strip().lstrip("@")
        if domain:
            return domain
    if url.startswith("@"):
        return url[1:]
    raise ValueError("Unsupported Telegram target URL format")


def build_telegram_link(target_tg_url: str, click_id: str) -> str:
    domain = parse_telegram_domain(target_tg_url)
    return f"https://t.me/{domain}?start={click_id}"


def build_landing_redirect_url(page_url: str, incoming_query: Dict[str, str], go_link: str, landing_id: int, spot_id: int) -> str:
    parsed = urlparse(page_url)
    existing_qs = dict(parse_qsl(parsed.query, keep_blank_values=True))
    merged_qs = {
        **existing_qs,
        **incoming_query,
        "go_link": go_link,
        "landing_id": str(landing_id),
        "spot_id": str(spot_id),
    }
    return urlunparse(parsed._replace(query=urlencode(merged_qs, doseq=True)))


def verify_internal_basic_auth(auth_header: Optional[str]) -> None:
    if not auth_header or not auth_header.startswith("Basic "):
        raise HTTPException(status_code=401, detail="Missing Basic auth")

    if not INTERNAL_API_PASSWORD:
        logger.error("INTERNAL_API_PASSWORD is not configured")
        raise HTTPException(status_code=503, detail="Internal auth is not configured")

    import base64
    try:
        raw = base64.b64decode(auth_header.split(" ", 1)[1]).decode("utf-8")
        username, password = raw.split(":", 1)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Basic auth header")

    valid = secrets.compare_digest(username, INTERNAL_API_USER) and secrets.compare_digest(password, INTERNAL_API_PASSWORD)
    if not valid:
        raise HTTPException(status_code=401, detail="Invalid credentials")


def save_click_async(
    click_id: str,
    spot_id: int,
    fbclid: Optional[str],
    ip_address: str,
    user_agent: str,
    utm_source: Optional[str],
    utm_medium: Optional[str],
    utm_campaign: Optional[str],
) -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.clicks
                  (click_id, spot_id, fbclid, ip_address, user_agent, utm_source, utm_medium, utm_campaign)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (click_id, spot_id, fbclid, ip_address, user_agent, utm_source, utm_medium, utm_campaign),
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to save click (spot_id=%s, click_id=%s): %s", spot_id, click_id, exc)
    finally:
        conn.close()


def verify_api_key(request: Request, x_api_key: str = Header(..., alias="X-API-Key")) -> Dict[str, Any]:
    settings = load_agent_settings()

    if not settings.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")

    stored_key = settings.get("agent_api_key", "")
    if not stored_key or x_api_key != stored_key:
        raise HTTPException(status_code=401, detail="Invalid API key")

    client_ip = request.client.host if request.client else "unknown"
    limit = settings.get("agent_rate_limit", 30)
    if not check_rate_limit(client_ip, limit):
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({limit}/min)")

    return {"client_ip": client_ip}


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(raw: str) -> bytes:
    padding = "=" * (-len(raw) % 4)
    return base64.urlsafe_b64decode((raw + padding).encode("ascii"))


def _sign_token_payload(payload_b64: str) -> str:
    digest = hmac.new(
        EXTENSION_BOOTSTRAP_SECRET.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


def issue_extension_access_token(
    client_ip: str,
    ttl_sec: int = EXTENSION_BOOTSTRAP_TTL_SEC,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    now = int(time.time())
    exp = now + max(60, int(ttl_sec))
    payload = {
        "sub": "bookmarks-extension",
        "scope": "bookmarks:ingest",
        "ip": client_ip,
        "iat": now,
        "exp": exp,
    }
    if user_id:
        payload["uid"] = str(user_id)
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig_b64 = _sign_token_payload(payload_b64)
    return {"token": f"{payload_b64}.{sig_b64}", "exp": exp, "iat": now}


def verify_extension_access_token(token: str, client_ip: str) -> Optional[Dict[str, Any]]:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        return None

    expected_sig = _sign_token_payload(payload_b64)
    if not secrets.compare_digest(sig_b64, expected_sig):
        return None

    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None

    if payload.get("scope") != "bookmarks:ingest":
        return None
    if payload.get("ip") != client_ip:
        return None
    exp = int(payload.get("exp") or 0)
    if exp < int(time.time()):
        return None
    return payload


def verify_bookmarks_access(
    request: Request,
    x_api_key: Optional[str],
    authorization: Optional[str],
) -> Dict[str, Any]:
    if str(os.environ.get("AGENT_API_DEV_BYPASS_AUTH", "0")).strip().lower() in ("1", "true", "yes", "on"):
        return {"client_ip": get_request_ip(request), "auth_mode": "dev_bypass"}

    settings = load_agent_settings()
    if not settings.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")

    client_ip = get_request_ip(request)
    limit = settings.get("agent_rate_limit", 30)

    if x_api_key:
        stored_key = settings.get("agent_api_key", "")
        if (stored_key and x_api_key == stored_key) or (TELEGRAM_WEBHOOK_SECRET and x_api_key == TELEGRAM_WEBHOOK_SECRET):
            if not check_rate_limit(client_ip, limit):
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({limit}/min)")
            return {"client_ip": client_ip, "auth_mode": "api_key"}

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        stored_key = settings.get("agent_api_key", "")
        if (stored_key and token == stored_key) or (TELEGRAM_WEBHOOK_SECRET and token == TELEGRAM_WEBHOOK_SECRET):
            if not check_rate_limit(client_ip, limit):
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({limit}/min)")
            return {"client_ip": client_ip, "auth_mode": "api_key"}

        extension_payload = verify_extension_access_token(token, client_ip)
        if extension_payload:
            if not check_rate_limit(client_ip, limit):
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({limit}/min)")
            return {
                "client_ip": client_ip,
                "auth_mode": "bootstrap_token",
                "user_id": extension_payload.get("uid"),
            }
        try:
            supabase_user = supabase_get_user(token)
            if not check_rate_limit(client_ip, limit):
                raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({limit}/min)")
            return {
                "client_ip": client_ip,
                "auth_mode": "supabase_user",
                "user_id": str(supabase_user.get("id") or ""),
            }
        except HTTPException:
            pass

    raise HTTPException(status_code=401, detail="Missing or invalid authentication")


def verify_workspace_membership(auth_ctx: Dict[str, Any], workspace_id: int) -> None:
    """Checks if the user has access to this workspace. Autoro Ops (api_key/dev_bypass) bypasses."""
    auth_mode = auth_ctx.get("auth_mode")
    user_id = auth_ctx.get("user_id")
    
    if auth_mode in ("dev_bypass", "api_key", "env_api_key"):
        return
        
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: No user identity found")
        
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT owner_id FROM public.workspaces WHERE id = %s", (workspace_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Workspace not found")
            owner_id = str(row[0]) if row[0] is not None else None
            if owner_id != user_id:
                raise HTTPException(status_code=403, detail="Forbidden: You do not have access to this workspace")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to verify workspace membership: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to verify workspace membership")
    finally:
        conn.close()


def verify_hermes_agent_access(
    request: Request,
    x_api_key: Optional[str],
    authorization: Optional[str],
) -> Dict[str, Any]:
    """Bearer из env (Hermes) без обращения к Postgres; иначе — стандартная проверка."""
    if str(os.environ.get("AGENT_API_DEV_BYPASS_AUTH", "0")).strip().lower() in ("1", "true", "yes", "on"):
        return {"client_ip": get_request_ip(request), "auth_mode": "dev_bypass"}

    client_ip = get_request_ip(request)
    env_keys = {
        os.environ.get("AGENT_API_KEY", "").strip(),
        os.environ.get("OPENROUTER_API_KEY", "").strip(),
    }
    env_keys.discard("")

    if x_api_key and x_api_key in env_keys:
        return {"client_ip": client_ip, "auth_mode": "env_api_key"}

    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
        if token in env_keys:
            return {"client_ip": client_ip, "auth_mode": "env_api_key"}

    return verify_bookmarks_access(request, x_api_key, authorization)


class ScrapeRequest(BaseModel):
    url: str = Field(..., description="Primary URL to scrape")
    urls: Optional[List[str]] = Field(None, description="Batch mode: list of URLs")
    mode: str = Field("fetcher", description="fetcher | stealth | dynamic | gologin")
    output_format: str = Field("markdown", description="markdown | html | text | json")
    selector: Optional[str] = Field(None, description="CSS or XPath selector")
    ai_prompt: Optional[str] = Field(None, description="AI extraction prompt (requires Gemini key)")
    crawl_depth: Optional[int] = Field(None, ge=0, le=5, description="Crawl depth for nested pages")
    max_pages: Optional[int] = Field(None, ge=1, le=100, description="Max pages for crawling")
    template_name: Optional[str] = Field(None, description="CSV template name")


class ScrapeResponse(BaseModel):
    job_id: str
    status: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    result_preview: Optional[str] = None
    result_url: Optional[str] = None
    error: Optional[str] = None
    created_at: Optional[str] = None


class ConversionUpsertPayload(BaseModel):
    click_id: str
    event_name: str = Field(default="Lead")
    status: str = Field(default="success", description="pending | success | failed")
    fb_event_id: Optional[str] = None
    error_message: Optional[str] = None
    meta_response: Optional[Dict[str, Any]] = None


class LandingCreatePayload(BaseModel):
    name: str
    slug: str
    page_url: str
    spot_id: int
    is_active: bool = True


class LandingUpdatePayload(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    page_url: Optional[str] = None
    spot_id: Optional[int] = None
    is_active: Optional[bool] = None


class BookmarkSyncProfile(BaseModel):
    browserType: str = Field(..., description="chrome|edge|brave|opera|firefox")
    profileExternalId: str = Field(..., min_length=1, max_length=255)
    displayName: Optional[str] = Field(None, max_length=255)


class BookmarkSyncItem(BaseModel):
    sourceBookmarkId: Optional[str] = Field(None, max_length=255)
    title: str = Field(..., min_length=1, max_length=1000)
    url: str = Field(..., min_length=3, max_length=4000)
    parentPath: Optional[str] = Field(None, max_length=1000)
    bookmarkedAt: Optional[str] = None


class BookmarkSyncStartPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    profile: BookmarkSyncProfile
    bookmarks: List[BookmarkSyncItem] = Field(default_factory=list)


class BookmarkWorkerRunPayload(BaseModel):
    max_tasks: int = Field(default=25, ge=1, le=200)
    workspaceId: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Опционально: обрабатывать только задачи этого workspace (рекомендуется для MVP).",
    )
    jobId: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Опционально: обрабатывать только задачи конкретного sync job.",
    )


class BookmarkPipelineRunPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    profile: BookmarkSyncProfile
    bookmarks: List[BookmarkSyncItem] = Field(default_factory=list)
    workerMaxTasks: int = Field(default=25, ge=1, le=200)
    enrichMaxTasks: int = Field(default=50, ge=1, le=200)


class BookmarkCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    url: str = Field(..., min_length=3, max_length=4000)
    title: Optional[str] = Field(default=None, max_length=1000)
    parentPath: Optional[str] = Field(default="telegram/hermes", max_length=1000)
    tags: Optional[List[str]] = Field(default=None)
    source: str = Field(default="telegram", max_length=64)


class CompleteTelegramLinkPayload(BaseModel):
    code: str
    telegramUserId: str
    chatId: str


class SaveTelegramBotTokenPayload(BaseModel):
    workspaceId: str
    botToken: str


class BookmarkSearchPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    query: str = Field(..., min_length=1, max_length=1000)
    limit: int = Field(default=20, ge=1, le=100)
    semantic: bool = Field(default=True)


class WebSearchPayload(BaseModel):
    """Прямой веб-поиск для агентов (без RAG по закладкам)."""

    query: str = Field(..., min_length=2, max_length=500)
    limit: int = Field(default=10, ge=1, le=20)


class VisionAnalyzePayload(BaseModel):
    """OCR / описание загруженного изображения (URL или base64)."""

    task: str = Field(default="", max_length=4000)
    image_url: Optional[str] = Field(default=None, max_length=2000)
    image_base64: Optional[str] = Field(default=None, max_length=8_000_000)


class SocialParsePayload(BaseModel):
    """Разбор поста / страницы соцсети по публичному URL."""

    url: str = Field(..., min_length=8, max_length=2000)


class MediaTranscribePayload(BaseModel):
    """Транскрипция аудио или видео по URL (Whisper через ключ OpenAI в Swoop)."""

    media_url: str = Field(..., min_length=8, max_length=2000)
    language: Optional[str] = Field(default=None, max_length=16)


class BookmarkAiRecommendPayload(BaseModel):
    """Описание задачи → векторный отбор кандидатов → LLM ранжирует полезные закладки."""

    workspaceId: str = Field(..., min_length=1, max_length=64)
    task: str = Field(..., min_length=5, max_length=4000)
    retrieveLimit: int = Field(default=32, ge=8, le=80, description="Сколько кандидатов вытащить из pgvector до LLM")
    maxPicks: int = Field(default=10, ge=1, le=20, description="Максимум рекомендаций в ответе")
    searchMode: str = Field(
        default="bookmarks",
        description="bookmarks | web_research | web | hybrid | fast | deep",
    )
    webLimit: int = Field(default=8, ge=3, le=20, description="Сколько внешних источников добавить в кандидаты")
    llm_provider: Optional[str] = Field(default=None, max_length=64)
    llm_model: Optional[str] = Field(default=None, max_length=255)
    depth: Optional[str] = Field(default="quick", description="quick | deep")
    autonomy: Optional[str] = Field(default="answer", description="answer | suggest | act")



class HermesAgentRunPayload(BaseModel):
    chat_id: Optional[str] = Field(default=None, max_length=128)
    mode: str = Field(default="ask", max_length=32, description="ask | research | optimize | json | cursor")
    prompt: str = Field(..., min_length=1, max_length=12000)
    llm_tier: Optional[str] = Field(default=None, max_length=32, description="code | reasoning | fast | general")
    llm_provider: Optional[str] = Field(default=None, max_length=64)
    llm_model: Optional[str] = Field(default=None, max_length=255)
    swoop_user_email: Optional[str] = Field(default="autoro.tech@gmail.com", max_length=255)
    context: Optional[Dict[str, Any]] = None


def _run_cursor_cli(prompt: str, context: Optional[Dict[str, Any]] = None) -> Tuple[str, Dict[str, Any]]:
    enabled = str(os.environ.get("HERMES_ENABLE_CURSOR_CLI", "0")).strip().lower() in ("1", "true", "yes", "on")
    if not enabled:
        raise HTTPException(
            status_code=503,
            detail="Cursor CLI mode disabled. Set HERMES_ENABLE_CURSOR_CLI=1 in agent-api environment.",
        )

    base_cmd = os.environ.get("HERMES_CURSOR_CLI_CMD", "cursor agent --print --output-format json").strip()
    if not base_cmd:
        base_cmd = "cursor agent --print --output-format json"
    argv = shlex.split(base_cmd)
    if not argv:
        raise HTTPException(status_code=500, detail="HERMES_CURSOR_CLI_CMD is empty")

    ctx = context or {}
    workspace = (
        str(ctx.get("cursor_workspace") or ctx.get("workspace_path") or os.environ.get("HERMES_CURSOR_WORKSPACE") or "")
        .strip()
    )
    if workspace:
        argv.extend(["--workspace", workspace])

    cursor_mode = str(ctx.get("cursor_mode") or "").strip().lower()
    if cursor_mode in {"plan", "ask"}:
        argv.extend(["--mode", cursor_mode])

    argv.append(prompt)
    timeout_sec = int(os.environ.get("HERMES_CURSOR_TIMEOUT_SEC") or "240")

    started = time.monotonic()
    try:
        proc = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=max(10, timeout_sec),
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Cursor CLI not found in PATH (expected `cursor`).")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Cursor CLI request timed out.")

    elapsed_ms = int((time.monotonic() - started) * 1000.0)
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        msg = stderr or stdout or f"exit code {proc.returncode}"
        raise HTTPException(status_code=502, detail=f"Cursor CLI failed: {msg[:400]}")

    answer = stdout
    if stdout:
        parsed_line_obj: Optional[Dict[str, Any]] = None
        lines = [ln for ln in stdout.splitlines() if ln.strip()]
        for ln in reversed(lines):
            try:
                obj = json.loads(ln)
            except Exception:
                continue
            if isinstance(obj, dict):
                parsed_line_obj = obj
                break
        if parsed_line_obj:
            answer = (
                str(
                    parsed_line_obj.get("text")
                    or parsed_line_obj.get("content")
                    or parsed_line_obj.get("output")
                    or parsed_line_obj.get("response")
                    or stdout
                )
                .strip()
            )

    if not answer:
        answer = "Cursor CLI completed with empty response."

    meta = {
        "provider": "cursor_cli",
        "elapsed_ms": elapsed_ms,
        "workspace": workspace,
        "cursor_mode": cursor_mode or None,
        "command": " ".join(argv[:6]) + (" ..." if len(argv) > 6 else ""),
    }
    return answer, meta


class BookmarkBootstrapPayload(BaseModel):
    profileId: Optional[str] = Field(default=None, max_length=255)
    workspaceId: Optional[str] = Field(default=None, max_length=64)


class BookmarkAuthLoginPayload(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=6, max_length=255)


class BookmarkAuthRefreshPayload(BaseModel):
    refreshToken: str = Field(..., min_length=10, max_length=4096)


class KnowledgeCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    source: str = Field(..., min_length=2, max_length=64, description="telegram | web_share | bookmark_extension | social")
    originalSender: Optional[str] = Field(default=None, max_length=255)
    url: Optional[str] = Field(default=None, max_length=4000)
    title: Optional[str] = Field(default=None, max_length=1000)
    text: str = Field(..., min_length=1, max_length=200000)
    aiSummary: Optional[str] = Field(default=None, max_length=4000)
    category: Optional[str] = Field(default=None, max_length=128)
    tags: List[str] = Field(default_factory=list)
    status: Optional[str] = Field(default="to_process", max_length=64)
    capturedAt: Optional[str] = Field(default=None, max_length=64)
    notePath: Optional[str] = Field(default=None, max_length=4000)
    referenceLinks: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Ссылки из поста [{label, url}] для Obsidian и Bookmarks Bro",
    )
    syncReferenceBookmarks: Optional[bool] = Field(
        default=True,
        description="Сохранить referenceLinks в bookmarks_bro",
    )
    enrich: Optional[bool] = Field(
        default=None,
        description="URL fetch + LLM optimize + tags; default from KNOWLEDGE_PIPELINE_ENRICH env",
    )


class KnowledgeSearchPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    query: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(default=20, ge=1, le=100)
    semantic: bool = Field(default=True)


class KnowledgeExportPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    query: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(default=120, ge=1, le=500)
    semantic: bool = Field(default=True)


class KeeptModerationResolvePayload(BaseModel):
    id: str = Field(..., min_length=36, max_length=36, description="Moderation queue UUID")
    workspaceId: str = Field(..., min_length=1, max_length=64)
    decision: str = Field(..., min_length=4, max_length=16, description="approve | reject")


class KnowledgeExtractCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    rawText: str = Field(..., min_length=1, max_length=200000)
    userInstruction: Optional[str] = Field(default=None, max_length=4000)
    source: str = Field(default="telegram_forward", max_length=64)
    originalSender: Optional[str] = Field(default=None, max_length=255)
    url: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("userInstruction", mode="before")
    @classmethod
    def _sanitize_user_instruction_field(cls, v: Any) -> Optional[str]:
        """OCR/vision не должен попадать в userInstruction — только короткая подпись пользователя."""
        if v is None:
            return None
        s = str(v).strip()
        if not s:
            return None
        if "[the user sent an image" in s.lower():
            s = re.sub(
                r"\[The user sent an image~[\s\S]*?\]\s*"
                r"(?:\[If you need a closer look[^\]]*\]\s*)?",
                "",
                s,
                flags=re.IGNORECASE,
            )
            marker = "[the user sent an image"
            lower = s.lower()
            while marker in lower:
                s = s[: lower.index(marker)].strip()
                lower = s.lower()
            s = re.sub(
                r"\[If you need a closer look[^\]]*\]",
                "",
                s,
                flags=re.IGNORECASE,
            ).strip()
            kb_markers = ("сохрани", "в бз", "базу знаний", "knowledge base", "#kb", "запиши", "добавь в")
            kb_lines = [ln for ln in s.splitlines() if any(m in ln.lower() for m in kb_markers)]
            if kb_lines:
                s = "\n".join(kb_lines).strip()
            elif len(s) > 500:
                s = ""
        if len(s) > 4000:
            s = s[:3999].rstrip() + "…"
        return s or None


class KnowledgeReEnrichPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    forceFetch: bool = Field(default=True)


class BookmarkTokenUsageLogPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    taskName: str = Field(..., min_length=1, max_length=255)
    model: Optional[str] = Field(default="unknown", max_length=255)
    provider: Optional[str] = Field(default="unknown", max_length=128)
    promptTokens: int = Field(default=0, ge=0, le=5_000_000)
    completionTokens: int = Field(default=0, ge=0, le=5_000_000)
    totalTokens: Optional[int] = Field(default=None, ge=0, le=10_000_000)
    meta: Optional[Dict[str, Any]] = None


class BookmarkWorkspaceUiStatePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    ideas: List[Dict[str, Any]] = Field(default_factory=list)
    reminders: List[Dict[str, Any]] = Field(default_factory=list)
    knowledgeItems: List[Dict[str, Any]] = Field(default_factory=list)


class TelegramWebhookSetupPayload(BaseModel):
    webhookUrl: str = Field(..., min_length=10, max_length=4000)
    secretToken: Optional[str] = Field(default=None, min_length=4, max_length=256)


def parse_optional_workspace_id(raw: Optional[str]) -> Optional[int]:
    """Для worker/enrich: None если не задано; иначе целочисленный workspace_id."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    try:
        return int(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric when provided")


def parse_required_workspace_id(raw: Optional[str]) -> int:
    v = parse_optional_workspace_id(raw)
    if v is None:
        raise HTTPException(status_code=400, detail="workspaceId is required")
    return v


def _norm_like(q: Optional[str]) -> Optional[str]:
    """Поиск подстроки ILIKE, без символов % от клиента для простоты."""
    s = (q or "").strip()
    if not s:
        return None
    s = s.replace("\\", "").replace("%", "").replace("_", "")[:400]
    if not s:
        return None
    return f"%{s}%"


def parse_optional_job_id(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def telegram_chat_workspace_map() -> Dict[str, int]:
    raw = (os.environ.get("TELEGRAM_CHAT_WORKSPACE_MAP") or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            return {}
        out: Dict[str, int] = {}
        for key, value in parsed.items():
            try:
                out[str(key)] = int(value)
            except Exception:
                continue
        return out
    except Exception:
        return {}


def resolve_telegram_workspace_id(chat_id: Optional[Any], telegram_user_id: Optional[Any] = None) -> Optional[int]:
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('public.telegram_workspace_links')::text")
            row = cur.fetchone()
            table_exists = bool(row and row[0])
            if table_exists:
                if chat_id is not None:
                    cur.execute("SELECT workspace_id FROM public.telegram_workspace_links WHERE chat_id = %s", (str(chat_id),))
                    row = cur.fetchone()
                    if row:
                        return int(row[0])
                if telegram_user_id is not None:
                    cur.execute("SELECT workspace_id FROM public.telegram_workspace_links WHERE telegram_user_id = %s", (str(telegram_user_id),))
                    row = cur.fetchone()
                    if row:
                        return int(row[0])
    except Exception as exc:
        logger.warning("Failed to query telegram_workspace_links: %s", exc)
    finally:
        conn.close()

    mapping = telegram_chat_workspace_map()
    if chat_id is not None:
        mapped = mapping.get(str(chat_id))
        if mapped:
            return mapped
            
    # Default fallback if unlinked
    return None


_KB_SPURIOUS_URL_PARTS = (
    "example.com",
    "your-org",
    "org/repo",
    "/commit/hash",
    "placeholder",
)


def is_spurious_knowledge_url(url: str) -> bool:
    u = (url or "").strip().lower()
    if not u:
        return True
    if any(p in u for p in _KB_SPURIOUS_URL_PARTS):
        return True
    if re.search(r"https?://[a-f0-9]{10,}\.(jpg|jpeg|png|webp|gif)(?:\?|$)", u, re.I):
        return True
    if "telesco.pe" in u or "telegram.org" in u:
        return True
    try:
        parsed = urlparse(u if "://" in u else f"https://{u.lstrip('/')}")
        host = (parsed.netloc or "").lower()
        path = (parsed.path or "").lower()
        if host.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp")):
            return True
        if host == "github.com":
            parts = [x for x in path.strip("/").split("/") if x]
            if len(parts) >= 2 and parts[0] in ("org", "your-org") and parts[1] in ("repo", "repository"):
                return True
            if "commit" in path and "hash" in path:
                return True
    except Exception:
        pass
    return False


def extract_urls_from_text(text: str) -> List[str]:
    pattern = r"https?://[^\s<>\"]+"
    urls = re.findall(pattern, text or "", flags=re.IGNORECASE)
    seen: set = set()
    normalized_urls: List[str] = []
    for raw in urls:
        try:
            nu = normalize_url(raw)
            if nu and nu not in seen and not is_spurious_knowledge_url(nu):
                seen.add(nu)
                normalized_urls.append(nu)
        except Exception:
            continue
    gh_re = re.compile(
        r"(?:https?://)?github\.com/([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})",
        re.I,
    )
    for m in gh_re.finditer(text or ""):
        owner, repo = m.group(1), m.group(2)
        if owner.lower() in ("org", "repos", "settings") or repo.lower() in ("repo", "repository"):
            continue
        nu = f"https://github.com/{owner}/{repo}"
        try:
            nu = normalize_url(nu)
        except Exception:
            continue
        if nu not in seen and not is_spurious_knowledge_url(nu):
            seen.add(nu)
            normalized_urls.append(nu)
    return normalized_urls


def _normalize_knowledge_link_entry(raw: Any) -> Optional[Dict[str, str]]:
    if isinstance(raw, str):
        u = raw.strip()
        if u.lower().startswith(("http://", "https://")):
            try:
                nu = normalize_url(u)
                return {"label": nu, "url": nu}
            except Exception:
                return None
        return None
    if not isinstance(raw, dict):
        return None
    url = str(raw.get("url") or raw.get("href") or "").strip()
    label = str(raw.get("label") or raw.get("title") or raw.get("name") or "").strip()
    if url:
        try:
            nu = normalize_url(url)
        except Exception:
            return None
        return {"label": label or nu, "url": nu}
    return None


def collect_knowledge_reference_links(
    *texts: str,
    primary_url: str = "",
    extracted_links: Optional[Any] = None,
) -> List[Dict[str, str]]:
    """Все http(s) из текста + links из LLM-extract (label + url)."""
    seen: set = set()
    out: List[Dict[str, str]] = []

    def add(label: str, url: str) -> None:
        raw_u = (url or "").strip()
        if not raw_u or raw_u in ("https://", "http://", "https:", "http:"):
            return
        try:
            nu = normalize_url(raw_u)
        except Exception:
            return
        if is_spurious_knowledge_url(nu):
            return
        parsed = urlparse(nu)
        if not parsed.netloc or len(parsed.netloc) < 3:
            return
        if nu in seen:
            return
        seen.add(nu)
        out.append({"label": _truncate_text((label or nu).strip(), 200) or nu, "url": nu})

    if primary_url:
        add("", primary_url)
    for blob in texts:
        for u in extract_urls_from_text(blob or ""):
            add(u, u)
    if isinstance(extracted_links, list):
        for item in extracted_links:
            entry = _normalize_knowledge_link_entry(item)
            if entry:
                add(entry["label"], entry["url"])
    return out[:30]


def sync_knowledge_reference_bookmarks(
    workspace_id: int,
    links: List[Dict[str, str]],
    *,
    parent_path: str,
    knowledge_item_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Каждая ссылка из поста БЗ → bookmarks_bro + очередь enrich."""
    urls = [str(x.get("url") or "").strip() for x in links if str(x.get("url") or "").strip()]
    if not urls:
        return {"ok": True, "accepted": 0, "items": []}
    kid = str(knowledge_item_id) if knowledge_item_id else uuid.uuid4().hex[:12]
    path = _truncate_text(parent_path or f"knowledge/{kid}", 1000)
    job = enqueue_telegram_urls_as_bookmarks(
        workspace_id=workspace_id,
        chat_id=f"knowledge-{kid}",
        message_id=kid,
        urls=urls,
    )
    items: List[Dict[str, Any]] = []
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for entry in links:
                url = str(entry.get("url") or "").strip()
                if not url:
                    continue
                try:
                    normalized = normalize_url(url)
                    url_hash = compute_url_hash(normalized)
                except Exception:
                    continue
                title = _truncate_text(str(entry.get("label") or normalized).strip(), 1000)
                cur.execute(
                    """
                    update public.bookmarks_bro_bookmarks
                    set title = %s,
                        parent_path = %s,
                        last_seen_at = now(),
                        is_deleted = false,
                        deleted_at = null
                    where workspace_id = %s and url_hash = %s
                    returning id
                    """,
                    (title, path, workspace_id, url_hash),
                )
                row = cur.fetchone()
                if row and row.get("id") is not None:
                    items.append({"bookmarkId": int(row["id"]), "url": normalized, "title": title})
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return {"ok": True, "syncJob": job, "accepted": len(items), "items": items}


def supabase_password_login(email: str, password: str) -> Dict[str, Any]:
    anon = bookmarks_auth_anon_key()
    if not anon:
        raise HTTPException(status_code=503, detail="SUPABASE_ANON_KEY (или BOOKMARKS_SUPABASE_ANON_KEY) не задан в agent-api")
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = UrlRequest(
        url=f"{bookmarks_auth_public_url()}/auth/v1/token?grant_type=password",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": anon,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict) or not data.get("access_token"):
                raise HTTPException(status_code=502, detail="Supabase login returned empty access_token")
            return data
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        detail = f"Supabase login failed: HTTP {exc.code}"
        try:
            parsed = json.loads(body) if body else {}
            if isinstance(parsed, dict) and parsed.get("msg"):
                detail = str(parsed["msg"])
            elif isinstance(parsed, dict) and parsed.get("error_description"):
                detail = str(parsed["error_description"])
        except Exception:
            pass
        raise HTTPException(status_code=401, detail=detail)
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase login network error: {exc}")


def supabase_password_signup(email: str, password: str) -> Dict[str, Any]:
    anon = bookmarks_auth_anon_key()
    if not anon:
        raise HTTPException(status_code=503, detail="SUPABASE_ANON_KEY (или BOOKMARKS_SUPABASE_ANON_KEY) не задан в agent-api")
    payload = json.dumps({"email": email, "password": password}).encode("utf-8")
    req = UrlRequest(
        url=f"{bookmarks_auth_public_url()}/auth/v1/signup",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": anon,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict):
                raise HTTPException(status_code=502, detail="Supabase signup returned invalid payload")
            return data
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        detail = f"Supabase signup failed: HTTP {exc.code}"
        try:
            parsed = json.loads(body) if body else {}
            if isinstance(parsed, dict) and parsed.get("msg"):
                detail = str(parsed["msg"])
            elif isinstance(parsed, dict) and parsed.get("error_description"):
                detail = str(parsed["error_description"])
            elif isinstance(parsed, dict) and parsed.get("error"):
                detail = str(parsed["error"])
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase signup network error: {exc}")


def supabase_refresh_session(refresh_token: str) -> Dict[str, Any]:
    anon = bookmarks_auth_anon_key()
    if not anon:
        raise HTTPException(status_code=503, detail="SUPABASE_ANON_KEY (или BOOKMARKS_SUPABASE_ANON_KEY) не задан в agent-api")
    payload = json.dumps({"refresh_token": refresh_token}).encode("utf-8")
    req = UrlRequest(
        url=f"{bookmarks_auth_public_url()}/auth/v1/token?grant_type=refresh_token",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "apikey": anon,
        },
        method="POST",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict) or not data.get("access_token"):
                raise HTTPException(status_code=401, detail="Supabase refresh returned empty access_token")
            return data
    except HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        detail = f"Supabase refresh failed: HTTP {exc.code}"
        try:
            parsed = json.loads(body) if body else {}
            if isinstance(parsed, dict) and parsed.get("msg"):
                detail = str(parsed["msg"])
            elif isinstance(parsed, dict) and parsed.get("error_description"):
                detail = str(parsed["error_description"])
            elif isinstance(parsed, dict) and parsed.get("error"):
                detail = str(parsed["error"])
        except Exception:
            pass
        raise HTTPException(status_code=401, detail=detail)
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase refresh network error: {exc}")


def supabase_get_user(access_token: str) -> Dict[str, Any]:
    anon = bookmarks_auth_anon_key()
    if not anon:
        raise HTTPException(status_code=503, detail="SUPABASE_ANON_KEY (или BOOKMARKS_SUPABASE_ANON_KEY) не задан в agent-api")
    req = UrlRequest(
        url=f"{bookmarks_auth_public_url()}/auth/v1/user",
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {access_token}",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict) or not data.get("id"):
                raise HTTPException(status_code=401, detail="Invalid Supabase user token")
            return data
    except HTTPError:
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase session")
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"Supabase user check network error: {exc}")


def duckduckgo_web_search(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """Легкий внешний поиск без ключа API; отдаём релевантные URL + сниппет."""
    try:
        q = (query or "").strip()
        if not q:
            return []
        api_url = "https://api.duckduckgo.com/?" + urlencode(
            {
                "q": q,
                "format": "json",
                "no_html": "1",
                "skip_disambig": "1",
            }
        )
        req = UrlRequest(
            url=api_url,
            headers={"User-Agent": "AutoroBookmarksBro/0.2"},
            method="GET",
        )
        with urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        payload = json.loads(raw) if raw else {}
    except Exception:
        return []

    out: List[Dict[str, Any]] = []

    def append_item(title: str, url: str, summary: str):
        if not url:
            return
        out.append(
            {
                "title": _truncate_text(title or url, 200),
                "url": str(url),
                "summary": _truncate_text(summary or "", 400),
                "category": "external",
                "tags": ["external", "web-search"],
            }
        )

    abstract_url = str(payload.get("AbstractURL") or "").strip()
    if abstract_url:
        append_item(
            str(payload.get("Heading") or abstract_url),
            abstract_url,
            str(payload.get("AbstractText") or ""),
        )

    related = payload.get("RelatedTopics")
    if isinstance(related, list):
        for item in related:
            if len(out) >= limit:
                break
            if isinstance(item, dict) and item.get("FirstURL"):
                append_item(str(item.get("Text") or item.get("FirstURL")), str(item.get("FirstURL")), str(item.get("Text") or ""))
                continue
            if isinstance(item, dict) and isinstance(item.get("Topics"), list):
                for sub in item["Topics"]:
                    if len(out) >= limit:
                        break
                    if isinstance(sub, dict) and sub.get("FirstURL"):
                        append_item(str(sub.get("Text") or sub.get("FirstURL")), str(sub.get("FirstURL")), str(sub.get("Text") or ""))

    # дедупликация URL и обрезка до лимита
    uniq: List[Dict[str, Any]] = []
    seen = set()
    for row in out:
        u = row.get("url")
        if not u or u in seen:
            continue
        seen.add(u)
        uniq.append(row)
        if len(uniq) >= limit:
            break
    return uniq


def tavily_web_search(api_key: str, query: str, limit: int = 8) -> List[Dict[str, Any]]:
    if not api_key:
        return []
    payload = {
        "api_key": api_key,
        "query": query,
        "search_depth": "advanced",
        "max_results": max(1, min(limit, 20)),
        "include_answer": False,
        "include_raw_content": False,
    }
    code, body, _raw = _http_post_json("https://api.tavily.com/search", {"Content-Type": "application/json"}, payload, timeout=25)
    if code < 200 or code >= 300 or not isinstance(body, dict):
        return []
    rows = body.get("results")
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": _truncate_text(str(row.get("title") or url), 200),
                "url": url,
                "summary": _truncate_text(str(row.get("content") or row.get("snippet") or ""), 400),
                "category": "external",
                "tags": ["external", "tavily"],
                "sourceProvider": "tavily",
            }
        )
        if len(out) >= limit:
            break
    return out


def brave_web_search(api_key: str, query: str, limit: int = 8) -> List[Dict[str, Any]]:
    if not api_key:
        return []
    q = urlencode(
        {
            "q": query,
            "count": max(1, min(limit, 20)),
            "safesearch": "off",
            "freshness": "py",
        }
    )
    req = UrlRequest(
        url=f"https://api.search.brave.com/res/v1/web/search?{q}",
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
            "User-Agent": "AutoroBookmarksBro/0.2",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            body = json.loads(raw) if raw else {}
    except Exception:
        return []
    web = body.get("web") if isinstance(body, dict) else None
    rows = web.get("results") if isinstance(web, dict) else None
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": _truncate_text(str(row.get("title") or url), 200),
                "url": url,
                "summary": _truncate_text(str(row.get("description") or ""), 400),
                "category": "external",
                "tags": ["external", "brave-search"],
                "sourceProvider": "brave",
            }
        )
        if len(out) >= limit:
            break
    return out


def _merge_web_search_rows(buckets: List[List[Dict[str, Any]]], limit: int) -> List[Dict[str, Any]]:
    """Дедуп по URL, сохраняем порядок провайдеров."""
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    cap = max(1, min(int(limit or 8), 20))
    for bucket in buckets:
        if not isinstance(bucket, list):
            continue
        for row in bucket:
            if not isinstance(row, dict):
                continue
            url = str(row.get("url") or "").strip()
            if not url or url in seen:
                continue
            seen.add(url)
            out.append(row)
            if len(out) >= cap:
                return out
    return out


def glm_web_search(api_key: str, query: str, limit: int = 8) -> List[Dict[str, Any]]:
    if not api_key:
        return []
    q = _truncate_text((query or "").strip(), 70)
    if not q:
        return []
    payload = {
        "search_query": q,
        "search_engine": os.environ.get("GLM_WEB_SEARCH_ENGINE", "search_std"),
        "search_intent": False,
        "count": max(1, min(limit, 20)),
        "content_size": "medium",
    }
    code, body, _raw = _http_post_json(
        "https://open.bigmodel.cn/api/paas/v4/web_search",
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        payload,
        timeout=45,
    )
    if code != 200 or not isinstance(body, dict):
        return []
    rows = body.get("search_result")
    if not isinstance(rows, list):
        return []
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("link") or row.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": _truncate_text(str(row.get("title") or url), 200),
                "url": url,
                "summary": _truncate_text(str(row.get("content") or ""), 400),
                "category": "external",
                "tags": ["external", "web-search"],
                "sourceProvider": "glm",
            }
        )
        if len(out) >= limit:
            break
    return out


def gemini_grounded_web_search(api_key: str, query: str, limit: int = 8) -> List[Dict[str, Any]]:
    if not api_key:
        return []
    q = (query or "").strip()
    if not q:
        return []
    model = (os.environ.get("BOOKMARKS_GEMINI_SEARCH_MODEL") or os.environ.get("BOOKMARKS_GEMINI_CHAT_MODEL") or "gemini-2.0-flash").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"Find relevant and up-to-date web pages for the query: {q}"}],
            }
        ],
        "tools": [{"google_search": {}}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
    }
    code, body, _raw = _http_post_json(url, {"Content-Type": "application/json"}, payload, timeout=90)
    if code != 200 or not isinstance(body, dict):
        return []
    meta = body.get("groundingMetadata")
    if not isinstance(meta, dict):
        candidates = body.get("candidates") or []
        if candidates and isinstance(candidates[0], dict):
            meta = (candidates[0].get("groundingMetadata") or {}) if isinstance(candidates[0], dict) else {}
        else:
            meta = {}
    chunks = meta.get("groundingChunks") if isinstance(meta, dict) else None
    if not isinstance(chunks, list):
        return []
    out: List[Dict[str, Any]] = []
    for chunk in chunks:
        if not isinstance(chunk, dict):
            continue
        web = chunk.get("web") if isinstance(chunk.get("web"), dict) else chunk
        if not isinstance(web, dict):
            continue
        page_url = str(web.get("uri") or web.get("url") or "").strip()
        if not page_url:
            continue
        title = str(web.get("title") or page_url)
        out.append(
            {
                "title": _truncate_text(title, 200),
                "url": page_url,
                "summary": _truncate_text(str(web.get("snippet") or ""), 400),
                "category": "external",
                "tags": ["external", "web-search"],
                "sourceProvider": "gemini",
            }
        )
        if len(out) >= limit:
            break
    return out


def external_web_search_from_settings(task: str, web_limit: int) -> List[Dict[str, Any]]:
    """Внешний поиск: Tavily, GLM, Gemini grounding, Brave, затем DuckDuckGo."""
    cfg = load_swoop_llm_key_settings()
    buckets: List[List[Dict[str, Any]]] = []
    cap = max(1, min(int(web_limit or 8), 20))

    for key in _iter_keys_with_health("tavily_keys", cfg.get("tavily_keys") or []):
        out = tavily_web_search(str(key), task, cap)
        if out:
            _key_health_mark_success("tavily_keys", str(key))
            buckets.append(out)
            break
        _key_health_mark_failure("tavily_keys", str(key), 429, "empty_or_failed_search")

    for key in _iter_keys_with_health("glm_keys", cfg.get("glm_keys") or []):
        out = glm_web_search(str(key), task, cap)
        if out:
            _key_health_mark_success("glm_keys", str(key))
            buckets.append(out)
            break
        _key_health_mark_failure("glm_keys", str(key), 429, "empty_or_failed_search")

    gemini_search_pool = _gemini_chat_key_pool(cfg)
    gemini_sps = len(gemini_search_pool)
    for key in _iter_keys_for_llm("gemini_pool", gemini_search_pool):
        out = gemini_grounded_web_search(str(key), task, cap)
        if out:
            _key_health_mark_success("gemini_pool", str(key))
            buckets.append(out)
            break
        _key_health_mark_failure("gemini_pool", str(key), 429, "empty_or_failed_search", pool_size=gemini_sps)

    for key in _iter_keys_with_health("brave_keys", cfg.get("brave_keys") or []):
        out = brave_web_search(str(key), task, cap)
        if out:
            _key_health_mark_success("brave_keys", str(key))
            buckets.append(out)
            break
        _key_health_mark_failure("brave_keys", str(key), 429, "empty_or_failed_search")

    merged = _merge_web_search_rows(buckets, cap)
    if merged:
        return merged
    return duckduckgo_web_search(task, cap)


def _perplexica_model_key(raw: Any) -> str:
    if not isinstance(raw, dict):
        return ""
    return str(raw.get("key") or raw.get("id") or raw.get("model") or "").strip()


def perplexica_web_search(perplexica_base: str, query: str, limit: int = 8, preferred_chat_model: str = "") -> List[Dict[str, Any]]:
    base = (perplexica_base or "").strip().rstrip("/")
    if not base:
        return []

    # 1) Discover providers + models
    req = UrlRequest(
        url=f"{base}/api/providers",
        headers={
            "Accept": "application/json",
            "User-Agent": "AutoroBookmarksBro/0.2",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=20) as resp:
            providers_raw = resp.read().decode("utf-8", errors="replace")
            providers_json = json.loads(providers_raw) if providers_raw else {}
    except Exception:
        return []

    providers = providers_json if isinstance(providers_json, list) else providers_json.get("providers")
    if not isinstance(providers, list):
        return []

    preferred = str(preferred_chat_model or "").strip()
    selected_provider_id = ""
    selected_chat_model = ""
    selected_embedding_model = ""

    # Prefer provider that contains preferred model key
    for provider in providers:
        if not isinstance(provider, dict):
            continue
        pid = str(provider.get("id") or provider.get("providerId") or "").strip()
        chat_models = provider.get("chatModels") if isinstance(provider.get("chatModels"), list) else []
        emb_models = provider.get("embeddingModels") if isinstance(provider.get("embeddingModels"), list) else []
        if not pid or not chat_models or not emb_models:
            continue
        chat_keys = [_perplexica_model_key(x) for x in chat_models]
        if preferred and preferred in chat_keys:
            selected_provider_id = pid
            selected_chat_model = preferred
            selected_embedding_model = _perplexica_model_key(emb_models[0])
            break

    # Fallback: first provider with chat + embedding
    if not selected_provider_id:
        for provider in providers:
            if not isinstance(provider, dict):
                continue
            pid = str(provider.get("id") or provider.get("providerId") or "").strip()
            chat_models = provider.get("chatModels") if isinstance(provider.get("chatModels"), list) else []
            emb_models = provider.get("embeddingModels") if isinstance(provider.get("embeddingModels"), list) else []
            if not pid or not chat_models or not emb_models:
                continue
            selected_provider_id = pid
            selected_chat_model = _perplexica_model_key(chat_models[0])
            selected_embedding_model = _perplexica_model_key(emb_models[0])
            break

    if not selected_provider_id or not selected_chat_model or not selected_embedding_model:
        return []

    # 2) Search request
    payload = {
        "chatModel": {"providerId": selected_provider_id, "key": selected_chat_model},
        "embeddingModel": {"providerId": selected_provider_id, "key": selected_embedding_model},
        "optimizationMode": "balanced",
        "sources": ["web"],
        "query": query,
        "stream": False,
    }
    code, body, _raw = _http_post_json(
        f"{base}/api/search",
        {"Content-Type": "application/json", "Accept": "application/json"},
        payload,
        timeout=45,
    )
    if code < 200 or code >= 300 or not isinstance(body, dict):
        return []

    source_rows = body.get("sources")
    if not isinstance(source_rows, list):
        source_rows = body.get("results")
    if not isinstance(source_rows, list):
        return []

    out: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    for row in source_rows:
        if not isinstance(row, dict):
            continue
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        url = str(row.get("url") or metadata.get("url") or row.get("link") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        title = str(row.get("title") or metadata.get("title") or url).strip()
        snippet = str(
            row.get("snippet")
            or row.get("content")
            or row.get("pageContent")
            or metadata.get("description")
            or ""
        )
        out.append(
            {
                "title": _truncate_text(title, 200),
                "url": url,
                "summary": _truncate_text(snippet, 400),
                "category": "external",
                "tags": ["external", "perplexica"],
                "sourceProvider": "perplexica",
            }
        )
        if len(out) >= limit:
            break
    return out


def deep_web_search_from_perplexica(task: str, web_limit: int) -> List[Dict[str, Any]]:
    cfg = load_swoop_llm_key_settings()
    preferred_model = str(cfg.get("openrouter_default_model") or "").strip()
    return perplexica_web_search(
        perplexica_base=BOOKMARKS_PERPLEXICA_API_BASE,
        query=task,
        limit=web_limit,
        preferred_chat_model=preferred_model,
    )


def normalize_url(raw_url: str) -> str:
    parsed = urlparse((raw_url or "").strip())
    scheme = (parsed.scheme or "https").lower()
    netloc = (parsed.netloc or "").lower()
    path = parsed.path or "/"
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=False)))
    normalized = urlunparse((scheme, netloc, path, "", query, ""))
    if normalized.endswith("/"):
        return normalized[:-1]
    return normalized


def compute_url_hash(normalized_url: str) -> str:
    return hashlib.sha256(normalized_url.encode("utf-8")).hexdigest()


def fetch_content_via_jina(target_url: str, timeout_sec: int = 20) -> Dict[str, Any]:
    reader_url = f"https://r.jina.ai/{target_url}"
    req = UrlRequest(
        reader_url,
        headers={
            "User-Agent": "AutoroBookmarksBro/0.1",
            "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            status_code = resp.getcode() or 200
            body = resp.read().decode("utf-8", errors="replace")
            return {
                "ok": True,
                "status_code": status_code,
                "content_text": body[:300000],
                "error": None,
            }
    except HTTPError as exc:
        return {"ok": False, "status_code": exc.code, "content_text": None, "error": f"http_error:{exc.code}"}
    except URLError as exc:
        return {"ok": False, "status_code": None, "content_text": None, "error": f"url_error:{exc.reason}"}
    except Exception as exc:
        return {"ok": False, "status_code": None, "content_text": None, "error": f"unexpected:{str(exc)}"}


def ensure_bookmarks_enrichment_schema() -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("create extension if not exists vector")
            cur.execute("alter table public.bookmark_page_content add column if not exists summary text")
            cur.execute("alter table public.bookmark_page_content add column if not exists category text")
            cur.execute("alter table public.bookmark_page_content add column if not exists tags jsonb not null default '[]'::jsonb")
            cur.execute("alter table public.bookmark_page_content add column if not exists enriched_at timestamptz")
            cur.execute("alter table public.bookmark_page_content add column if not exists embedding vector(1536)")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure bookmark enrichment schema: %s", exc)
    finally:
        conn.close()


def ensure_bookmarks_worker_schema() -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            # Keep schema compatible with worker/upsert queries.
            cur.execute("create table if not exists public.bookmark_page_content (id bigserial primary key, bookmark_id bigint not null)")
            cur.execute("alter table public.bookmark_page_content add column if not exists fetch_status text")
            cur.execute("alter table public.bookmark_page_content add column if not exists http_status integer")
            cur.execute("alter table public.bookmark_page_content add column if not exists content_text text")
            cur.execute("alter table public.bookmark_page_content add column if not exists content_hash text")
            cur.execute("alter table public.bookmark_page_content add column if not exists fetched_at timestamptz")
            cur.execute("alter table public.bookmark_page_content add column if not exists updated_at timestamptz")
            cur.execute("alter table public.bookmark_page_content add column if not exists fetch_error text")
            cur.execute(
                "alter table public.bookmark_page_content add column if not exists workspace_id bigint"
            )
            cur.execute("create unique index if not exists uq_bookmark_page_content_bookmark_id on public.bookmark_page_content(bookmark_id)")
            cur.execute("create index if not exists idx_bookmark_page_content_fetch_status on public.bookmark_page_content(fetch_status)")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure bookmark worker schema: %s", exc)
    finally:
        conn.close()


def ensure_knowledge_schema() -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("create extension if not exists vector")
            cur.execute(
                """
                create table if not exists public.knowledge_items (
                  id bigserial primary key,
                  workspace_id bigint not null,
                  source text not null,
                  original_sender text,
                  title text not null default '',
                  url text,
                  canonical_url text,
                  content_text text not null,
                  ai_summary text,
                  category text not null default 'general',
                  tags jsonb not null default '[]'::jsonb,
                  content_hash text not null,
                  status text not null default 'to_process',
                  note_path text,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now(),
                  last_seen_at timestamptz not null default now(),
                  seen_count integer not null default 1
                )
                """
            )
            cur.execute(
                "create unique index if not exists uq_knowledge_items_workspace_hash on public.knowledge_items(workspace_id, content_hash)"
            )
            cur.execute("create index if not exists idx_knowledge_items_workspace on public.knowledge_items(workspace_id)")
            cur.execute("create index if not exists idx_knowledge_items_status on public.knowledge_items(status)")
            cur.execute("create index if not exists idx_knowledge_items_last_seen on public.knowledge_items(last_seen_at desc)")

            cur.execute(
                """
                create table if not exists public.knowledge_vectors (
                  knowledge_item_id bigint primary key references public.knowledge_items(id) on delete cascade,
                  embedding vector(1536),
                  embedding_model text,
                  embedded_at timestamptz,
                  updated_at timestamptz not null default now()
                )
                """
            )
            cur.execute("create index if not exists idx_knowledge_vectors_embedded_at on public.knowledge_vectors(embedded_at desc)")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure knowledge schema: %s", exc)
    finally:
        conn.close()


def ensure_capture_moderation_queue_schema() -> None:
    """Очередь модерации для capture с PII / prompt injection (Google Intensive)."""
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.capture_moderation_queue (
                  id uuid primary key default gen_random_uuid(),
                  workspace_id bigint not null,
                  knowledge_item_id bigint references public.knowledge_items(id) on delete set null,
                  session_id varchar(128),
                  source varchar(64) not null,
                  url text,
                  original_title text,
                  raw_text text not null,
                  redacted_text text not null,
                  redacted_categories jsonb not null default '[]'::jsonb,
                  prompt_injection boolean not null default false,
                  status varchar(32) not null default 'pending_approval',
                  created_at timestamptz not null default now(),
                  resolved_at timestamptz
                )
                """
            )
            cur.execute(
                "create index if not exists idx_moderation_workspace_status "
                "on public.capture_moderation_queue(workspace_id, status)"
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure capture_moderation_queue schema: %s", exc)
    finally:
        conn.close()


def ensure_bookmarks_bro_ui_workspace_schema() -> None:
    """Bookmarks Bro UI: идеи, напоминания, карточки KB на workspace (snapshot)."""
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.bookmarks_bro_workspace_ui (
                  workspace_id bigint primary key,
                  ideas jsonb not null default '[]'::jsonb,
                  reminders jsonb not null default '[]'::jsonb,
                  knowledge_cards jsonb not null default '[]'::jsonb,
                  updated_at timestamptz not null default now()
                )
                """
            )
            cur.execute(
                "create index if not exists idx_bookmarks_bro_workspace_ui_updated on public.bookmarks_bro_workspace_ui(updated_at desc)"
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure bookmarks_bro_workspace_ui schema: %s", exc)
    finally:
        conn.close()


def ensure_bookmarks_token_usage_schema() -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.bookmarks_token_usage (
                  id bigserial primary key,
                  workspace_id bigint not null,
                  user_id text,
                  auth_mode text,
                  task_name text not null,
                  model text not null default 'unknown',
                  provider text not null default 'unknown',
                  prompt_tokens integer not null default 0,
                  completion_tokens integer not null default 0,
                  total_tokens integer not null default 0,
                  meta jsonb not null default '{}'::jsonb,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                )
                """
            )
            cur.execute("create index if not exists idx_bookmarks_token_usage_workspace on public.bookmarks_token_usage(workspace_id)")
            cur.execute("create index if not exists idx_bookmarks_token_usage_task_name on public.bookmarks_token_usage(task_name)")
            cur.execute("create index if not exists idx_bookmarks_token_usage_created_at on public.bookmarks_token_usage(created_at desc)")
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure bookmarks token usage schema: %s", exc)
    finally:
        conn.close()


def ensure_telegram_assistant_schema() -> None:
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.telegram_link_codes (
                  code text primary key,
                  user_id uuid not null,
                  workspace_id bigint not null references public.workspaces(id) on delete cascade,
                  expires_at timestamptz not null,
                  created_at timestamptz not null default now()
                )
                """
            )
            cur.execute(
                """
                create table if not exists public.telegram_workspace_links (
                  telegram_user_id text not null,
                  chat_id text primary key,
                  workspace_id bigint not null references public.workspaces(id) on delete cascade,
                  user_id uuid not null,
                  linked_at timestamptz not null default now()
                )
                """
            )
            cur.execute(
                """
                create table if not exists public.user_telegram_bots (
                  workspace_id bigint primary key references public.workspaces(id) on delete cascade,
                  user_id uuid not null,
                  bot_token_encrypted text not null,
                  bot_username text not null,
                  webhook_secret text not null,
                  status text not null default 'active',
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                )
                """
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure telegram assistant schema: %s", exc)
    finally:
        conn.close()


def ensure_service_settings_schema() -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("alter table public.service_settings add column if not exists key_health jsonb not null default '{}'::jsonb")
            cur.execute(
                "alter table public.service_settings add column if not exists agent_llm_routing jsonb not null default '{}'::jsonb"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists telegram_gateway_routing_enabled boolean not null default false"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists telegram_n8n_assistant_webhook_url text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists telegram_hermes_fallback_webhook_url text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists telegram_gateway_public_base text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists lmarena_keys jsonb not null default '[]'::jsonb"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists lmarena_base_url text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists lmarena_default_model text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists api_key_pool_meta jsonb not null default '{}'::jsonb"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists glm_default_model text not null default 'glm-4.7'"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists expireddomains_username text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists expireddomains_password text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists expireddomains_session_cookie text not null default ''"
            )
            cur.execute(
                "alter table public.service_settings add column if not exists expireddomains_api_base text not null default ''"
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("Failed to ensure service_settings schema: %s", exc)
    finally:
        conn.close()


def _truncate_text(value: str, max_len: int) -> str:
    if len(value) <= max_len:
        return value
    return value[: max_len - 3] + "..."


_TAGS_SCHEMA_CACHE = None

def get_tags_schema() -> dict:
    global _TAGS_SCHEMA_CACHE
    if _TAGS_SCHEMA_CACHE is not None:
        return _TAGS_SCHEMA_CACHE
    
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "schemas", "categories.json")
    schema_path = os.path.abspath(schema_path)
    
    default_schema = {
        "categories": ["general", "ai-ml", "dev-tools", "marketing", "business", "design", "prompt", "article", "note", "link", "task"],
        "tag_aliases": {
            "agents": "agent",
            "tools": "tool",
            "startups": "startup",
            "libraries": "library",
            "apis": "api",
            "embeddings": "embedding",
            "vectors": "vector",
            "databases": "database",
            "notes": "note",
            "bookmarks": "bookmark",
            "reminders": "reminder",
            "ideas": "idea",
            "workflows": "workflow",
            "pipelines": "pipeline",
            "categories": "category",
            "tags": "tag",
            "models": "model",
            "methods": "method",
            "algorithms": "algorithm",
            "llms": "llm",
            "webhooks": "webhook",
            "integrations": "integration",
            "prompts": "prompt",
            "searches": "search",
            "results": "result",
            "tokens": "token",
            "keys": "key",
            "users": "user",
            "members": "member",
            "roles": "role",
            "workspaces": "workspace",
            "servers": "server",
            "extensions": "extension",
            "browsers": "browser",
            "configs": "config",
            "strategies": "strategy",
            "frameworks": "framework",
            "packages": "package",
            "scripts": "script",
            "files": "file",
            "folders": "folder",
            "documents": "document",
            "pages": "page",
            "metrics": "metric"
        }
    }
    
    if os.path.exists(schema_path):
        try:
            with open(schema_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    _TAGS_SCHEMA_CACHE = loaded
                    return loaded
        except Exception as e:
            logger.warning("Failed to load tag schema from %s: %s", schema_path, e)
            
    _TAGS_SCHEMA_CACHE = default_schema
    return default_schema

def normalize_single_tag(tag: str, aliases: dict) -> str:
    t = str(tag).strip().lower()
    t = re.sub(r'[\s_]+', '-', t)
    t = re.sub(r'[^a-z0-9\-]', '', t)
    if not t:
        return ""
    
    if t in aliases:
        return aliases[t]
    
    EXEMPT_SINGULARS = {
        "postgres", "kubernetes", "redis", "js", "ts", "css", "os", "dns", "status", "analysis", "business", "class", "mass", "access", "process", "aws", "gcp"
    }
    
    if t in EXEMPT_SINGULARS:
        return t
        
    if t.endswith("ies") and len(t) > 3:
        candidate = t[:-3] + "y"
        if candidate in aliases:
            return aliases[candidate]
        return candidate
    elif t.endswith("es") and len(t) > 2:
        if t.endswith("ses") or t.endswith("ches") or t.endswith("shes") or t.endswith("xes"):
            candidate = t[:-2]
        else:
            candidate = t[:-1]
        if candidate in aliases:
            return aliases[candidate]
        return candidate
    elif t.endswith("s") and not t.endswith("ss") and len(t) > 2:
        candidate = t[:-1]
        if candidate in aliases:
            return aliases[candidate]
        return candidate
        
    return t

def normalize_tags(tags: list) -> list:
    if not tags:
        return []
    schema = get_tags_schema()
    aliases = schema.get("tag_aliases", {})
    normalized = []
    for t in tags:
        norm = normalize_single_tag(t, aliases)
        if norm and norm not in normalized:
            normalized.append(norm)
    return normalized


def normalize_category(category: str) -> str:
    if not category:
        return "general"
    schema = get_tags_schema()
    aliases = schema.get("tag_aliases", {})
    allowed = set(schema.get("categories", []))
    norm = normalize_single_tag(str(category), aliases)
    if norm in allowed:
        return norm
    return "general"


def infer_category(url: str, title: str, content_text: str) -> str:
    source = f"{url} {title} {content_text}".lower()
    schema = get_tags_schema()
    rules = {
        "ai-ml": ["ai", "llm", "machine learning", "neural", "openai", "anthropic", "gemini"],
        "dev-tools": ["github", "gitlab", "docs", "api", "sdk", "typescript", "python", "docker"],
        "marketing": ["seo", "ads", "marketing", "growth", "lead", "funnel"],
        "business": ["pricing", "saas", "revenue", "sales", "finance", "startup"],
        "design": ["design", "ui", "ux", "figma", "typography"],
        "prompt": ["prompt", "system prompt", "few-shot"],
        "article": ["article", "blog", "post", "essay"],
        "note": ["note", "memo", "journal"],
        "link": ["bookmark", "link", "url"],
        "task": ["task", "todo", "reminder"],
    }
    for category, words in rules.items():
        if category not in schema.get("categories", []):
            continue
        if any(w in source for w in words):
            return normalize_category(category)
    return "general"


def infer_tags(url: str, title: str, content_text: str, category: str) -> List[str]:
    source = f"{url} {title} {content_text}".lower()
    tag_candidates = [
        "ai", "llm", "openai", "gemini", "n8n", "automation", "api", "python",
        "typescript", "javascript", "docker", "postgres", "supabase", "seo",
        "marketing", "startup", "design", "analytics", "security",
    ]
    tags = [t for t in tag_candidates if t in source]
    if category not in tags:
        tags.insert(0, category)
    return normalize_tags(tags)[:6]


def local_enrich_bookmark(url: str, title: str, content_text: str) -> Dict[str, Any]:
    category = infer_category(url, title, content_text)
    tags = infer_tags(url, title, content_text, category)
    tags = normalize_tags(tags)
    raw = (content_text or "").replace("\n", " ").strip()
    if not raw:
        summary = _truncate_text(f"{title}. Bookmark imported from {url}.", 280)
    else:
        summary = _truncate_text(raw, 280)
    return {"summary": summary, "category": category, "tags": tags}


def build_vector_literal(values: List[float]) -> str:
    return "[" + ",".join(f"{v:.7f}" for v in values) + "]"


def build_knowledge_content_hash(
    source: str,
    canonical_url: str,
    text: str,
) -> str:
    raw = f"{source.strip().lower()}|{canonical_url.strip()}|{text.strip()}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def knowledge_obsidian_vault_relative_root(workspace_id: int) -> str:
    """
    Корень папки клиента под vault Obsidian (относительно корня vault).
    Шаблон: KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT, по умолчанию «Autoro KB/ws-{workspace_id}».
    Плейсхолдер {workspace_id} подставляется числом workspace.
    """
    template = (
        os.environ.get("KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT", "Autoro KB/ws-{workspace_id}")
        .strip()
        .strip("/")
    )
    return template.replace("{workspace_id}", str(int(workspace_id)))


def resolve_knowledge_obsidian_note_path(
    workspace_id: int,
    content_hash: str,
    explicit_note_path: Optional[str],
) -> str:
    """
    Полный относительный путь заметки: всегда внутри корня workspace (единая изолированная база на клиента).
    explicit_note_path: опционально путь без корня («Knowledge Inbox/…») или уже с тем же корнем ws.
    """
    root = knowledge_obsidian_vault_relative_root(workspace_id)
    day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
    default_leaf = f"Knowledge Inbox/{day}/{content_hash}.md"
    if explicit_note_path and str(explicit_note_path).strip():
        raw = str(explicit_note_path).strip().lstrip("/")
        if raw.startswith(root + "/") or raw == root:
            return raw
        return f"{root}/{raw}"
    return f"{root}/{default_leaf}"


def build_obsidian_knowledge_note(payload: Dict[str, Any]) -> str:
    source = str(payload.get("source") or "")
    original_sender = str(payload.get("originalSender") or "")
    url = str(payload.get("url") or "")
    tags = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    tags_s = ", ".join([str(t).strip() for t in tags if str(t).strip()])
    status = str(payload.get("status") or "to_process")
    content_hash = str(payload.get("contentHash") or "")
    title = _truncate_text(str(payload.get("title") or "Untitled"), 180)
    ai_summary = str(payload.get("aiSummary") or "").strip()
    text = str(payload.get("text") or "").strip()
    captured_at = str(payload.get("capturedAt") or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"))
    ingested_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    workspace_id_fm = payload.get("workspaceId")
    ws_line = f'workspace_id: "{workspace_id_fm}"\n' if workspace_id_fm not in (None, "") else ""
    ref_links_raw = payload.get("referenceLinks")
    ref_links: List[Dict[str, str]] = []
    if isinstance(ref_links_raw, list):
        for item in ref_links_raw:
            entry = _normalize_knowledge_link_entry(item)
            if entry:
                ref_links.append(entry)
    links_block = ""
    if ref_links:
        lines = ["### Ссылки из поста", ""]
        for item in ref_links:
            label = item.get("label") or item.get("url") or "link"
            link_url = item.get("url") or ""
            if link_url:
                lines.append(f"- [{label}]({link_url})")
            else:
                lines.append(f"- {label}")
        links_block = "\n".join(lines) + "\n\n"
        urls_fm = ", ".join(f'"{x["url"]}"' for x in ref_links if x.get("url"))
        urls_line = f"reference_urls: [{urls_fm}]\n" if urls_fm else ""
    else:
        urls_line = ""
    original_block = text
    source_block = ""
    if "\n## Источник\n" in text:
        parts = text.split("\n## Источник\n", 1)
        original_block = (parts[0] or "").strip()
        source_block = (parts[1] or "").strip()
        if source_block.startswith("http"):
            nl = source_block.find("\n")
            if nl > 0:
                source_block = source_block[nl + 1 :].strip()
    source_section = ""
    if source_block and len(source_block) > 120:
        source_section = "### Содержание источника\n" + source_block[:12000] + "\n\n"
    original_section = ""
    if original_block and not _looks_like_user_kb_command(original_block):
        original_section = "### Оригинальное сообщение\n" + original_block + "\n\n"
    elif original_block and source_block:
        original_section = ""
    elif original_block:
        original_section = "### Оригинальное сообщение\n" + original_block + "\n\n"
    return (
        "---\n"
        f"{ws_line}"
        f'source: "{source}"\n'
        f'original_sender: "{original_sender}"\n'
        f'url: "{url}"\n'
        f"{urls_line}"
        f"tags: [{tags_s}]\n"
        f"date: {captured_at[:10]}\n"
        f'status: "{status}"\n'
        f'content_hash: "{content_hash}"\n'
        f'ingested_at: "{ingested_at}"\n'
        "---\n"
        f"# {title}\n\n"
        "### Краткий контекст (AI Generated):\n"
        f"{ai_summary or '...'}\n\n"
        f"{links_block}"
        f"{source_section}"
        f"{original_section}"
    )


def knowledge_obsidian_sync_enabled() -> bool:
    """По умолчанию включено. Отключить: KNOWLEDGE_OBSIDIAN_SYNC=0."""
    v = os.environ.get("KNOWLEDGE_OBSIDIAN_SYNC", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def knowledge_obsidian_sync_mode() -> str:
    """
    syncthing (по умолчанию): один vault на VPS, Mac через Syncthing — без второго HTTP relay.
    dual: server relay + OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY (Mac relay / Tailscale).
    """
    return os.environ.get("KNOWLEDGE_OBSIDIAN_SYNC_MODE", "syncthing").strip().lower()


def knowledge_obsidian_local_sync_enabled() -> bool:
    """При mode=syncthing локальный relay не используется."""
    mode = knowledge_obsidian_sync_mode()
    if mode in ("syncthing", "single", "server_only", "server"):
        return False
    v = os.environ.get("KNOWLEDGE_OBSIDIAN_SYNC_LOCAL", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def obsidian_sync_targets() -> List[Tuple[str, str, str]]:
    """
    Цели синхронизации: (label, webhook_url, token).
    server — VPS vault через autoro-obsidian-relay;
    local — Mac/другой vault через OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY или OBSIDIAN_LOCAL_RELAY_URL.
    """
    primary_token = os.environ.get("OBSIDIAN_SYNC_TOKEN", "autoro_obsidian_sync_v1").strip()
    primary_url = (
        os.environ.get("OBSIDIAN_SYNC_WEBHOOK_URL", "http://autoro-obsidian-relay:8787/sync").strip()
    )
    secondary_url = os.environ.get("OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY", "").strip()
    if not secondary_url:
        secondary_url = os.environ.get("OBSIDIAN_LOCAL_RELAY_URL", "").strip()
    secondary_token = os.environ.get("OBSIDIAN_SYNC_TOKEN_SECONDARY", primary_token).strip()

    targets: List[Tuple[str, str, str]] = []
    if primary_url:
        targets.append(("server", primary_url, primary_token))
    if knowledge_obsidian_local_sync_enabled() and secondary_url and secondary_url != primary_url:
        targets.append(("local", secondary_url, secondary_token))
    return targets


def _sync_knowledge_note_to_obsidian_relay(
    webhook_url: str,
    token: str,
    note_path: str,
    markdown: str,
    mode: str = "update",
) -> Dict[str, Any]:
    rel = str(note_path or "").strip().lstrip("/")
    body_md = str(markdown or "").strip()
    url = str(webhook_url or "").strip()
    if not url:
        return {"ok": False, "skipped": True, "reason": "empty webhook_url"}
    if not rel or not body_md:
        return {"ok": False, "skipped": True, "reason": "empty note_path or markdown"}

    payload = json.dumps(
        {"file_path": rel, "content": body_md, "mode": mode or "update"},
        ensure_ascii=False,
    ).encode("utf-8")
    headers = {"Content-Type": "application/json; charset=utf-8"}
    if token:
        headers["X-Obsidian-Token"] = token
    req = UrlRequest(url, data=payload, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=45) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
            if isinstance(data, dict) and data.get("ok"):
                return {"ok": True, "file_path": data.get("file_path") or rel, **data}
            return {
                "ok": False,
                "file_path": rel,
                "error": (data.get("error") if isinstance(data, dict) else None) or "sync_failed",
                "details": data,
            }
    except HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="replace")[:1500]
        logger.warning("obsidian sync HTTP %s path=%s body=%s", exc.code, rel, err_body)
        return {"ok": False, "file_path": rel, "error": f"http_{exc.code}", "details": err_body}
    except Exception as exc:
        logger.warning("obsidian sync failed path=%s err=%s", rel, exc)
        return {"ok": False, "file_path": rel, "error": str(exc)}


def sync_knowledge_note_to_obsidian(
    note_path: str,
    markdown: str,
    mode: str = "update",
) -> Dict[str, Any]:
    """
    Пишет .md в Obsidian vault(ы) через obsidian-relay (/sync).
    По умолчанию: server (VPS) + local (Mac), если задан OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY.
    Альтернатива без второго URL: Syncthing/Obsidian Sync одного vault с VPS.
    """
    rel = str(note_path or "").strip().lstrip("/")
    if not knowledge_obsidian_sync_enabled():
        return {"ok": False, "skipped": True, "reason": "KNOWLEDGE_OBSIDIAN_SYNC disabled", "file_path": rel}
    if not rel or not str(markdown or "").strip():
        return {"ok": False, "skipped": True, "reason": "empty note_path or markdown", "file_path": rel}

    targets = obsidian_sync_targets()
    if not targets:
        return {"ok": False, "skipped": True, "reason": "no obsidian sync targets configured", "file_path": rel}

    by_target: Dict[str, Any] = {}
    any_ok = False
    for label, url, token in targets:
        result = _sync_knowledge_note_to_obsidian_relay(url, token, rel, markdown, mode)
        by_target[label] = result
        if result.get("ok"):
            any_ok = True

    server_r = by_target.get("server") or {}
    local_r = by_target.get("local") or {}
    return {
        "ok": any_ok,
        "written": any_ok,
        "file_path": rel,
        "targets": by_target,
        "serverWritten": bool(server_r.get("ok")),
        "localWritten": bool(local_r.get("ok")),
        "operation": server_r.get("operation") or local_r.get("operation"),
        "localSkipped": "local" not in by_target,
        "localSkipReason": (
            None
            if "local" in by_target
            else "set OBSIDIAN_SYNC_WEBHOOK_URL_SECONDARY or OBSIDIAN_LOCAL_RELAY_URL (Mac relay)"
        ),
    }


# pgvector column bookmark_page_content.embedding is vector(1536) — skip embeddings другой размерности.
BOOKMARKS_VECTOR_DIM = int(os.environ.get("BOOKMARKS_VECTOR_DIM", "1536"))


def is_bookmarks_ai_enrich_enabled() -> bool:
    """
    BOOKMARKS_AI_ENRICH: включить LLM-сводку в enrich/run (при наличии ключей).
    По умолчанию включено. Отключить: 0 | false | no | off — только local_enrich_bookmark.
    """
    v = os.environ.get("BOOKMARKS_AI_ENRICH", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def bookmarks_ai_enrich_max_calls_per_run() -> int:
    """
    BOOKMARKS_AI_ENRICH_MAX_CALLS: макс. попыток LLM-сводки за один POST enrich/run.
    0 или не задано — без лимита (каждая строка батча может вызвать LLM).
    """
    raw = os.environ.get("BOOKMARKS_AI_ENRICH_MAX_CALLS", "0").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


_SWOOP_LLM_CACHE: Dict[str, Any] = {"ts": 0.0, "settings": None}
_SWOOP_LLM_CACHE_TTL_SEC = 45.0
_KEY_POOL_RR_INDEX: Dict[str, int] = {}

_KEY_HEALTH_STATE: Dict[str, Dict[str, Any]] = {}
_API_KEY_POOL_META: Dict[str, List[Dict[str, Any]]] = {}
_META_PROVIDER_ALIASES: Dict[str, str] = {
    "openai_pool": "openai_keys",
    "groq_pool": "groq_keys",
    "gemini_pool": "gemini_keys",
}
_KEY_FAILURE_COOLDOWN_DEFAULT_SEC = int(os.environ.get("KEY_FAILURE_COOLDOWN_DEFAULT_SEC") or "900")
_KEY_FAILURE_COOLDOWN_RATE_LIMIT_SEC = int(os.environ.get("KEY_FAILURE_COOLDOWN_RATE_LIMIT_SEC") or "1200")
_KEY_FAILURE_COOLDOWN_AUTH_SEC = int(os.environ.get("KEY_FAILURE_COOLDOWN_AUTH_SEC") or "3600")
# При нескольких ключах в пуле — короткий cooldown, чтобы в одном запросе перебрать все ключи.
_KEY_FAILURE_COOLDOWN_MULTI_KEY_SEC = int(os.environ.get("KEY_FAILURE_COOLDOWN_MULTI_KEY_SEC") or "90")
_KEY_HEALTH_PERSIST_MIN_INTERVAL_SEC = float(os.environ.get("KEY_HEALTH_PERSIST_MIN_INTERVAL_SEC") or "5")
_KEY_HEALTH_LAST_PERSIST_TS = 0.0
_KEY_HEALTH_DIRTY = False


def _key_fingerprint(key: str) -> str:
    if not key:
        return ""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _health_state_id(provider: str, key: str) -> str:
    return f"{provider}:{_key_fingerprint(key)}"


def _mask_secret_key(key: str) -> str:
    if not key:
        return ""
    key = str(key)
    if len(key) <= 8:
        return key[0] + "•" * max(0, len(key) - 1)
    return f"{key[:4]}{'•' * 8}{key[-4:]}"


def _is_retryable_key_error(code: int, msg: str) -> bool:
    text = (msg or "").lower()
    if code in {401, 403} or "unauthorized" in text or "forbidden" in text or "invalid_api_key" in text or "incorrect api key" in text or "expired" in text:
        return False
    # 400/422 — ошибка payload/сообщений (Hermes tool turns), не «битый» API-ключ
    if code in {400, 422} or "invalid input" in text:
        return True
    if code in {402, 408, 409, 429}:
        return True
    if code >= 500:
        return True
    markers = (
        "rate",
        "quota",
        "limit",
        "insufficient",
        "余额",
        "资源",
        "resource_exhausted",
        "exhausted",
        "overloaded",
        "capacity",
        "billing",
        "payment",
        "credit",
        "balance",
    )
    return any(m in text for m in markers)


def _key_cooldown_sec(code: int, msg: str) -> int:
    text = (msg or "").lower()
    if code in {401, 403} or "unauthorized" in text or "forbidden" in text:
        return _KEY_FAILURE_COOLDOWN_AUTH_SEC
    if code in {402, 429} or "rate" in text or "quota" in text or "limit" in text:
        return _KEY_FAILURE_COOLDOWN_RATE_LIMIT_SEC
    return _KEY_FAILURE_COOLDOWN_DEFAULT_SEC


def _key_health_get(provider: str, key: str) -> Dict[str, Any]:
    hid = _health_state_id(provider, key)
    entry = _KEY_HEALTH_STATE.get(hid) or {}
    return entry


def _hydrate_key_health_state(raw: Any) -> None:
    if not isinstance(raw, dict):
        return
    loaded: Dict[str, Dict[str, Any]] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or ":" not in k:
            continue
        if not isinstance(v, dict):
            continue
        loaded[k] = {
            "provider": str(v.get("provider") or ""),
            "last_status": str(v.get("last_status") or ""),
            "last_code": int(v.get("last_code") or 0),
            "last_error": str(v.get("last_error") or "")[:240],
            "last_success_ts": float(v.get("last_success_ts") or 0.0),
            "last_failed_ts": float(v.get("last_failed_ts") or 0.0),
            "inactive_until_ts": float(v.get("inactive_until_ts") or 0.0),
        }
    if loaded:
        _KEY_HEALTH_STATE.update(loaded)


def _persist_key_health_state(force: bool = False) -> None:
    global _KEY_HEALTH_LAST_PERSIST_TS, _KEY_HEALTH_DIRTY
    now = time.time()
    if not force:
        if not _KEY_HEALTH_DIRTY:
            return
        if (now - _KEY_HEALTH_LAST_PERSIST_TS) < _KEY_HEALTH_PERSIST_MIN_INTERVAL_SEC:
            return
    try:
        conn = pg_connect()
        with conn.cursor() as cur:
            cur.execute(
                """
                update public.service_settings
                   set key_health = %s::jsonb,
                       updated_at = now()
                 where id = 1
                """,
                (json.dumps(_KEY_HEALTH_STATE, ensure_ascii=False),),
            )
        conn.commit()
        conn.close()
        _KEY_HEALTH_LAST_PERSIST_TS = now
        _KEY_HEALTH_DIRTY = False
    except Exception as exc:
        logger.warning("Failed to persist key_health: %s", exc)


def _key_health_is_inactive(provider: str, key: str, now_ts: Optional[float] = None) -> bool:
    entry = _key_health_get(provider, key)
    if not entry:
        return False
    now = now_ts if now_ts is not None else time.time()
    until = float(entry.get("inactive_until_ts") or 0.0)
    return until > now


def _key_health_mark_success(provider: str, key: str) -> None:
    global _KEY_HEALTH_DIRTY
    hid = _health_state_id(provider, key)
    now = time.time()
    _KEY_HEALTH_STATE[hid] = {
        "provider": provider,
        "last_status": "active",
        "last_code": 200,
        "last_error": "",
        "last_success_ts": now,
        "inactive_until_ts": 0.0,
    }
    _KEY_HEALTH_DIRTY = True
    _persist_key_health_state(force=False)


def _key_health_mark_failure(provider: str, key: str, code: int, msg: str, *, pool_size: int = 1) -> None:
    text = (msg or "").lower()
    if msg == "empty_content" or "empty_content" in text:
        return
    global _KEY_HEALTH_DIRTY
    hid = _health_state_id(provider, key)
    now = time.time()
    entry = _KEY_HEALTH_STATE.get(hid) or {}
    cooldown = _key_cooldown_sec(code, msg)
    is_retryable = _is_retryable_key_error(code, msg)
    if pool_size > 1 and is_retryable and code in {402, 429}:
        cooldown = min(cooldown, _KEY_FAILURE_COOLDOWN_MULTI_KEY_SEC)
    if not is_retryable:
        inactive_until_ts = now + 31536000.0  # 1 year
        last_status = "broken"
    else:
        inactive_until_ts = now + cooldown
        last_status = "inactive" if inactive_until_ts > now else "unknown"
    _KEY_HEALTH_STATE[hid] = {
        "provider": provider,
        "last_status": last_status,
        "last_code": int(code or 0),
        "last_error": (msg or "")[:240],
        "last_failed_ts": now,
        "last_success_ts": float(entry.get("last_success_ts") or 0.0),
        "inactive_until_ts": inactive_until_ts,
    }
    _KEY_HEALTH_DIRTY = True
    _persist_key_health_state(force=True)


def _normalize_api_key_pool_meta(raw: Any) -> Dict[str, List[Dict[str, Any]]]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, List[Dict[str, Any]]] = {}
    for field, entries in raw.items():
        if not isinstance(field, str) or not field.strip():
            continue
        if not isinstance(entries, list):
            continue
        normalized: List[Dict[str, Any]] = []
        for item in entries:
            if isinstance(item, dict):
                enabled = item.get("enabled")
                normalized.append({"enabled": enabled is not False})
            else:
                normalized.append({"enabled": True})
        out[field.strip()] = normalized
    return out


def _hydrate_api_key_pool_meta(raw: Any) -> None:
    global _API_KEY_POOL_META
    _API_KEY_POOL_META = _normalize_api_key_pool_meta(raw)


def _meta_field_for_provider(provider: str) -> str:
    return _META_PROVIDER_ALIASES.get(provider, provider)


def _is_key_admin_disabled(provider: str, key: str) -> bool:
    meta_field = _meta_field_for_provider(provider)
    entries = _API_KEY_POOL_META.get(meta_field) or []
    if not entries:
        return False
    cfg = load_swoop_llm_key_settings()
    canonical = [str(k).strip() for k in (cfg.get(meta_field) or []) if str(k).strip()]
    try:
        idx = canonical.index(str(key).strip())
    except ValueError:
        return False
    if idx >= len(entries):
        return False
    entry = entries[idx]
    if not isinstance(entry, dict):
        return False
    return entry.get("enabled") is False


def _get_key_pool_strategy() -> str:
    try:
        settings = load_swoop_llm_key_settings()
        routing = settings.get("agent_llm_routing")
        if isinstance(routing, dict):
            strategy = str(routing.get("key_pool_strategy") or "fill-first").strip().lower()
            if strategy in ("round-robin", "fill-first"):
                return strategy
    except Exception:
        pass
    return "fill-first"


def _iter_keys_with_health(provider: str, keys: List[str]) -> List[str]:
    clean = [str(k).strip() for k in (keys or []) if str(k).strip()]
    if not clean:
        return []
    now = time.time()
    active: List[str] = []
    inactive: List[str] = []
    for key in clean:
        if _is_key_admin_disabled(provider, key):
            continue
        state = _key_health_get(provider, key)
        last_code = int(state.get("last_code") or 0)
        if last_code in {401, 403}:
            continue
        if _key_health_is_inactive(provider, key, now):
            inactive.append(key)
        else:
            active.append(key)
    ordered = active + inactive
    if not ordered:
        return []
    if _get_key_pool_strategy() == "round-robin":
        start = _KEY_POOL_RR_INDEX.get(provider, 0) % len(ordered)
        _KEY_POOL_RR_INDEX[provider] = start + 1
        return ordered[start:] + ordered[:start]
    return ordered


def _iter_keys_for_llm(provider: str, keys: List[str]):
    """Ключи в порядке health; лог каждой попытки (ротация до успеха)."""
    ordered = _iter_keys_with_health(provider, keys)
    total = len(ordered)
    if total:
        logger.info("LLM key pool %s size=%s", provider, total)
    for idx, key in enumerate(ordered, 1):
        logger.info("LLM try %s %s/%s fp=%s", provider, idx, total, _mask_secret_key(key))
        yield key


def _normalize_key_list(val: Any) -> List[str]:
    if val is None:
        return []
    if isinstance(val, list):
        return [str(x).strip() for x in val if isinstance(x, str) and x.strip()]
    if isinstance(val, str):
        try:
            parsed = json.loads(val)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if x and str(x).strip()]
        except Exception:
            pass
        if val.strip():
            return [val.strip()]
    return []


def _flatten_api_key_groups(groups: Any) -> List[str]:
    out: List[str] = []
    if not isinstance(groups, list):
        return out
    for item in groups:
        if not isinstance(item, dict):
            continue
        for k in item.get("keys") or []:
            if isinstance(k, str) and k.strip():
                out.append(k.strip())
    return out


def _select_api_key_group_keys(
    groups: Any,
    desired_provider: str = "",
    desired_tier: str = "",
    desired_model: str = "",
    swoop_user_email: str = "",
) -> List[str]:
    """
    Выбирает ключи из service_settings.api_key_groups по назначению (provider/tier/model/email).

    Backward-compatible: старые группы без метаданных просто считаются "общими".
    Если фильтры ничего не нашли — возвращает flatten как fallback.

    Ожидаемая форма группы (JSON object):
      {
        "id": "...",
        "name": "...",
        "keys": ["k1", "k2"],
        "provider": "openrouter" | "openai" | "groq" | "glm" | "gemini" | "lmarena" | "",
        "tiers": ["general", "fast", ...],
        "models": ["anthropic/claude-3.7-sonnet", ...],
        "user_email": "autoro.tech@gmail.com",
        "priority": 10
      }
    """
    if not isinstance(groups, list):
        return []

    prov_norm = str(desired_provider or "").strip().lower()
    tier_norm = str(desired_tier or "").strip().lower()
    model_norm = str(desired_model or "").strip()
    email_norm = str(swoop_user_email or "").strip().lower()

    matches: List[Tuple[int, int, List[str]]] = []  # (priority, index, keys)
    any_keys: List[str] = []

    for idx, item in enumerate(groups):
        if not isinstance(item, dict):
            continue
        keys = [str(k).strip() for k in (item.get("keys") or []) if isinstance(k, str) and str(k).strip()]
        if not keys:
            continue
        any_keys.extend(keys)

        # provider filter (if both specified)
        item_provider = str(item.get("provider") or "").strip().lower()
        if prov_norm and item_provider and item_provider != prov_norm:
            continue

        # tier filter (if both specified)
        item_tiers = item.get("tiers") or []
        tiers_norm = [str(x).strip().lower() for x in item_tiers] if isinstance(item_tiers, list) else []
        tiers_norm = [x for x in tiers_norm if x]
        if tier_norm and tiers_norm and tier_norm not in tiers_norm:
            continue

        # model filter (if both specified)
        item_models = item.get("models") or []
        models_norm = [str(x).strip() for x in item_models] if isinstance(item_models, list) else []
        models_norm = [x for x in models_norm if x]
        if model_norm and models_norm and model_norm not in models_norm:
            continue

        # user_email filter (if both specified)
        raw_email = (
            item.get("user_email")
            or item.get("email")
            or item.get("owner_email")
            or item.get("account_email")
            or ""
        )
        item_email = str(raw_email).strip().lower()
        if email_norm and item_email and item_email != email_norm:
            continue

        priority = int(item.get("priority") or 0)
        matches.append((priority, idx, keys))

    if not matches:
        return _flatten_api_key_groups(groups) if any_keys else []

    matches.sort(key=lambda t: (-t[0], t[1]))
    out: List[str] = []
    for _, __, keys in matches:
        out.extend(keys)
    return out


_LLM_ROUTING_PROVIDERS = frozenset(
    {"openrouter", "groq", "glm", "openai", "gemini", "lmarena", "api_key_groups", "env_openai"}
)
_LLM_TIER_NAMES: Tuple[str, ...] = ("code", "reasoning", "fast", "general", "vision")


def _default_agent_llm_routing() -> Dict[str, Any]:
    """Цепочки по умолчанию, если в БД пусто или неполная конфигурация."""
    glm_step = {"provider": "glm", "model": ""}
    or_step = {"provider": "openrouter", "model": ""}
    return {
        "tiers": {
            "code": [
                glm_step,
                or_step,
                {"provider": "groq", "model": ""},
                {"provider": "openai", "model": ""},
                {"provider": "gemini", "model": ""},
            ],
            "reasoning": [
                glm_step,
                or_step,
                {"provider": "openai", "model": ""},
                {"provider": "groq", "model": ""},
                {"provider": "gemini", "model": ""},
            ],
            "fast": [
                glm_step,
                or_step,
                {"provider": "groq", "model": ""},
                {"provider": "openai", "model": ""},
                {"provider": "gemini", "model": ""},
            ],
            "general": [
                glm_step,
                or_step,
                {"provider": "groq", "model": ""},
                {"provider": "openai", "model": ""},
                {"provider": "gemini", "model": ""},
            ],
            "vision": [
                {"provider": "glm", "model": ""},
                {"provider": "gemini", "model": ""},
                or_step,
                {"provider": "openai", "model": ""},
                {"provider": "groq", "model": ""},
            ],
        },
        "tier_models": {
            "glm": {
                "fast": "glm-4-flash",
                "general": "glm-4.7",
                "code": "glm-4.7",
                "reasoning": "glm-5",
                "vision": "glm-4v-flash",
            },
            "openrouter": {
                "fast": "openai/gpt-4o-mini",
                "general": "anthropic/claude-3.7-sonnet",
                "code": "anthropic/claude-3.7-sonnet",
                "reasoning": "anthropic/claude-3.7-sonnet",
                "vision": "google/gemini-2.5-pro",
            },
        },
        "fallback": [
            {"provider": "api_key_groups", "model": ""},
            {"provider": "env_openai", "model": ""},
        ],
        "key_pool_strategy": "fill-first",
    }


def _coerce_routing_steps(val: Any) -> List[Dict[str, str]]:
    if not isinstance(val, list):
        return []
    out: List[Dict[str, str]] = []
    for item in val:
        if not isinstance(item, dict):
            continue
        prov = str(item.get("provider") or "").strip().lower()
        if prov not in _LLM_ROUTING_PROVIDERS:
            continue
        model = str(item.get("model") or "").strip()
        out.append({"provider": prov, "model": model})
    return out


def _normalize_tier_models(raw: Any) -> Dict[str, Dict[str, str]]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, str]] = {}
    for prov, tiers in raw.items():
        if not isinstance(tiers, dict):
            continue
        prov_key = str(prov).strip().lower()
        if not prov_key:
            continue
        tier_map: Dict[str, str] = {}
        for tier in _LLM_TIER_NAMES:
            val = tiers.get(tier)
            if val is not None and str(val).strip():
                tier_map[tier] = str(val).strip()
        if tier_map:
            out[prov_key] = tier_map
    return out


def _normalize_scenarios(raw: Any) -> Dict[str, Dict[str, str]]:
    if not isinstance(raw, dict):
        return {}
    out: Dict[str, Dict[str, str]] = {}
    for name, spec in raw.items():
        if not isinstance(spec, dict):
            continue
        key = str(name).strip()
        if not key:
            continue
        entry: Dict[str, str] = {}
        tier_val = str(spec.get("tier") or "").strip().lower()
        if tier_val in _LLM_TIER_NAMES:
            entry["tier"] = tier_val
        prov = str(spec.get("provider") or "").strip().lower()
        if prov in _LLM_ROUTING_PROVIDERS:
            entry["provider"] = prov
        model = str(spec.get("model") or "").strip()
        if model:
            entry["model"] = model
        if entry:
            out[key] = entry
    return out


def _normalize_agent_llm_routing_payload(raw: Any) -> Dict[str, Any]:
    base = _default_agent_llm_routing()
    if not raw or not isinstance(raw, dict):
        return base
    out_tiers: Dict[str, List[Dict[str, str]]] = {}
    raw_tiers = raw.get("tiers")
    for tier in _LLM_TIER_NAMES:
        if isinstance(raw_tiers, dict) and tier in raw_tiers:
            steps = _coerce_routing_steps(raw_tiers.get(tier))
            out_tiers[tier] = steps if steps else [dict(x) for x in base["tiers"][tier]]
        else:
            out_tiers[tier] = [dict(x) for x in base["tiers"][tier]]
    if "fallback" in raw:
        fb = _coerce_routing_steps(raw.get("fallback"))
        out_fb = fb if fb else [dict(x) for x in base["fallback"]]
    else:
        out_fb = [dict(x) for x in base["fallback"]]
    strategy = str(raw.get("key_pool_strategy") or base.get("key_pool_strategy") or "fill-first").strip().lower()
    if strategy not in ("round-robin", "fill-first"):
        strategy = "fill-first"
    tier_models = _normalize_tier_models(raw.get("tier_models"))
    scenarios = _normalize_scenarios(raw.get("scenarios"))
    result: Dict[str, Any] = {
        "tiers": out_tiers,
        "fallback": out_fb,
        "key_pool_strategy": strategy,
    }
    if tier_models:
        result["tier_models"] = tier_models
    if scenarios:
        result["scenarios"] = scenarios
    return result


def load_swoop_llm_key_settings() -> Dict[str, Any]:
    now = time.monotonic()
    cached = _SWOOP_LLM_CACHE.get("settings")
    if cached is not None and (now - float(_SWOOP_LLM_CACHE.get("ts") or 0)) < _SWOOP_LLM_CACHE_TTL_SEC:
        return cached

    defaults: Dict[str, Any] = {
        "glm_keys": [],
        "openai_keys": [],
        "openrouter_keys": [],
        "openrouter_qwen_keys": [],
        "groq_keys": [],
        "gemini_keys": [],
        "gemini_api_key": "",
        "openrouter_default_model": "anthropic/claude-3.7-sonnet",
        "glm_default_model": "glm-4.7",
        "openrouter_qwen_model": "google/gemma-2-9b-it:free",
        "lmarena_keys": [],
        "lmarena_base_url": "",
        "lmarena_default_model": "",
        "brave_keys": [],
        "tavily_keys": [],
        "api_key_groups_keys": [],
        "api_key_groups_raw": [],
        "agent_llm_routing": {},
        "api_key_pool_meta": {},
    }
    try:
        conn = pg_connect()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.service_settings WHERE id = 1 LIMIT 1")
            row = cur.fetchone()
        conn.close()
    except Exception as exc:
        logger.warning("load_swoop_llm_key_settings: %s", exc)
        _SWOOP_LLM_CACHE["ts"] = now
        _SWOOP_LLM_CACHE["settings"] = defaults
        return defaults

    if not row:
        _SWOOP_LLM_CACHE["ts"] = now
        _SWOOP_LLM_CACHE["settings"] = defaults
        return defaults

    cfg = dict(defaults)
    for k in (
        "glm_keys",
        "openai_keys",
        "openrouter_keys",
        "openrouter_qwen_keys",
        "groq_keys",
        "gemini_keys",
        "lmarena_keys",
        "brave_keys",
        "tavily_keys",
    ):
        cfg[k] = _normalize_key_list(row.get(k))
    cfg["gemini_api_key"] = (str(row.get("gemini_api_key") or "").strip())
    mod = row.get("openrouter_default_model")
    if mod and str(mod).strip():
        cfg["openrouter_default_model"] = str(mod).strip()
    glm_mod = row.get("glm_default_model")
    if glm_mod and str(glm_mod).strip():
        cfg["glm_default_model"] = str(glm_mod).strip()
    qwen_mod = row.get("openrouter_qwen_model")
    if qwen_mod and str(qwen_mod).strip():
        cfg["openrouter_qwen_model"] = str(qwen_mod).strip()
    lm_base = row.get("lmarena_base_url")
    if lm_base is not None:
        cfg["lmarena_base_url"] = str(lm_base).strip()
    lm_mod = row.get("lmarena_default_model")
    if lm_mod is not None:
        cfg["lmarena_default_model"] = str(lm_mod).strip()
    cfg["api_key_groups_raw"] = row.get("api_key_groups") if isinstance(row.get("api_key_groups"), list) else []
    cfg["api_key_groups_keys"] = _flatten_api_key_groups(cfg["api_key_groups_raw"])
    cfg["agent_llm_routing"] = _normalize_agent_llm_routing_payload(row.get("agent_llm_routing"))
    cfg["api_key_pool_meta"] = _normalize_api_key_pool_meta(row.get("api_key_pool_meta"))
    _hydrate_key_health_state(row.get("key_health"))
    _hydrate_api_key_pool_meta(cfg["api_key_pool_meta"])

    _SWOOP_LLM_CACHE["ts"] = now
    _SWOOP_LLM_CACHE["settings"] = cfg
    return cfg


def has_any_bookmark_llm_keys() -> bool:
    """True если есть env OPENAI_API_KEY или ключи в service_settings (Swoop)."""
    if os.environ.get("OPENAI_API_KEY", "").strip():
        return True
    cfg = load_swoop_llm_key_settings()
    if cfg.get("gemini_api_key"):
        return True
    for k in ("glm_keys", "openai_keys", "openrouter_keys", "openrouter_qwen_keys", "groq_keys", "gemini_keys", "lmarena_keys"):
        if cfg.get(k):
            return True
    if cfg.get("api_key_groups_keys"):
        return True
    return False


def _http_post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 60):
    data = json.dumps(payload).encode("utf-8")
    req = UrlRequest(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            code = int(resp.getcode() or 200)
            try:
                return code, json.loads(raw), raw
            except json.JSONDecodeError:
                return code, None, raw
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        return int(exc.code), parsed, raw
    except Exception as exc:
        logger.warning("HTTP POST failed %s: %s", url[:80], exc)
        return -1, None, str(exc)


def _openai_style_embedding_vector(body: Optional[Dict[str, Any]]) -> Optional[List[float]]:
    if not body or not isinstance(body, dict):
        return None
    emb = body.get("data", [{}])[0].get("embedding")
    if isinstance(emb, list) and emb:
        return [float(x) for x in emb]
    return None


def _embedding_ok_dim(vec: List[float]) -> bool:
    return len(vec) == BOOKMARKS_VECTOR_DIM


def _post_openai_compatible_embeddings(
    api_base: str,
    api_key: str,
    model: str,
    text: str,
    extra_headers: Optional[Dict[str, str]] = None,
) -> Tuple[Optional[List[float]], int, str]:
    """OpenAI-совместимый POST {base}/embeddings."""
    url = api_base.rstrip("/") + "/embeddings"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    payload = {"input": text[:8000], "model": model}
    code, body, raw = _http_post_json(url, headers, payload, timeout=45)
    if code != 200:
        return None, code, raw[:500]
    vec = _openai_style_embedding_vector(body)
    if vec and not _embedding_ok_dim(vec):
        return None, code, f"wrong_dim:{len(vec)}"
    return vec, code, raw[:200]


def _post_gemini_embedding(api_key: str, text: str) -> Tuple[Optional[List[float]], int, str]:
    model_id = os.environ.get("BOOKMARKS_GEMINI_EMBEDDING_MODEL", "text-embedding-004")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:embedContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {"model": f"models/{model_id}", "content": {"parts": [{"text": text[:8000]}]}}
    code, body, raw = _http_post_json(url, headers, payload, timeout=45)
    if code != 200:
        return None, code, raw[:500]
    emb = None
    if isinstance(body, dict):
        emb = body.get("embedding", {}).get("values")
    if isinstance(emb, list) and emb:
        vec = [float(x) for x in emb]
        if not _embedding_ok_dim(vec):
            return None, code, f"wrong_dim:{len(vec)}"
        return vec, code, "ok"
    return None, code, raw[:300]


def _sanitize_llm_error_text(raw: str, code: int = 0) -> str:
    text = str(raw or "")[:500]
    text = re.sub(r"sk-or-[a-zA-Z0-9_-]+", "sk-or-***", text, flags=re.I)
    text = re.sub(r"sk-[a-zA-Z0-9._-]{12,}", "sk-***", text, flags=re.I)
    text = re.sub(r"https?://\S+", "[url]", text, flags=re.I)
    return text.replace("\n", " ").strip() or f"http_{code}"


def _parse_afford_max_tokens(msg: str) -> Optional[int]:
    m = re.search(r"can only afford\s+(\d+)", msg or "", re.I)
    if not m:
        return None
    try:
        n = int(m.group(1))
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    return max(1, n - 64)


def _assistant_visible_text(msg: Dict[str, Any]) -> str:
    if not isinstance(msg, dict):
        return ""
    for key in ("content", "reasoning", "reasoning_content"):
        val = msg.get(key)
        if val is not None and str(val).strip():
            return str(val).strip()
    return ""


def _messages_have_tool_results(messages: List[Dict[str, Any]]) -> bool:
    return any(isinstance(m, dict) and m.get("role") == "tool" for m in messages)


def _coerce_openai_message_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text" and block.get("text"):
                    parts.append(str(block["text"]))
                elif block.get("text"):
                    parts.append(str(block["text"]))
            elif isinstance(block, str):
                parts.append(block)
        if parts:
            return "\n".join(parts)
        return json.dumps(content, ensure_ascii=False)
    if isinstance(content, dict):
        return json.dumps(content, ensure_ascii=False)
    return str(content)


def _normalize_hermes_proxy_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """OpenAI-совместимые строки content (GLM/OpenRouter иначе отдают 400 на tool messages)."""
    out: List[Dict[str, Any]] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        msg = dict(m)
        role = str(msg.get("role") or "").strip().lower()
        if "content" in msg:
            msg["content"] = _coerce_openai_message_content(msg.get("content"))
        elif role in ("user", "assistant", "tool", "system"):
            msg["content"] = ""
        if role == "assistant" and msg.get("tool_calls") and not str(msg.get("content") or "").strip():
            msg["content"] = ""
        out.append(msg)
    return out


def _synthesize_post_tool_ack(messages: List[Dict[str, Any]]) -> str:
    for m in reversed(messages):
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        raw = str(m.get("content") or "").strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                if data.get("message"):
                    return str(data["message"])
                items = data.get("items")
                if data.get("ok") and isinstance(items, list) and items:
                    lines: List[str] = []
                    q = str(data.get("query") or "").strip()
                    if q:
                        lines.append(f"Результаты поиска по запросу «{q}»:")
                    for i, item in enumerate(items[:15], start=1):
                        if not isinstance(item, dict):
                            continue
                        title = str(item.get("title") or item.get("name") or "Без названия").strip()
                        url = str(item.get("url") or item.get("link") or "").strip()
                        snippet = str(item.get("snippet") or item.get("summary") or "").strip()
                        if url:
                            line = f"{i}. [{title}]({url})"
                        else:
                            line = f"{i}. {title}"
                        if snippet:
                            line += f" — {snippet[:200]}"
                        lines.append(line)
                    if lines:
                        return "\n".join(lines)
                if data.get("ok"):
                    note = data.get("notePath") or data.get("note_path")
                    kid = data.get("knowledgeItemId")
                    parts = ["Запись в базу знаний выполнена."]
                    if note:
                        parts.append(f"Путь: {note}")
                    if kid:
                        parts.append(f"ID: {kid}")
                    return " ".join(parts)
        except json.JSONDecodeError:
            pass
        if len(raw) <= 500:
            return raw
        return "Инструмент выполнен."
    return "Готово."


def _post_openai_compatible_chat_completions_raw(
    api_base: str,
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = 0.35,
    response_format: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Any] = None,
) -> Tuple[Optional[Dict[str, Any]], int, str]:
    """Полный assistant message (content, tool_calls, reasoning, finish_reason)."""
    url = api_base.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    tokens_try = int(max_tokens if max_tokens is not None else (os.environ.get("BOOKMARKS_CHAT_MAX_TOKENS") or "1200"))
    afford_retried = False
    for _ in range(2):
        payload: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": tokens_try,
        }
        if response_format:
            payload["response_format"] = response_format
        if tools:
            payload["tools"] = tools
        if tool_choice is not None:
            payload["tool_choice"] = tool_choice
        code, body, raw = _http_post_json(url, headers, payload, timeout=120)
        if code == 200 and isinstance(body, dict):
            break
        if code == 402 and not afford_retried:
            afford = _parse_afford_max_tokens(raw)
            if afford is not None:
                tokens_try = afford
                afford_retried = True
                continue
        return None, code, _sanitize_llm_error_text(raw, code)
    if code != 200 or not isinstance(body, dict):
        return None, code, _sanitize_llm_error_text(raw, code)
    choice = (body.get("choices") or [{}])[0] if isinstance(body.get("choices"), list) else {}
    msg = choice.get("message") if isinstance(choice, dict) else {}
    if not isinstance(msg, dict):
        msg = {}
    visible = _assistant_visible_text(msg)
    tool_calls = msg.get("tool_calls")
    if not visible and not tool_calls:
        return None, code, "empty_content"
    out: Dict[str, Any] = dict(msg)
    out["finish_reason"] = choice.get("finish_reason") if isinstance(choice, dict) else None
    if not visible:
        out["content"] = ""
    return out, code, "ok"


def _post_openai_compatible_chat_completions(
    api_base: str,
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    temperature: float = 0.35,
    response_format: Optional[Dict[str, Any]] = None,
    extra_headers: Optional[Dict[str, str]] = None,
    max_tokens: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Any] = None,
) -> Tuple[Optional[str], int, str]:
    msg, code, status = _post_openai_compatible_chat_completions_raw(
        api_base,
        api_key,
        model,
        messages,
        temperature=temperature,
        response_format=response_format,
        extra_headers=extra_headers,
        max_tokens=max_tokens,
        tools=tools,
        tool_choice=tool_choice,
    )
    if msg is None:
        return None, code, status
    visible = _assistant_visible_text(msg)
    if visible:
        return visible, code, "ok"
    if msg.get("tool_calls"):
        return " ", code, "ok"
    return None, code, "empty_content"


def _post_openai_compatible_chat_json(
    api_base: str,
    api_key: str,
    model: str,
    system_prompt: str,
    user_prompt: str,
    extra_headers: Optional[Dict[str, str]] = None,
    max_tokens: Optional[int] = None,
) -> Tuple[Optional[Dict[str, Any]], int, str]:
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]
    content, code, msg = _post_openai_compatible_chat_completions(
        api_base,
        api_key,
        model,
        messages,
        temperature=0.35,
        response_format={"type": "json_object"},
        extra_headers=extra_headers,
        max_tokens=max_tokens,
    )
    if content is None:
        return None, code, msg
    try:
        return json.loads(content), code, "ok"
    except json.JSONDecodeError:
        return None, code, "bad_json_content"


def _gemini_generate_json(
    system_prompt: str,
    user_prompt: str,
    api_key: str,
    model_override: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], int, str]:
    model = (model_override or "").strip() or os.environ.get("BOOKMARKS_GEMINI_CHAT_MODEL", "gemini-2.0-flash")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": 0.35,
            "maxOutputTokens": 2500,
            "responseMimeType": "application/json",
        },
    }
    code, body, raw = _http_post_json(url, headers, payload, timeout=120)
    if code != 200 or not isinstance(body, dict):
        return None, code, raw[:400]
    parts = (
        (((body.get("candidates") or [{}])[0].get("content") or {}).get("parts")) or [{}]
    )
    text = (parts[0].get("text") or "").strip()
    if not text:
        return None, code, "empty_text"
    try:
        return json.loads(text), code, "ok"
    except json.JSONDecodeError:
        return None, code, "bad_json"


def get_openai_embedding(text: str) -> Optional[List[float]]:
    """
    Эмбеддинги для pgvector(1536): ключи из Swoop service_settings (glm → openai → openrouter → groq → gemini → группы → env).
    Провайдеры с другой размерностью вектора пропускаются (пробуем следующий ключ).
    """
    settings = load_swoop_llm_key_settings()
    snippet = text[:8000]

    glm_base = os.environ.get("BOOKMARKS_GLM_BASE", "https://open.bigmodel.cn/api/paas/v4").strip()
    glm_embed_model = os.environ.get("BOOKMARKS_GLM_EMBEDDING_MODEL", "embedding-3").strip()
    openai_embed_model = os.environ.get("BOOKMARKS_EMBEDDING_MODEL", "text-embedding-3-small").strip()
    or_embed_model = os.environ.get("BOOKMARKS_OPENROUTER_EMBEDDING_MODEL", "openai/text-embedding-3-small").strip()
    groq_embed_model = os.environ.get("BOOKMARKS_GROQ_EMBEDDING_MODEL", "text-embedding-3-small").strip()
    groq_base = os.environ.get("BOOKMARKS_GROQ_BASE", "https://api.groq.com/openai/v1").strip()

    openai_official = os.environ.get("BOOKMARKS_OPENAI_API_BASE", "https://api.openai.com/v1").strip()
    openrouter_base = os.environ.get("BOOKMARKS_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").strip()
    or_headers = {
        "HTTP-Referer": os.environ.get("BOOKMARKS_OPENROUTER_REFERER", "https://swoop.autoro.tech"),
        "X-Title": os.environ.get("BOOKMARKS_OPENROUTER_TITLE", "Autoro Bookmarks Bro"),
    }

    def try_openai_style(base: str, key: str, model: str, label: str) -> Optional[List[float]]:
        vec, code, msg = _post_openai_compatible_embeddings(base, key, model, snippet)
        if vec:
            logger.info("Embedding OK via %s", label)
            _key_health_mark_success(label, key)
            return vec
        _key_health_mark_failure(label, key, code, msg)
        logger.warning("Embedding fail %s (%s): %s", label, code, msg)
        return None

    for key in _iter_keys_for_llm("glm_keys", settings["glm_keys"]):
        v = try_openai_style(glm_base, key, glm_embed_model, "glm_keys")
        if v:
            return v

    for key in _iter_keys_with_health("openai_keys", settings["openai_keys"]):
        v = try_openai_style(openai_official, key, openai_embed_model, "openai_keys")
        if v:
            return v

    for key in _iter_keys_with_health("openrouter_keys", settings["openrouter_keys"]):
        vec, code, msg = _post_openai_compatible_embeddings(
            openrouter_base, key, or_embed_model, snippet, extra_headers=or_headers
        )
        if vec:
            _key_health_mark_success("openrouter_keys", key)
            logger.info("Embedding OK via openrouter")
            return vec
        _key_health_mark_failure("openrouter_keys", key, code, msg)
        logger.warning("Embedding fail openrouter (%s): %s", code, msg)

    for key in _iter_keys_with_health("groq_keys", settings["groq_keys"]):
        v = try_openai_style(groq_base, key, groq_embed_model, "groq_keys")
        if v:
            return v

    gemini_embed_pool = _gemini_chat_key_pool(settings)
    gemini_eps = len(gemini_embed_pool)
    for key in _iter_keys_for_llm("gemini_pool", gemini_embed_pool):
        vec, code, msg = _post_gemini_embedding(key, snippet)
        if vec:
            _key_health_mark_success("gemini_pool", key)
            logger.info("Embedding OK via gemini")
            return vec
        _key_health_mark_failure("gemini_pool", key, code, msg, pool_size=gemini_eps)
        logger.warning("Gemini embedding fail (%s): %s", code, msg)

    for key in _iter_keys_with_health("api_key_groups_keys", settings["api_key_groups_keys"]):
        v = try_openai_style(openrouter_base, key, or_embed_model, "api_key_groups_keys")
        if v:
            return v
        v = try_openai_style(openai_official, key, openai_embed_model, "api_key_groups_keys")
        if v:
            return v

    env_key = os.environ.get("OPENAI_API_KEY", "").strip()
    if env_key:
        v = try_openai_style(openai_official, env_key, openai_embed_model, "env OPENAI_API_KEY")
        if v:
            return v

    return None


def _classify_llm_task_tier(system_prompt: str, user_prompt: str) -> str:
    """
    Грубая классификация по тексту промпта (без дополнительного LLM-вызова).
    Используется для порядка провайдеров: один клиентский X-API-Key (Swoop), маршрутизация по ключам из настроек.
    """
    blob = f"{system_prompt}\n{user_prompt}".lower()
    code_signals = (
        "```",
        "stack trace",
        "traceback",
        "exception:",
        "pytest",
        "refactor",
        "compile error",
        "typescript",
        "javascript",
        "python ",
        "rust ",
        "dockerfile",
        "kubernetes",
        "sql ",
        "postgres",
        "git commit",
        "pull request",
        "npm ",
        "node_modules",
    )
    reasoning_signals = (
        "prove ",
        "proof ",
        "step-by-step",
        "step by step",
        "compare ",
        "trade-off",
        "tradeoff",
        "critique",
        "deep analysis",
        "обоснуй",
        "аргументируй",
    )
    fast_signals = (
        "max 400",
        "max 200",
        "json object",
        "single json",
        "summary",
        "кратко",
        "теги",
        "category",
        "tags",
        "1–6 short",
        "1-6 short",
    )
    if any(s in blob for s in code_signals):
        return "code"
    if any(s in blob for s in reasoning_signals):
        return "reasoning"
    if any(s in blob for s in fast_signals):
        return "fast"
    return "general"


@dataclass
class ChatJsonObjectResult:
    data: Optional[Dict[str, Any]] = None
    tier: str = ""
    provider_used: str = ""
    model_resolved: str = ""


def _merge_unique_key_lists(*lists: List[List[str]]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for lst in lists:
        for k in lst or []:
            s = str(k or "").strip()
            if s and s not in seen:
                seen.add(s)
                out.append(s)
    return out


def _gemini_chat_key_pool(settings: Dict[str, Any], group_gemini_keys: Optional[List[str]] = None) -> List[str]:
    """gemini_keys + api_key_groups(gemini) + legacy gemini_api_key из Swoop."""
    pool = _merge_unique_key_lists(list(settings.get("gemini_keys") or []), list(group_gemini_keys or []))
    legacy = str(settings.get("gemini_api_key") or "").strip()
    if legacy:
        pool = _merge_unique_key_lists(pool, [legacy])
    return pool


def _make_model_resolver(
    settings: Dict[str, Any],
    tier: str,
    catalogs: Dict[str, List[str]],
):
    def resolve(provider: str, step_model: str) -> str:
        return resolve_model_for_provider(provider, tier, step_model, settings, catalogs=catalogs)

    return resolve


def openai_chat_json_object(
    system_prompt: str,
    user_prompt: str,
    tier_override: Optional[str] = None,
    route_provider_override: Optional[str] = None,
    route_model_override: Optional[str] = None,
    swoop_user_email: Optional[str] = None,
    max_tokens_override: Optional[int] = None,
    scenario: Optional[str] = None,
) -> ChatJsonObjectResult:
    """
    JSON-ответ чата: цепочка provider+model из agent_llm_routing (Swoop) + ключи service_settings.
    Классификация tier: заголовок X-LLM-Tier (см. вызывающий код) или эвристика по тексту промпта.
    """
    settings = load_swoop_llm_key_settings()
    routing = settings.get("agent_llm_routing")
    if not isinstance(routing, dict):
        routing = _default_agent_llm_routing()

    scenario_spec: Optional[Dict[str, str]] = None
    scenario_raw = (scenario or "").strip()
    if scenario_raw:
        scenarios_map = routing.get("scenarios") if isinstance(routing.get("scenarios"), dict) else {}
        raw_spec = scenarios_map.get(scenario_raw) if isinstance(scenarios_map, dict) else None
        if isinstance(raw_spec, dict):
            scenario_spec = {str(k): str(v) for k, v in raw_spec.items() if v is not None}

    tier_raw = (tier_override or "").strip().lower()
    if tier_raw in _LLM_TIER_NAMES:
        tier = tier_raw
    elif scenario_spec and str(scenario_spec.get("tier") or "").strip().lower() in _LLM_TIER_NAMES:
        tier = str(scenario_spec["tier"]).strip().lower()
    else:
        tier = _classify_llm_task_tier(system_prompt, user_prompt)

    tiers_map = routing.get("tiers") if isinstance(routing.get("tiers"), dict) else {}
    tier_steps = _coerce_routing_steps(tiers_map.get(tier)) if isinstance(tiers_map, dict) else []
    if not tier_steps:
        tier_steps = [dict(x) for x in _default_agent_llm_routing()["tiers"][tier]]

    if "fallback" in routing:
        fb_steps = _coerce_routing_steps(routing.get("fallback"))
        if not fb_steps:
            fb_steps = [dict(x) for x in _default_agent_llm_routing()["fallback"]]
    else:
        fb_steps = [dict(x) for x in _default_agent_llm_routing()["fallback"]]

    chain = tier_steps + fb_steps
    forced_provider = str(route_provider_override or "").strip().lower()
    forced_model = str(route_model_override or "").strip()
    if not forced_provider and scenario_spec:
        scenario_prov = str(scenario_spec.get("provider") or "").strip().lower()
        if scenario_prov in _LLM_ROUTING_PROVIDERS:
            forced_provider = scenario_prov
            forced_model = str(scenario_spec.get("model") or "").strip()
    if forced_provider in _LLM_ROUTING_PROVIDERS:
        forced_step = {"provider": forced_provider, "model": forced_model}
        chain = [forced_step] + [
            s for s in chain if not (str(s.get("provider") or "").strip().lower() == forced_provider and str(s.get("model") or "").strip() == forced_model)
        ]
    logger.info("LLM JSON routing tier=%s chain_len=%s", tier, len(chain))

    glm_base = os.environ.get("BOOKMARKS_GLM_BASE", "https://open.bigmodel.cn/api/paas/v4").strip()
    openai_official = os.environ.get("BOOKMARKS_OPENAI_API_BASE", "https://api.openai.com/v1").strip()
    openrouter_base = os.environ.get("BOOKMARKS_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").strip()
    groq_base = os.environ.get("BOOKMARKS_GROQ_BASE", "https://api.groq.com/openai/v1").strip()
    lmarena_base = _lmarena_api_base(settings)
    or_headers = {
        "HTTP-Referer": os.environ.get("BOOKMARKS_OPENROUTER_REFERER", "https://swoop.autoro.tech"),
        "X-Title": os.environ.get("BOOKMARKS_OPENROUTER_TITLE", "Autoro Bookmarks Bro"),
    }

    def ok_tuple(
        t: Tuple[Optional[Dict[str, Any]], int, str],
        provider_name: str,
        key: str,
        pool_size: int = 1,
    ) -> Optional[Dict[str, Any]]:
        data, code, msg = t
        if data is not None:
            _key_health_mark_success(provider_name, key)
            return data
        _key_health_mark_failure(provider_name, key, code, msg, pool_size=pool_size)
        logger.warning("chat JSON fail code=%s msg=%s", code, msg)
        return None

    catalogs = get_cached_provider_catalogs(settings)
    resolve_model = _make_model_resolver(settings, tier, catalogs)

    user_email_norm = str(swoop_user_email or "").strip().lower()
    desired_provider_for_groups = forced_provider if forced_provider and forced_provider != "api_key_groups" else ""
    desired_model_for_groups = forced_model or ""
    grouped_keys_for_user = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"),
        desired_provider=desired_provider_for_groups,
        desired_tier=tier,
        desired_model=desired_model_for_groups,
        swoop_user_email=user_email_norm,
    )
    group_or_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"),
        "openrouter",
        tier,
        forced_model or "",
        user_email_norm,
    )
    group_oa_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "openai", tier, "", user_email_norm
    )
    group_groq_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "groq", tier, "", user_email_norm
    )
    group_glm_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "glm", tier, "", user_email_norm
    )
    group_gemini_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "gemini", tier, "", user_email_norm
    )
    group_lmarena_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "lmarena", tier, "", user_email_norm
    )
    openrouter_pool = _merge_unique_key_lists(list(settings.get("openrouter_keys") or []), group_or_keys)
    openai_pool = _merge_unique_key_lists(list(settings.get("openai_keys") or []), group_oa_keys)
    groq_pool = _merge_unique_key_lists(list(settings.get("groq_keys") or []), group_groq_keys)
    glm_pool = _merge_unique_key_lists(list(settings.get("glm_keys") or []), group_glm_keys)
    gemini_pool = _gemini_chat_key_pool(settings, group_gemini_keys)
    lmarena_pool = _merge_unique_key_lists(list(settings.get("lmarena_keys") or []), group_lmarena_keys)
    chat_max_tokens = int(
        max_tokens_override if max_tokens_override is not None else (os.environ.get("BOOKMARKS_CHAT_MAX_TOKENS") or "1200")
    )

    for step in chain:
        prov = str(step.get("provider") or "").strip().lower()
        mraw = str(step.get("model") or "").strip()

        if prov == "openrouter":
            model_use = resolve_model("openrouter",mraw)
            or_ps = len(openrouter_pool)
            for key in _iter_keys_for_llm("openrouter_pool", openrouter_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openrouter_base,
                        key,
                        model_use,
                        system_prompt,
                        user_prompt,
                        extra_headers=or_headers,
                        max_tokens=chat_max_tokens,
                    ),
                    "openrouter_pool",
                    key,
                    pool_size=or_ps,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="openrouter", model_resolved=model_use
                    )
            qwen_keys = list(settings.get("openrouter_qwen_keys") or [])
            qwen_model = str(settings.get("openrouter_qwen_model") or "google/gemma-2-9b-it:free").strip()
            for key in _iter_keys_with_health("openrouter_qwen_keys", qwen_keys):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openrouter_base,
                        key,
                        qwen_model,
                        system_prompt,
                        user_prompt,
                        extra_headers=or_headers,
                        max_tokens=chat_max_tokens,
                    ),
                    "openrouter_qwen_keys",
                    key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="openrouter-qwen", model_resolved=qwen_model
                    )

        elif prov == "groq":
            model_use = resolve_model("groq",mraw)
            groq_ps = len(groq_pool)
            for key in _iter_keys_for_llm("groq_pool", groq_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        groq_base, key, model_use, system_prompt, user_prompt, max_tokens=chat_max_tokens
                    ),
                    "groq_pool",
                    key,
                    pool_size=groq_ps,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="groq", model_resolved=model_use
                    )

        elif prov == "glm":
            model_use = resolve_model("glm",mraw)
            glm_ps = len(glm_pool)
            for key in _iter_keys_for_llm("glm_pool", glm_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        glm_base, key, model_use, system_prompt, user_prompt, max_tokens=chat_max_tokens
                    ),
                    "glm_pool",
                    key,
                    pool_size=glm_ps,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="glm", model_resolved=model_use
                    )

        elif prov == "openai":
            model_use = resolve_model("openai",mraw)
            for key in _iter_keys_with_health("openai_pool", openai_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openai_official, key, model_use, system_prompt, user_prompt, max_tokens=chat_max_tokens
                    ),
                    "openai_pool",
                    key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="openai", model_resolved=model_use
                    )

        elif prov == "gemini":
            gmodel = resolve_model("gemini",mraw)
            gemini_openai_base = "https://generativelanguage.googleapis.com/v1beta/openai"
            gemini_ps = len(gemini_pool)
            for key in _iter_keys_for_llm("gemini_pool", gemini_pool):
                out = ok_tuple(
                    _gemini_generate_json(system_prompt, user_prompt, key, model_override=gmodel),
                    "gemini_pool",
                    key,
                    pool_size=gemini_ps,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="gemini", model_resolved=gmodel
                    )
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        gemini_openai_base,
                        key,
                        gmodel,
                        system_prompt,
                        user_prompt,
                        max_tokens=chat_max_tokens,
                    ),
                    "gemini_pool",
                    key,
                    pool_size=gemini_ps,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="gemini-openai-compat", model_resolved=gmodel
                    )

        elif prov == "lmarena":
            model_use = resolve_model("lmarena", mraw)
            for key in _iter_keys_with_health("lmarena_keys", lmarena_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        lmarena_base, key, model_use, system_prompt, user_prompt, max_tokens=chat_max_tokens
                    ),
                    "lmarena_keys",
                    key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="lmarena", model_resolved=model_use
                    )

        elif prov == "api_key_groups":
            # api_key_groups: берем ключи, отфильтрованные по назначению (provider/tier/model/email).
            # Если desired_provider не задан — пробуем openrouter, затем openai (как раньше).
            group_keys = grouped_keys_for_user if grouped_keys_for_user else list(settings["api_key_groups_keys"])

            desired_provider = forced_provider if forced_provider and forced_provider != "api_key_groups" else ""
            if desired_provider == "openrouter":
                or_m = resolve_model("openrouter",forced_model or mraw)
                for key in _iter_keys_with_health("api_key_groups_keys", group_keys):
                    out = ok_tuple(
                        _post_openai_compatible_chat_json(
                            openrouter_base, key, or_m, system_prompt, user_prompt, extra_headers=or_headers
                        ),
                        "api_key_groups_keys",
                        key,
                    )
                    if out:
                        return ChatJsonObjectResult(
                            data=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openrouter:{or_m}"
                        )
                continue

            if desired_provider == "openai":
                oa_m = resolve_model("openai",forced_model or mraw)
                for key in _iter_keys_with_health("api_key_groups_keys", group_keys):
                    out = ok_tuple(
                        _post_openai_compatible_chat_json(
                            openai_official, key, oa_m, system_prompt, user_prompt
                        ),
                        "api_key_groups_keys",
                        key,
                    )
                    if out:
                        return ChatJsonObjectResult(
                            data=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openai:{oa_m}"
                        )
                continue

            or_m = resolve_model("openrouter",mraw)
            oa_m = resolve_model("openai","")
            for key in _iter_keys_with_health("api_key_groups_keys", group_keys):
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openrouter_base, key, or_m, system_prompt, user_prompt, extra_headers=or_headers
                    ),
                    "api_key_groups_keys",
                    key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openrouter:{or_m}"
                    )
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openai_official, key, oa_m, system_prompt, user_prompt
                    ),
                    "api_key_groups_keys",
                    key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openai:{oa_m}"
                    )

        elif prov == "env_openai":
            model_use = resolve_model("openai",mraw)
            env_key = os.environ.get("OPENAI_API_KEY", "").strip()
            if env_key:
                out = ok_tuple(
                    _post_openai_compatible_chat_json(
                        openai_official, env_key, model_use, system_prompt, user_prompt
                    ),
                    "env_openai_key",
                    env_key,
                )
                if out:
                    return ChatJsonObjectResult(
                        data=out, tier=tier, provider_used="env_openai", model_resolved=model_use
                    )

        else:
            logger.warning("LLM routing: unknown provider step %s", prov)

    return ChatJsonObjectResult(tier=tier)


class ChatCompletionsResult(BaseModel):
    content: Optional[str] = None
    tier: str = "general"
    provider_used: Optional[str] = None
    model_resolved: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    finish_reason: Optional[str] = None


def _hermes_proxy_exhausted_result(
    messages: List[Dict[str, Any]], tier: str
) -> ChatCompletionsResult:
    if _messages_have_tool_results(messages):
        synth = _synthesize_post_tool_ack(messages)
        if synth.strip():
            return ChatCompletionsResult(
                content=synth,
                tier=tier,
                provider_used="synthesized",
                model_resolved="post-tool-fallback",
                finish_reason="stop",
            )
    return ChatCompletionsResult(tier=tier)


def _openai_chat_completion_sse_line(
    resp_id: str,
    created: int,
    model: str,
    delta: Dict[str, Any],
    finish_reason: Optional[str] = None,
) -> str:
    chunk = {
        "id": resp_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "logprobs": None,
                "finish_reason": finish_reason,
            }
        ],
    }
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"


def _iter_openai_chat_completion_sse(
    resp_id: str,
    created: int,
    model: str,
    content: str,
    chunk_chars: int = 48,
):
    """Эмуляция OpenAI SSE для клиентов (Hermes), когда upstream отвечает целиком."""
    yield _openai_chat_completion_sse_line(
        resp_id, created, model, {"role": "assistant", "content": ""}
    )
    text = content or ""
    step = max(8, int(chunk_chars))
    for i in range(0, len(text), step):
        yield _openai_chat_completion_sse_line(
            resp_id, created, model, {"content": text[i : i + step]}
        )
    yield _openai_chat_completion_sse_line(resp_id, created, model, {}, "stop")
    yield "data: [DONE]\n\n"


def openai_chat_completions_generic(
    messages: List[Dict[str, Any]],
    temperature: float = 0.35,
    response_format: Optional[Dict[str, Any]] = None,
    tier_override: Optional[str] = None,
    route_provider_override: Optional[str] = None,
    route_model_override: Optional[str] = None,
    swoop_user_email: Optional[str] = None,
    max_tokens_override: Optional[int] = None,
    tools: Optional[List[Dict[str, Any]]] = None,
    tool_choice: Optional[Any] = None,
    hermes_proxy: bool = False,
) -> ChatCompletionsResult:
    """
    Универсальный обход цепочек провайдеров Swoop с ротацией ключей для обычного текстового (или JSON) ответа.
    """
    settings = load_swoop_llm_key_settings()
    routing = settings.get("agent_llm_routing")
    if not isinstance(routing, dict):
        routing = _default_agent_llm_routing()

    tier_raw = (tier_override or "").strip().lower()
    if tier_raw in _LLM_TIER_NAMES:
        tier = tier_raw
    else:
        last_text = ""
        if messages:
            last_text = str(messages[-1].get("content") or "")
        tier = _classify_llm_task_tier("", last_text)

    tiers_map = routing.get("tiers") if isinstance(routing.get("tiers"), dict) else {}
    tier_steps = _coerce_routing_steps(tiers_map.get(tier)) if isinstance(tiers_map, dict) else []
    if not tier_steps:
        tier_steps = [dict(x) for x in _default_agent_llm_routing()["tiers"][tier]]

    if "fallback" in routing:
        fb_steps = _coerce_routing_steps(routing.get("fallback"))
        if not fb_steps:
            fb_steps = [dict(x) for x in _default_agent_llm_routing()["fallback"]]
    else:
        fb_steps = [dict(x) for x in _default_agent_llm_routing()["fallback"]]

    chain = tier_steps + fb_steps
    forced_provider = str(route_provider_override or "").strip().lower()
    forced_model = str(route_model_override or "").strip()
    if forced_provider in _LLM_ROUTING_PROVIDERS:
        forced_step = {"provider": forced_provider, "model": forced_model}
        chain = [forced_step] + [
            s for s in chain if not (str(s.get("provider") or "").strip().lower() == forced_provider and str(s.get("model") or "").strip() == forced_model)
        ]
    logger.info("LLM Generic routing tier=%s chain_len=%s", tier, len(chain))

    proxy_messages = messages
    proxy_tools = tools
    proxy_tool_choice = tool_choice
    if hermes_proxy:
        proxy_messages = _normalize_hermes_proxy_messages(messages)
        if _messages_have_tool_results(proxy_messages):
            proxy_tools = None
            proxy_tool_choice = None

    glm_base = os.environ.get("BOOKMARKS_GLM_BASE", "https://open.bigmodel.cn/api/paas/v4").strip()
    openai_official = os.environ.get("BOOKMARKS_OPENAI_API_BASE", "https://api.openai.com/v1").strip()
    openrouter_base = os.environ.get("BOOKMARKS_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").strip()
    groq_base = os.environ.get("BOOKMARKS_GROQ_BASE", "https://api.groq.com/openai/v1").strip()
    lmarena_base = _lmarena_api_base(settings)
    or_headers = {
        "HTTP-Referer": os.environ.get("BOOKMARKS_OPENROUTER_REFERER", "https://swoop.autoro.tech"),
        "X-Title": os.environ.get("BOOKMARKS_OPENROUTER_TITLE", "Autoro Bookmarks Bro"),
    }
    chat_max_tokens = int(
        max_tokens_override if max_tokens_override is not None else (os.environ.get("BOOKMARKS_CHAT_MAX_TOKENS") or "1200")
    )

    def ok_tuple(
        t: Tuple[Optional[str], int, str],
        provider_name: str,
        key: str,
        pool_size: int = 1,
    ) -> Optional[str]:
        data, code, msg = t
        if data is not None:
            _key_health_mark_success(provider_name, key)
            return data
        _key_health_mark_failure(provider_name, key, code, msg, pool_size=pool_size)
        logger.warning("chat generic fail code=%s msg=%s", code, msg)
        return None

    def ok_hermes(
        t: Tuple[Optional[Dict[str, Any]], int, str],
        provider_name: str,
        key: str,
        provider_used: str,
        model_resolved: str,
        pool_size: int = 1,
    ) -> Optional[ChatCompletionsResult]:
        msg, code, status = t
        if msg is None:
            _key_health_mark_failure(provider_name, key, code, status, pool_size=pool_size)
            logger.warning("chat hermes fail code=%s msg=%s", code, status)
            return None
        _key_health_mark_success(provider_name, key)
        visible = _assistant_visible_text(msg)
        tool_calls = msg.get("tool_calls") if isinstance(msg.get("tool_calls"), list) else None
        if not visible.strip() and _messages_have_tool_results(proxy_messages):
            visible = _synthesize_post_tool_ack(proxy_messages)
            if visible.strip():
                tool_calls = None
        elif not visible and tool_calls:
            visible = " "
        return ChatCompletionsResult(
            content=visible or None,
            tier=tier,
            provider_used=provider_used,
            model_resolved=model_resolved,
            tool_calls=tool_calls,
            finish_reason=str(msg.get("finish_reason") or "") or None,
        )

    def _provider_chat_call(
        api_base: str,
        key: str,
        model_use: str,
        extra_headers: Optional[Dict[str, str]] = None,
    ):
        if hermes_proxy:
            return _post_openai_compatible_chat_completions_raw(
                api_base,
                key,
                model_use,
                proxy_messages,
                temperature=temperature,
                response_format=response_format,
                extra_headers=extra_headers,
                max_tokens=chat_max_tokens,
                tools=proxy_tools,
                tool_choice=proxy_tool_choice,
            )
        return _post_openai_compatible_chat_completions(
            api_base,
            key,
            model_use,
            proxy_messages,
            temperature=temperature,
            response_format=response_format,
            extra_headers=extra_headers,
            max_tokens=chat_max_tokens,
            tools=proxy_tools,
            tool_choice=proxy_tool_choice,
        )

    def _finish_provider_attempt(
        t,
        provider_name: str,
        key: str,
        provider_used: str,
        model_resolved: str,
        pool_size: int = 1,
    ) -> Optional[ChatCompletionsResult]:
        if hermes_proxy:
            return ok_hermes(t, provider_name, key, provider_used, model_resolved, pool_size=pool_size)
        out = ok_tuple(t, provider_name, key, pool_size=pool_size)
        if out is not None:
            return ChatCompletionsResult(
                content=out, tier=tier, provider_used=provider_used, model_resolved=model_resolved
            )
        return None

    catalogs = get_cached_provider_catalogs(settings)
    resolve_model = _make_model_resolver(settings, tier, catalogs)

    user_email_norm = str(swoop_user_email or "").strip().lower()
    desired_provider_for_groups = forced_provider if forced_provider and forced_provider != "api_key_groups" else ""
    desired_model_for_groups = forced_model or ""

    group_or_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "openrouter", tier, forced_model or "", user_email_norm
    )
    group_oa_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "openai", tier, "", user_email_norm
    )
    group_groq_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "groq", tier, "", user_email_norm
    )
    group_glm_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "glm", tier, "", user_email_norm
    )
    group_gemini_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "gemini", tier, "", user_email_norm
    )
    group_lmarena_keys = _select_api_key_group_keys(
        settings.get("api_key_groups_raw"), "lmarena", tier, "", user_email_norm
    )
    openrouter_pool = _merge_unique_key_lists(list(settings.get("openrouter_keys") or []), group_or_keys)
    openai_pool = _merge_unique_key_lists(list(settings.get("openai_keys") or []), group_oa_keys)
    groq_pool = _merge_unique_key_lists(list(settings.get("groq_keys") or []), group_groq_keys)
    glm_pool = _merge_unique_key_lists(list(settings.get("glm_keys") or []), group_glm_keys)
    gemini_pool = _gemini_chat_key_pool(settings, group_gemini_keys)
    lmarena_pool = _merge_unique_key_lists(list(settings.get("lmarena_keys") or []), group_lmarena_keys)

    for step in chain:
        prov = str(step.get("provider") or "").strip().lower()
        mraw = str(step.get("model") or "").strip()

        if prov == "openrouter":
            model_use = resolve_model("openrouter",mraw)
            or_ps = len(openrouter_pool)
            for key in _iter_keys_for_llm("openrouter_pool", openrouter_pool):
                got = _finish_provider_attempt(
                    _provider_chat_call(openrouter_base, key, model_use, or_headers),
                    "openrouter_pool",
                    key,
                    "openrouter",
                    model_use,
                    pool_size=or_ps,
                )
                if got is not None:
                    return got
            qwen_keys = list(settings.get("openrouter_qwen_keys") or [])
            qwen_model = str(settings.get("openrouter_qwen_model") or "google/gemma-2-9b-it:free").strip()
            for key in _iter_keys_with_health("openrouter_qwen_keys", qwen_keys):
                out = ok_tuple(
                    _post_openai_compatible_chat_completions(
                        openrouter_base,
                        key,
                        qwen_model,
                        proxy_messages,
                        temperature=temperature,
                        response_format=response_format,
                        extra_headers=or_headers,
                        max_tokens=chat_max_tokens,
                    ),
                    "openrouter_qwen_keys",
                    key,
                )
                if out is not None:
                    return ChatCompletionsResult(
                        content=out, tier=tier, provider_used="openrouter-qwen", model_resolved=qwen_model
                    )

        elif prov == "groq":
            model_use = resolve_model("groq",mraw)
            for key in _iter_keys_with_health("groq_pool", groq_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_completions(
                        groq_base,
                        key,
                        model_use,
                        proxy_messages,
                        temperature=temperature,
                        response_format=response_format,
                        max_tokens=chat_max_tokens,
                    ),
                    "groq_pool",
                    key,
                )
                if out is not None:
                    return ChatCompletionsResult(
                        content=out, tier=tier, provider_used="groq", model_resolved=model_use
                    )

        elif prov == "glm":
            model_use = resolve_model("glm",mraw)
            glm_ps = len(glm_pool)
            for key in _iter_keys_for_llm("glm_pool", glm_pool):
                got = _finish_provider_attempt(
                    _provider_chat_call(glm_base, key, model_use),
                    "glm_pool",
                    key,
                    "glm",
                    model_use,
                    pool_size=glm_ps,
                )
                if got is not None:
                    return got

        elif prov == "openai":
            model_use = resolve_model("openai",mraw)
            for key in _iter_keys_for_llm("openai_pool", openai_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_completions(
                        openai_official,
                        key,
                        model_use,
                        proxy_messages,
                        temperature=temperature,
                        response_format=response_format,
                        max_tokens=chat_max_tokens,
                    ),
                    "openai_pool",
                    key,
                )
                if out is not None:
                    return ChatCompletionsResult(
                        content=out, tier=tier, provider_used="openai", model_resolved=model_use
                    )

        elif prov == "gemini":
            model_use = resolve_model("gemini",mraw)
            gemini_base = "https://generativelanguage.googleapis.com/v1beta/openai"
            gemini_ps = len(gemini_pool)
            for key in _iter_keys_for_llm("gemini_pool", gemini_pool):
                out = ok_tuple(
                    _post_openai_compatible_chat_completions(
                        gemini_base,
                        key,
                        model_use,
                        proxy_messages,
                        temperature=temperature,
                        response_format=response_format,
                        max_tokens=chat_max_tokens,
                    ),
                    "gemini_pool",
                    key,
                    pool_size=gemini_ps,
                )
                if out is not None:
                    return ChatCompletionsResult(
                        content=out, tier=tier, provider_used="gemini", model_resolved=model_use
                    )

        elif prov == "lmarena":
            model_use = resolve_model("lmarena", mraw)
            for key in _iter_keys_with_health("lmarena_keys", lmarena_pool):
                got = _finish_provider_attempt(
                    _provider_chat_call(lmarena_base, key, model_use),
                    "lmarena_keys",
                    key,
                    "lmarena",
                    model_use,
                )
                if got is not None:
                    return got

        elif prov == "api_key_groups":
            group_keys = _select_api_key_group_keys(
                settings.get("api_key_groups_raw"),
                desired_provider="",
                desired_tier=tier,
                desired_model=forced_model or "",
                swoop_user_email=user_email_norm,
            )
            if group_keys:
                or_m = resolve_model("openrouter",forced_model)
                oa_m = resolve_model("openai",forced_model)
                for key in _iter_keys_with_health("api_key_groups_keys", group_keys):
                    out = ok_tuple(
                        _post_openai_compatible_chat_completions(
                            openrouter_base,
                            key,
                            or_m,
                            proxy_messages,
                            temperature=temperature,
                            response_format=response_format,
                            extra_headers=or_headers,
                            max_tokens=chat_max_tokens,
                        ),
                        "api_key_groups_keys",
                        key,
                    )
                    if out is not None:
                        return ChatCompletionsResult(
                            content=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openrouter:{or_m}"
                        )
                    out = ok_tuple(
                        _post_openai_compatible_chat_completions(
                            openai_official,
                            key,
                            oa_m,
                            proxy_messages,
                            temperature=temperature,
                            response_format=response_format,
                            max_tokens=chat_max_tokens,
                        ),
                        "api_key_groups_keys",
                        key,
                    )
                    if out is not None:
                        return ChatCompletionsResult(
                            content=out, tier=tier, provider_used="api_key_groups", model_resolved=f"openai:{oa_m}"
                        )

        elif prov == "env_openai":
            model_use = resolve_model("openai",mraw)
            env_key = os.environ.get("OPENAI_API_KEY", "").strip()
            if env_key:
                out = ok_tuple(
                    _post_openai_compatible_chat_completions(
                        openai_official,
                        env_key,
                        model_use,
                        proxy_messages,
                        temperature=temperature,
                        response_format=response_format,
                        max_tokens=chat_max_tokens,
                    ),
                    "env_openai_key",
                    env_key,
                )
                if out is not None:
                    return ChatCompletionsResult(
                        content=out, tier=tier, provider_used="env_openai", model_resolved=model_use
                    )
        else:
            logger.warning("LLM routing generic: unknown provider step %s", prov)

    if hermes_proxy:
        return _hermes_proxy_exhausted_result(proxy_messages, tier)
    return ChatCompletionsResult(tier=tier)


_AI_ENRICH_CATEGORIES = frozenset(
    {"general", "ai-ml", "dev-tools", "marketing", "business", "design"}
)


def ai_enrich_bookmark(url: str, title: str, content_text: str) -> Optional[Dict[str, Any]]:
    """
    Сводка/теги через LLM (маршрутизация по типу задачи + ключи Swoop, как в openai_chat_json_object).
    При отсутствии ключей или сбое — None, вызывающий код использует local_enrich_bookmark.
    """
    if not is_bookmarks_ai_enrich_enabled():
        return None
    if not has_any_bookmark_llm_keys():
        return None
    excerpt = (content_text or "").strip()[:12000]
    system_prompt = (
        "Answer with a single JSON object, no markdown. Fields: "
        '"summary" (string, max 400 chars), '
        '"category" exactly one of: general, ai-ml, dev-tools, marketing, business, design, '
        '"tags" array of 1–6 short strings.'
    )
    user_prompt = f"URL: {url}\nTitle: {title}\n\nPage text:\n{excerpt or '(empty)'}"
    chat_res = openai_chat_json_object(system_prompt, user_prompt)
    raw = chat_res.data
    if not raw or not isinstance(raw, dict):
        return None
    summary = _truncate_text(str(raw.get("summary") or "").strip(), 400)
    if not summary:
        return None
    cat = str(raw.get("category") or "general").strip().lower()
    if cat not in _AI_ENRICH_CATEGORIES:
        cat = infer_category(url, title, content_text)
    tags_raw = raw.get("tags")
    tags: List[str] = []
    if isinstance(tags_raw, list):
        for t in tags_raw[:6]:
            if isinstance(t, str) and t.strip():
                tags.append(t.strip()[:48])
    if not tags:
        tags = infer_tags(url, title, content_text, cat)
    tags = normalize_tags(tags)
    return {"summary": summary, "category": cat, "tags": tags[:6]}


_KB_SAVE_CMD_RE = re.compile(
    r"(сохрани|запиши|добавь|индексируй|index|save).{0,200}(бз|базу|репу|ссылк|link|knowledge)",
    re.IGNORECASE | re.UNICODE,
)


def _looks_like_user_kb_command(text: str) -> bool:
    s = (text or "").strip()
    if not s or len(s) > 600:
        return False
    if _KB_SAVE_CMD_RE.search(s):
        return True
    low = s.lower()
    return ("http://" in low or "https://" in low) and any(
        x in low for x in ("сохрани", "индексируй", "запиши", "save to", "knowledge base")
    )


def _strip_kb_save_commands_from_text(text: str) -> str:
    kept: List[str] = []
    for ln in (text or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if _looks_like_user_kb_command(s):
            continue
        kept.append(ln)
    return "\n".join(kept).strip()


def _title_from_canonical_url(url: str) -> str:
    try:
        parsed = urlparse(url if "://" in url else f"https://{url.lstrip('/')}")
        host = (parsed.netloc or "").replace("www.", "").lower()
        parts = [x for x in (parsed.path or "").strip("/").split("/") if x]
        if host == "github.com" and len(parts) >= 2:
            return f"{parts[0]}/{parts[1]}"[:200]
        if host and parts:
            return f"{host}/{parts[0]}"[:200]
        return host[:200] if host else ""
    except Exception:
        return ""


def _is_weak_knowledge_title(title: str, url: str) -> bool:
    t = (title or "").strip()
    tl = t.lower()
    if not tl or tl in ("untitled", "заметка из telegram"):
        return True
    if _looks_like_user_kb_command(title):
        return True
    if tl.startswith("ocr:"):
        return True
    if t.endswith(":") and len(t) < 72 and not re.search(r"https?://", t, re.I):
        return True
    if re.match(
        r"^(?:как\s+(?:подключ|установ|настро|использ|получ|запуст|сделать)|how\s+to\b|шаги?\b|инструкция\b|готово!?\s*$|важно\b|источник\b|ссылки?\b)",
        tl,
        re.I,
    ):
        return True
    try:
        host = (urlparse(url if "://" in url else f"https://{url}").netloc or "").replace("www.", "").lower()
        if host and tl in (host, f"www.{host}"):
            return True
    except Exception:
        pass
    return False


def _pick_kb_title_from_ocr(ocr: str) -> str:
    lines = [ln.strip() for ln in (ocr or "").splitlines() if ln.strip()]
    scored: list[tuple[int, str]] = []
    for idx, ln in enumerate(lines[:14]):
        if _is_weak_knowledge_title(ln, ""):
            continue
        score = len(ln) + max(0, 36 - idx * 4)
        if len(ln) >= 48:
            score += 40
        elif len(ln) >= 28:
            score += 15
        scored.append((score, ln))
    if not scored:
        return ""
    scored.sort(reverse=True)
    return scored[0][1][:120]


def _summary_from_fetched_page(page_text: str, url: str, fallback_title: str) -> str:
    lines = [ln.strip() for ln in (page_text or "").splitlines() if ln.strip()]
    for ln in lines:
        low = ln.lower()
        if low.startswith("title:") and len(ln) > 8:
            return _truncate_text(ln.split(":", 1)[1].strip(), 500)
        if ln.startswith("#") and len(ln) > 2:
            return _truncate_text(ln.lstrip("#").strip(), 500)
        if len(ln) >= 48 and not low.startswith("http"):
            return _truncate_text(ln, 500)
    title_guess = _title_from_canonical_url(url) or fallback_title
    return _truncate_text(f"{title_guess}. Источник: {url}", 500)


def fetch_github_repo_via_api(target_url: str, timeout_sec: int = 18) -> Dict[str, Any]:
    m = re.match(
        r"https?://(?:www\.)?github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)",
        (target_url or "").strip(),
        re.I,
    )
    if not m:
        return {"ok": False, "content_text": None, "title": None, "error": "not_github_repo"}
    owner, repo = m.group(1), m.group(2).rstrip(".git")
    if owner.lower() in ("orgs", "organizations", "settings", "features"):
        return {"ok": False, "content_text": None, "title": None, "error": "github_non_repo"}
    api_url = f"https://api.github.com/repos/{owner}/{repo}"
    req = UrlRequest(
        api_url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "AutoroKnowledge/1.0",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=timeout_sec) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body) if body else {}
            if not isinstance(data, dict):
                return {"ok": False, "content_text": None, "title": None, "error": "bad_json"}
            full_name = str(data.get("full_name") or f"{owner}/{repo}")
            desc = str(data.get("description") or "").strip()
            lang = str(data.get("language") or "").strip()
            stars = data.get("stargazers_count")
            topics = data.get("topics") if isinstance(data.get("topics"), list) else []
            topics_s = ", ".join(str(t) for t in topics[:12] if str(t).strip())
            chunks = [f"# {full_name}", desc, f"Language: {lang}" if lang else "", f"Stars: {stars}" if stars else ""]
            if topics_s:
                chunks.append(f"Topics: {topics_s}")
            readme_url = str(data.get("html_url") or target_url).rstrip("/") + "#readme"
            chunks.append(f"URL: {readme_url}")
            content_text = "\n\n".join(x for x in chunks if x).strip()
            return {
                "ok": True,
                "content_text": content_text[:120000],
                "title": full_name,
                "error": None,
            }
    except HTTPError as exc:
        return {"ok": False, "content_text": None, "title": None, "error": f"http_error:{exc.code}"}
    except Exception as exc:
        return {"ok": False, "content_text": None, "title": None, "error": str(exc)}


def is_knowledge_pipeline_enrich_enabled() -> bool:
    """KNOWLEDGE_PIPELINE_ENRICH: fetch URLs, LLM-optimize, tags, re-embed (default on)."""
    v = os.environ.get("KNOWLEDGE_PIPELINE_ENRICH", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def is_knowledge_url_fetch_enabled() -> bool:
    v = os.environ.get("KNOWLEDGE_FETCH_URLS", "1").strip().lower()
    return v not in ("0", "false", "no", "off")


def ai_enrich_knowledge(
    url: str,
    title: str,
    content_text: str,
    source: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Оптимизация заметки под семантический поиск: title, summary, search_text, category, tags.
    """
    if not is_knowledge_pipeline_enrich_enabled() or not is_bookmarks_ai_enrich_enabled():
        return None
    if not has_any_bookmark_llm_keys():
        return None
    excerpt = (content_text or "").strip()[:14000]
    system_prompt = (
        "You prepare notes for a cross-platform personal knowledge base with vector semantic search. "
        "Return a single JSON object, no markdown. Fields: "
        '"title" (string, max 120 chars, clear and specific), '
        '"summary" (string, max 500 chars, dense factual overview for retrieval), '
        '"search_text" (string, max 6000 chars, cleaned body optimized for embedding: '
        "headings as ## lines, bullet facts, no ads/signatures/forward noise), "
        '"category" (one of: general, ai-ml, dev-tools, marketing, business, design, prompt, article, note, link), '
        '"tags" (array of 3-8 lowercase strings, include domain + intent). '
        "Preserve URLs and key names. Source channel hint: "
        + (source or "unknown")
    )
    user_prompt = f"URL: {url or '(none)'}\nTitle: {title}\n\nMaterial:\n{excerpt or '(empty)'}"
    chat_res = openai_chat_json_object(system_prompt, user_prompt)
    raw = chat_res.data
    if not raw or not isinstance(raw, dict):
        return None
    new_title = _truncate_text(str(raw.get("title") or title).strip(), 120) or title
    summary = _truncate_text(str(raw.get("summary") or "").strip(), 500)
    search_text = str(raw.get("search_text") or excerpt).strip()[:6000]
    if not summary:
        return None
    cat = str(raw.get("category") or "general").strip().lower()
    if cat not in _AI_ENRICH_CATEGORIES and cat not in {
        "prompt",
        "article",
        "note",
        "link",
        "task",
    }:
        cat = infer_category(url, title, content_text)
    tags_raw = raw.get("tags")
    tags: List[str] = []
    if isinstance(tags_raw, list):
        for t in tags_raw[:8]:
            if isinstance(t, str) and t.strip():
                tags.append(t.strip().lower()[:48])
    if not tags:
        tags = infer_tags(url, title, content_text, cat)
    tags = normalize_tags(tags)
    return {
        "title": new_title,
        "summary": summary,
        "search_text": search_text or excerpt[:6000],
        "category": cat,
        "tags": tags[:8],
    }


def _build_security_flagged_capture_fields(
    *,
    raw_url: str,
    canonical_url: str,
    title: str,
    merged_text: str,
    security: Any,
    url_fetched: bool = False,
) -> Dict[str, Any]:
    return {
        "url": canonical_url or raw_url,
        "canonical_url": canonical_url,
        "title": title or "Pending Moderation",
        "text": security.text,
        "raw_text": merged_text,
        "ai_summary": "[PENDING MODERATION] Content flagged for security review.",
        "category": "security-hold",
        "tags": ["pending-moderation"],
        "url_fetched": url_fetched,
        "security_flagged": True,
        "redacted_categories": security.redacted_categories,
        "prompt_injection": security.prompt_injection,
    }


def finalize_knowledge_capture_fields(
    *,
    raw_url: str,
    title: str,
    text: str,
    ai_summary: str,
    category: str,
    tags: List[str],
    source: str,
    skip_security: bool = False,
) -> Dict[str, Any]:
    """
    Пайплайн БЗ: ссылки из текста → Jina fetch → LLM (или эвристики) → поля для PG + embedding.
    """
    canonical_url = normalize_url(raw_url) if raw_url else ""
    if not canonical_url:
        found = extract_urls_from_text(text)
        if found:
            canonical_url = found[0]

    merged_text = _strip_kb_save_commands_from_text((text or "").strip())
    if _is_weak_knowledge_title(title, canonical_url):
        title = _title_from_canonical_url(canonical_url) or title

    fetched = False
    page_blob = ""
    if is_knowledge_url_fetch_enabled() and canonical_url:
        fetch = fetch_content_via_jina(canonical_url, timeout_sec=35)
        if fetch.get("ok") and fetch.get("content_text"):
            page_blob = (fetch["content_text"] or "").strip()
        if not page_blob and "github.com/" in canonical_url.lower():
            gh = fetch_github_repo_via_api(canonical_url)
            if gh.get("ok") and gh.get("content_text"):
                page_blob = (gh["content_text"] or "").strip()
                if gh.get("title"):
                    title = str(gh["title"])
        if page_blob:
            fetched = True
            merged_text = (
                f"{merged_text}\n\n---\n\n## Источник\n{canonical_url}\n\n{page_blob[:80000]}"
                if merged_text
                else page_blob[:100000]
            )

    if not skip_security:
        security = screen_capture_content(merged_text)
        if security.route == "human_review":
            enrich_title = title
            if _is_weak_knowledge_title(enrich_title, canonical_url):
                enrich_title = _title_from_canonical_url(canonical_url) or enrich_title
            return _build_security_flagged_capture_fields(
                raw_url=raw_url,
                canonical_url=canonical_url,
                title=enrich_title,
                merged_text=merged_text,
                security=security,
                url_fetched=fetched,
            )

    enrich_title = title
    if _is_weak_knowledge_title(enrich_title, canonical_url):
        enrich_title = _title_from_canonical_url(canonical_url) or enrich_title

    enriched = ai_enrich_knowledge(canonical_url or raw_url, enrich_title, merged_text, source)
    if not enriched:
        base = local_enrich_bookmark(canonical_url or raw_url, enrich_title, merged_text)
        summary_fb = base.get("summary") or ai_summary
        if page_blob and (
            _looks_like_user_kb_command(summary_fb) or len((summary_fb or "").strip()) < 80
        ):
            summary_fb = _summary_from_fetched_page(page_blob, canonical_url, enrich_title)
        enriched = {
            "title": enrich_title,
            "summary": summary_fb,
            "search_text": merged_text[:6000] if merged_text else page_blob[:6000],
            "category": base.get("category") or category,
            "tags": base.get("tags") or tags,
        }

    out_title = _truncate_text(str(enriched.get("title") or enrich_title).strip(), 1000) or enrich_title
    if _is_weak_knowledge_title(out_title, canonical_url):
        out_title = _title_from_canonical_url(canonical_url) or out_title
    out_summary = _truncate_text(str(enriched.get("summary") or ai_summary).strip(), 4000)
    if _looks_like_user_kb_command(out_summary) and page_blob:
        out_summary = _summary_from_fetched_page(page_blob, canonical_url, out_title)
    out_category = _truncate_text(str(enriched.get("category") or category).strip().lower(), 128) or category
    out_tags = normalize_tags(enriched.get("tags") or tags)
    if out_category and out_category not in out_tags:
        out_tags.insert(0, out_category)
    out_tags = list(dict.fromkeys(out_tags))[:12]
    body = str(enriched.get("search_text") or merged_text).strip()[:200000]
    if not body:
        body = merged_text[:200000] or text[:200000]

    return {
        "url": canonical_url or raw_url,
        "canonical_url": canonical_url,
        "title": out_title,
        "text": body,
        "ai_summary": out_summary,
        "category": out_category,
        "tags": out_tags,
        "url_fetched": fetched,
    }


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "service": "autoro-scraping-agent"}


def _provider_health_rows(provider: str, keys: List[str]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    now = time.time()
    for idx, raw_key in enumerate(keys or []):
        key = str(raw_key or "").strip()
        if not key:
            continue
        state = _key_health_get(provider, key)
        inactive_until_ts = float(state.get("inactive_until_ts") or 0.0)
        status = "inactive" if inactive_until_ts > now else ("active" if state.get("last_status") == "active" else "unknown")
        rows.append(
            {
                "index": idx,
                "masked": _mask_secret_key(key),
                "status": status,
                "reason": state.get("last_error") or "",
                "until": datetime.datetime.utcfromtimestamp(inactive_until_ts).isoformat() + "Z" if inactive_until_ts > now else None,
                "last_code": int(state.get("last_code") or 0),
            }
        )
    return rows


@app.get("/api/v1/admin/key-health")
async def admin_key_health(
    request: Request,
    x_api_key: str = Header("", alias="X-API-Key"),
):
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    settings = load_swoop_llm_key_settings()
    gemini_all = list(settings.get("gemini_keys") or [])
    if settings.get("gemini_api_key"):
        gemini_all.append(str(settings["gemini_api_key"]))

    providers = {
        "glm_keys": _provider_health_rows("glm_keys", list(settings.get("glm_keys") or [])),
        "openai_keys": _provider_health_rows("openai_keys", list(settings.get("openai_keys") or [])),
        "openrouter_keys": _provider_health_rows("openrouter_keys", list(settings.get("openrouter_keys") or [])),
        "openrouter_qwen_keys": _provider_health_rows(
            "openrouter_qwen_keys", list(settings.get("openrouter_qwen_keys") or [])
        ),
        "groq_keys": _provider_health_rows("groq_keys", list(settings.get("groq_keys") or [])),
        "gemini_keys": _provider_health_rows("gemini_keys", gemini_all),
        "lmarena_keys": _provider_health_rows("lmarena_keys", list(settings.get("lmarena_keys") or [])),
        "brave_keys": _provider_health_rows("brave_keys", list(settings.get("brave_keys") or [])),
        "tavily_keys": _provider_health_rows("tavily_keys", list(settings.get("tavily_keys") or [])),
        "api_key_groups_keys": _provider_health_rows("api_key_groups_keys", list(settings.get("api_key_groups_keys") or [])),
    }
    return {
        "status": "ok",
        "providers": providers,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/v1/admin/provider-catalog")
async def admin_provider_catalog(
    request: Request,
    q: str = "",
    x_api_key: str = Header("", alias="X-API-Key"),
):
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    settings = load_swoop_llm_key_settings()
    catalogs = get_cached_provider_catalogs(settings)
    or_meta_all = get_cached_openrouter_meta(settings)
    query = (q or "").strip()
    free_only = str(request.query_params.get("free") or "").strip().lower() in ("1", "true", "yes")
    if query or free_only:
        or_meta = search_openrouter_models(or_meta_all, query, free_only=free_only)
    else:
        or_meta = or_meta_all
    or_free = [m for m in or_meta_all if m.get("is_free")]
    return {
        "status": "ok",
        "catalogs": catalogs,
        "openrouter_meta": or_meta,
        "openrouter_meta_free": or_free,
        "openrouter_meta_total": len(or_meta_all),
        "openrouter_free_total": len(or_free),
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }


@app.get("/api/v1/openrouter/catalog")
async def openrouter_catalog(
    request: Request,
    q: str = "",
    free: str = "",
    x_api_key: str = Header("", alias="X-API-Key"),
):
    """Полный каталог OpenRouter для админки (кэш 24ч, публичный upstream)."""
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    settings = load_swoop_llm_key_settings()
    or_meta_all = get_cached_openrouter_meta(settings)
    query = (q or "").strip()
    free_only = str(free or "").strip().lower() in ("1", "true", "yes")
    if query or free_only:
        models = search_openrouter_models(or_meta_all, query, free_only=free_only)
    else:
        models = or_meta_all
    or_free = [m for m in or_meta_all if m.get("is_free")]
    return {
        "status": "ok",
        "models": models,
        "free_models": or_free,
        "total": len(or_meta_all),
        "free_total": len(or_free),
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }


@app.post("/api/v1/admin/openrouter/refresh")
async def admin_openrouter_refresh(
    request: Request,
    x_api_key: str = Header("", alias="X-API-Key"),
):
    """Принудительное обновление кэша OpenRouter (тот же job, что и фоновый таймер)."""
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    stats = await asyncio.to_thread(_openrouter_catalog_refresh_job)
    return {
        "status": "ok",
        "total": stats.get("total", 0),
        "free_total": stats.get("free_total", 0),
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }


def _verify_single_api_key(provider: str, key: str) -> Tuple[bool, int, str]:
    """
    Проверяет один API ключ, делая минимальный запрос к провайдеру.
    Возвращает (is_valid, status_code, message)
    """
    prov = str(provider).strip().lower()
    clean_key = str(key).strip()
    if not clean_key:
        return False, 400, "empty_key"

    messages = [{"role": "user", "content": "ping"}]
    timeout = 10
    ping_settings = load_swoop_llm_key_settings()
    ping_catalogs = get_cached_provider_catalogs(ping_settings)

    if prov in ("openai", "openai_keys", "openai_pool"):
        api_base = os.environ.get("BOOKMARKS_OPENAI_API_BASE", "https://api.openai.com/v1").strip()
        model = resolve_model_for_provider("openai", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("openrouter", "openrouter_keys", "openrouter_pool", "api_key_groups_keys"):
        api_base = os.environ.get("BOOKMARKS_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").strip()
        model = resolve_model_for_provider("openrouter", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("openrouter_qwen_keys", "openrouter-qwen"):
        api_base = os.environ.get("BOOKMARKS_OPENROUTER_API_BASE", "https://openrouter.ai/api/v1").strip()
        model = resolve_model_for_provider("openrouter-qwen", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("groq", "groq_keys", "groq_pool"):
        api_base = os.environ.get("BOOKMARKS_GROQ_BASE", "https://api.groq.com/openai/v1").strip()
        model = resolve_model_for_provider("groq", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("glm", "glm_keys", "glm_pool"):
        api_base = os.environ.get("BOOKMARKS_GLM_BASE", "https://open.bigmodel.cn/api/paas/v4").strip()
        model = resolve_model_for_provider("glm", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("gemini", "gemini_keys", "gemini_pool"):
        api_base = "https://generativelanguage.googleapis.com/v1beta/openai"
        model = resolve_model_for_provider("gemini", "fast", "", ping_settings, catalogs=ping_catalogs)
    elif prov in ("lmarena", "lmarena_keys"):
        swoop = load_swoop_llm_key_settings()
        return _verify_lmarena_key(swoop, clean_key, timeout=timeout)
    elif prov in ("tavily", "tavily_keys"):
        url = "https://api.tavily.com/search"
        headers = {"Content-Type": "application/json"}
        payload = {"api_key": clean_key, "query": "test", "max_results": 1}
        code, body, raw = _http_post_json(url, headers, payload, timeout=timeout)
        if code == 200:
            return True, 200, "ok"
        return False, code, _sanitize_llm_error_text(raw, code)
    elif prov in ("brave", "brave_keys"):
        url = "https://api.search.brave.com/res/v1/web/search?q=test&count=1"
        req = UrlRequest(url, headers={"X-Subscription-Token": clean_key, "Accept": "application/json"})
        try:
            with urlopen(req, timeout=timeout) as resp:
                return True, 200, "ok"
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            return False, int(exc.code), _sanitize_llm_error_text(raw, exc.code)
        except Exception as exc:
            return False, -1, str(exc)
    else:
        # Fallback to auto-detection
        detected = "openrouter"
        if clean_key.startswith("gsk_"):
            detected = "groq"
        elif clean_key.startswith("AIzaSy"):
            detected = "gemini"
        elif clean_key.startswith("sk-") and not clean_key.startswith("sk-or-"):
            detected = "openai"
        elif "." in clean_key and len(clean_key) > 20:
            detected = "glm"
        return _verify_single_api_key(detected, clean_key)

    url = api_base.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {clean_key}", "Content-Type": "application/json"}
    if "openrouter" in api_base:
        headers["HTTP-Referer"] = os.environ.get("BOOKMARKS_OPENROUTER_REFERER", "https://swoop.autoro.tech")
        headers["X-Title"] = os.environ.get("BOOKMARKS_OPENROUTER_TITLE", "Autoro Bookmarks Bro")

    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 5,
    }
    code, body, raw = _http_post_json(url, headers, payload, timeout=timeout)
    if code == 200 and isinstance(body, dict):
        return True, 200, "ok"
    err_msg = _sanitize_llm_error_text(raw, code)
    return False, code, err_msg


@app.post("/api/v1/admin/verify-keys")
@app.get("/api/v1/admin/verify-keys")
async def admin_verify_keys(
    request: Request,
    x_api_key: str = Header("", alias="X-API-Key"),
):
    """
    Полная проверка всех ключей в Swoop Settings (в фоне или синхронно через ThreadPoolExecutor).
    """
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    settings = load_swoop_llm_key_settings()
    providers_map = {
        "glm_keys": list(settings.get("glm_keys") or []),
        "openai_keys": list(settings.get("openai_keys") or []),
        "openrouter_keys": list(settings.get("openrouter_keys") or []),
        "openrouter_qwen_keys": list(settings.get("openrouter_qwen_keys") or []),
        "groq_keys": list(settings.get("groq_keys") or []),
        "gemini_keys": list(settings.get("gemini_keys") or []),
        "lmarena_keys": list(settings.get("lmarena_keys") or []),
        "brave_keys": list(settings.get("brave_keys") or []),
        "tavily_keys": list(settings.get("tavily_keys") or []),
    }
    if settings.get("gemini_api_key"):
        providers_map["gemini_keys"].append(str(settings["gemini_api_key"]))

    # Also extract keys from api_key_groups
    for item in (settings.get("api_key_groups_raw") or []):
        if not isinstance(item, dict):
            continue
        g_prov = str(item.get("provider") or "").strip().lower()
        if not g_prov:
            g_prov = "api_key_groups_keys"
        else:
            g_prov = g_prov + "_keys"
        if g_prov not in providers_map:
            providers_map[g_prov] = []
        for k in item.get("keys") or []:
            if isinstance(k, str) and k.strip():
                providers_map[g_prov].append(k.strip())

    from concurrent.futures import ThreadPoolExecutor
    futures = []
    results_list = []

    with ThreadPoolExecutor(max_workers=16) as executor:
        for prov_name, keys in providers_map.items():
            unique_keys = []
            seen = set()
            for k in keys:
                if k and k not in seen:
                    seen.add(k)
                    unique_keys.append(k)
            for idx, key in enumerate(unique_keys):
                futures.append((prov_name, key, idx, executor.submit(_verify_single_api_key, prov_name, key)))

        for prov_name, key, idx, fut in futures:
            try:
                is_valid, code, msg = fut.result()
            except Exception as e:
                is_valid, code, msg = False, -1, str(e)

            if is_valid:
                _key_health_mark_success(prov_name, key)
            else:
                _key_health_mark_failure(prov_name, key, code, msg)

            results_list.append({
                "provider": prov_name,
                "index": idx,
                "masked": _mask_secret_key(key),
                "is_valid": is_valid,
                "code": code,
                "message": msg
            })

    _persist_key_health_state(force=True)

    return {
        "status": "ok",
        "results": results_list,
        "updated_at": datetime.datetime.utcnow().isoformat() + "Z",
    }


def _safe_env_truthy(flag: Optional[str]) -> bool:
    return str(flag or "").lower() in ("1", "true", "yes", "on")


def _count_gemini_slots(settings: Dict[str, Any]) -> int:
    n = len(list(settings.get("gemini_keys") or []))
    if (str(settings.get("gemini_api_key") or "").strip()):
        n += 1
    return n


@app.get("/api/v1/admin/environment-report")
async def admin_environment_report(
    request: Request,
    x_api_key: str = Header("", alias="X-API-Key"),
):
    """
    Обзор конфигурации окружения agent-api без секретов (для операторских отчётов и мониторинга).
    Авторизация: тот же X-API-Key, что у /api/v1/admin/key-health.
    """
    client_ip = get_request_ip(request)
    cfg = load_agent_settings()
    expected = str(cfg.get("agent_api_key") or "").strip()
    if not cfg.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")
    if not expected:
        raise HTTPException(status_code=503, detail="Agent API key is not configured")
    if (x_api_key or "").strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not check_rate_limit(client_ip, int(cfg.get("agent_rate_limit") or 30)):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    swoop_settings = load_swoop_llm_key_settings()

    db_ok = False
    db_error: Optional[str] = None
    try:
        conn = pg_connect()
        conn.close()
        db_ok = True
    except Exception as exc:
        db_error = type(exc).__name__

    llm_key_counts = {
        "glm_keys": len(list(swoop_settings.get("glm_keys") or [])),
        "openai_keys": len(list(swoop_settings.get("openai_keys") or [])),
        "openrouter_keys": len(list(swoop_settings.get("openrouter_keys") or [])),
        "openrouter_qwen_keys": len(list(swoop_settings.get("openrouter_qwen_keys") or [])),
        "groq_keys": len(list(swoop_settings.get("groq_keys") or [])),
        "gemini_slots": _count_gemini_slots(swoop_settings),
        "brave_keys": len(list(swoop_settings.get("brave_keys") or [])),
        "tavily_keys": len(list(swoop_settings.get("tavily_keys") or [])),
        "api_key_groups_keys": len(list(swoop_settings.get("api_key_groups_keys") or [])),
    }

    knowledge_relative_root = (
        os.environ.get("KNOWLEDGE_OBSIDIAN_RELATIVE_ROOT", "Autoro KB/ws-{workspace_id}").strip()
    )

    return {
        "status": "ok",
        "generated_at": datetime.datetime.utcnow().isoformat() + "Z",
        "postgres": {
            "host": PGHOST,
            "port": PGPORT,
            "database": PGDATABASE,
            "user": PGUSER,
            "reachable": db_ok,
            "error_type": db_error,
        },
        "agent": {
            "enabled": bool(cfg.get("agent_enabled")),
            "rate_limit_per_minute_ip": int(cfg.get("agent_rate_limit") or 30),
            "api_key_configured": bool(expected),
        },
        "supabase_public_url": SUPABASE_URL.rstrip("/"),
        "anon_key_configured": bool((SUPABASE_ANON_KEY or "").strip()),
        "bookmarks": {
            "perplexica_api_base": BOOKMARKS_PERPLEXICA_API_BASE,
            "unauthorized_limit_enabled": BOOKMARKS_UNAUTHORIZED_LIMIT_ENABLED,
            "unauthorized_max_items": BOOKMARKS_UNAUTHORIZED_MAX_ITEMS,
        },
        "knowledge": {
            "obsidian_relative_root_template": knowledge_relative_root,
        },
        "internal_api": {
            "basic_auth_configured": bool((INTERNAL_API_PASSWORD or "").strip()),
            "bootstrap_secret_configured": bool((EXTENSION_BOOTSTRAP_SECRET or "").strip()),
        },
        "openrouter_models": {
            "default": str(swoop_settings.get("openrouter_default_model") or ""),
            "qwen": str(swoop_settings.get("openrouter_qwen_model") or ""),
        },
        "llm_key_counts": llm_key_counts,
    }


@app.get("/go/{spot_id}")
async def go_redirect(spot_id: int, request: Request, background_tasks: BackgroundTasks):
    params = dict(request.query_params)
    fbclid = params.get("fbclid")
    ip_address = get_request_ip(request)
    user_agent = request.headers.get("user-agent", "")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, target_tg_url
                FROM public.spots
                WHERE id = %s
                LIMIT 1
                """,
                (spot_id,),
            )
            spot = cur.fetchone()
    finally:
        conn.close()

    if not spot:
        logger.error("Spot not found for redirect: spot_id=%s, query=%s", spot_id, params)
        raise HTTPException(status_code=404, detail="Spot not found")

    click_id = str(uuid.uuid4())
    background_tasks.add_task(
        save_click_async,
        click_id,
        spot_id,
        fbclid,
        ip_address,
        user_agent,
        params.get("utm_source"),
        params.get("utm_medium"),
        params.get("utm_campaign"),
    )

    try:
        target = build_telegram_link(spot["target_tg_url"], click_id)
    except Exception as exc:
        logger.error("Failed to build telegram deep link for spot_id=%s: %s", spot_id, exc)
        raise HTTPException(status_code=500, detail="Telegram redirect construction failed")

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=target, status_code=302)


@app.get("/l/{slug}")
async def landing_redirect(slug: str, request: Request):
    params = dict(request.query_params)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, name, slug, page_url, spot_id, is_active
                FROM public.landings
                WHERE slug = %s
                LIMIT 1
                """,
                (slug,),
            )
            landing = cur.fetchone()
    finally:
        conn.close()

    if not landing:
        logger.error("Landing not found for slug=%s", slug)
        raise HTTPException(status_code=404, detail="Landing not found")
    if not landing["is_active"]:
        logger.error("Landing inactive for slug=%s", slug)
        raise HTTPException(status_code=404, detail="Landing is inactive")

    # Pass original tracking params to /go endpoint.
    go_link = f"{request.base_url}go/{landing['spot_id']}"
    if params:
        go_link = f"{go_link}?{urlencode(params, doseq=True)}"

    try:
        target_url = build_landing_redirect_url(landing["page_url"], params, go_link, landing["id"], landing["spot_id"])
    except Exception as exc:
        logger.error("Landing URL build failed for slug=%s: %s", slug, exc)
        raise HTTPException(status_code=500, detail="Landing redirect construction failed")

    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=target_url, status_code=302)


@app.get("/api/internal/click/{click_id}")
async def get_click_for_n8n(click_id: str, authorization: Optional[str] = Header(default=None, alias="Authorization")):
    verify_internal_basic_auth(authorization)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                  c.click_id,
                  c.fbclid,
                  c.ip_address,
                  c.user_agent,
                  c.utm_source,
                  c.utm_medium,
                  c.utm_campaign,
                  c.created_at as click_created_at,
                  s.id as spot_id,
                  s.name as spot_name,
                  s.fb_pixel_id,
                  s.fb_capi_token
                FROM public.clicks c
                JOIN public.spots s ON s.id = c.spot_id
                WHERE c.click_id = %s
                LIMIT 1
                """,
                (click_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Click not found")

    return dict(row)


@app.get("/api/internal/landings")
async def list_landings_for_internal(authorization: Optional[str] = Header(default=None, alias="Authorization")):
    verify_internal_basic_auth(authorization)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT l.id, l.name, l.slug, l.page_url, l.spot_id, l.is_active, l.created_at, s.name as spot_name
                FROM public.landings l
                JOIN public.spots s ON s.id = l.spot_id
                ORDER BY l.created_at DESC
                """
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@app.post("/api/internal/landings")
async def create_landing_internal(
    payload: LandingCreatePayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    verify_internal_basic_auth(authorization)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT 1 FROM public.spots WHERE id = %s LIMIT 1", (payload.spot_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Spot not found")

            cur.execute(
                """
                INSERT INTO public.landings (name, slug, page_url, spot_id, is_active)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id, name, slug, page_url, spot_id, is_active, created_at
                """,
                (payload.name, payload.slug, payload.page_url, payload.spot_id, payload.is_active),
            )
            row = cur.fetchone()
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to create landing: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to create landing")
    finally:
        conn.close()
    return dict(row)


@app.patch("/api/internal/landings/{landing_id}")
async def update_landing_internal(
    landing_id: int,
    payload: LandingUpdatePayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    verify_internal_basic_auth(authorization)

    updates: Dict[str, Any] = {}
    for key in ("name", "slug", "page_url", "spot_id", "is_active"):
        value = getattr(payload, key)
        if value is not None:
            updates[key] = value

    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if "spot_id" in updates:
                cur.execute("SELECT 1 FROM public.spots WHERE id = %s LIMIT 1", (updates["spot_id"],))
                if not cur.fetchone():
                    raise HTTPException(status_code=404, detail="Spot not found")

            set_sql = ", ".join([f"{k} = %s" for k in updates.keys()])
            values = list(updates.values()) + [landing_id]
            cur.execute(
                f"""
                UPDATE public.landings
                SET {set_sql}
                WHERE id = %s
                RETURNING id, name, slug, page_url, spot_id, is_active, created_at
                """,
                values,
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Landing not found")
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to update landing_id=%s: %s", landing_id, exc)
        raise HTTPException(status_code=500, detail="Failed to update landing")
    finally:
        conn.close()

    return dict(row)


@app.delete("/api/internal/landings/{landing_id}")
async def delete_landing_internal(landing_id: int, authorization: Optional[str] = Header(default=None, alias="Authorization")):
    verify_internal_basic_auth(authorization)

    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.landings WHERE id = %s", (landing_id,))
            deleted = cur.rowcount
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to delete landing_id=%s: %s", landing_id, exc)
        raise HTTPException(status_code=500, detail="Failed to delete landing")
    finally:
        conn.close()

    if not deleted:
        raise HTTPException(status_code=404, detail="Landing not found")
    return {"ok": True, "landing_id": landing_id}


@app.post("/api/internal/conversion")
async def create_conversion_for_n8n(
    payload: ConversionUpsertPayload,
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
):
    verify_internal_basic_auth(authorization)

    if payload.status not in {"pending", "success", "failed"}:
        raise HTTPException(status_code=400, detail="status must be one of: pending, success, failed")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT 1 FROM public.clicks WHERE click_id = %s LIMIT 1", (payload.click_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Click not found")

            cur.execute(
                """
                INSERT INTO public.conversions (click_id, event_name, status, fb_event_id, error_message, meta_response)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                RETURNING id, click_id, event_name, status, fb_event_id, error_message, created_at
                """,
                (
                    payload.click_id,
                    payload.event_name,
                    payload.status,
                    payload.fb_event_id,
                    payload.error_message,
                    psycopg2.extras.Json(payload.meta_response) if payload.meta_response is not None else None,
                ),
            )
            row = cur.fetchone()
        conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to save conversion for click_id=%s: %s", payload.click_id, exc)
        raise HTTPException(status_code=500, detail="Failed to save conversion")
    finally:
        conn.close()

    return dict(row)


@app.post("/api/v1/scrape", response_model=ScrapeResponse)
async def create_scrape_job(body: ScrapeRequest, request: Request, x_api_key: str = Header(..., alias="X-API-Key")):
    auth = verify_api_key(request, x_api_key)
    client_ip = auth["client_ip"]

    valid_modes = {"fetcher", "stealth", "dynamic", "gologin"}
    if body.mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"mode must be one of: {', '.join(valid_modes)}")

    valid_formats = {"markdown", "html", "text", "json"}
    if body.output_format not in valid_formats:
        raise HTTPException(status_code=400, detail=f"output_format must be one of: {', '.join(valid_formats)}")

    is_batch = bool(body.urls and len(body.urls) > 1)
    is_crawl = bool(body.crawl_depth and body.crawl_depth > 0)

    template_id = None
    if body.template_name:
        conn = pg_connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM public.scrapling_templates WHERE name = %s LIMIT 1", (body.template_name,))
                row = cur.fetchone()
                if row:
                    template_id = str(row[0])
        finally:
            conn.close()

    job_id = str(uuid.uuid4())
    job_data = {
        "id": job_id,
        "url": body.url,
        "mode": body.mode,
        "output_format": body.output_format,
        "selector": body.selector or "",
        "status": "queued",
        "source": "api",
        "api_client_ip": client_ip,
        "ai_prompt": body.ai_prompt or "",
        "is_batch": is_batch,
        "batch_urls": body.urls if is_batch else None,
        "is_crawl": is_crawl,
        "crawl_depth": body.crawl_depth or 0,
        "crawl_max_pages": body.max_pages or 20,
        "template_id": template_id,
    }

    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cols = ", ".join(job_data.keys())
            placeholders = ", ".join(["%s"] * len(job_data))
            cur.execute(f"INSERT INTO public.scrapling_jobs ({cols}) VALUES ({placeholders})", list(job_data.values()))
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create job: {e}")
    finally:
        conn.close()

    return ScrapeResponse(job_id=job_id, status="queued")


@app.get("/api/v1/scrape/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str, request: Request, x_api_key: str = Header(..., alias="X-API-Key")):
    verify_api_key(request, x_api_key)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT id, status, error_message, result_path, created_at FROM public.scrapling_jobs WHERE id = %s AND source = 'api'",
                (job_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")

    result_url = None
    result_preview = None
    if row["status"] == "done" and row.get("result_path"):
        result_url = f"/api/v1/scrape/{job_id}/download"
    if row["status"] == "done":
        conn2 = pg_connect()
        try:
            with conn2.cursor() as cur2:
                cur2.execute("SELECT result_preview FROM public.scrapling_jobs WHERE id = %s", (job_id,))
                r = cur2.fetchone()
                if r and r[0]:
                    result_preview = r[0][:2000]
        finally:
            conn2.close()

    return JobStatusResponse(
        job_id=str(row["id"]),
        status=row["status"],
        result_preview=result_preview,
        result_url=result_url,
        error=row.get("error_message"),
        created_at=str(row["created_at"]) if row.get("created_at") else None,
    )


@app.get("/api/v1/scrape/{job_id}/download")
async def download_result(job_id: str, request: Request, x_api_key: str = Header(..., alias="X-API-Key")):
    verify_api_key(request, x_api_key)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT status, result_path, result_preview FROM public.scrapling_jobs WHERE id = %s AND source = 'api'",
                (job_id,),
            )
            row = cur.fetchone()
    finally:
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    if row["status"] != "done":
        raise HTTPException(status_code=409, detail=f"Job is not complete (status: {row['status']})")

    result_path = row.get("result_path")
    if result_path:
        supabase_url = os.environ.get("SUPABASE_URL", "")
        download_url = f"{supabase_url}/storage/v1/object/public/user_uploads/{result_path}"
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=download_url)

    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        content=row.get("result_preview") or "No result available",
        media_type="text/plain",
    )


@app.post("/api/v1/telegram/autoro-gateway")
async def telegram_autoro_gateway(
    request: Request,
    background_tasks: BackgroundTasks,
    x_telegram_secret: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    """Один Telegram webhook: slash-команды ассистента/памяти → n8n, остальное (Hermes) → fallback URL.

    Без этого Hermes отвечает «Unknown command» на /research и /context, т.к. эти команды реализованы в n8n.
    Установите переменные окружения и переведите webhook Bot API на этот URL.
    """

    cfg = resolve_telegram_gateway_config()
    if not cfg["routingEnabled"]:
        raise HTTPException(
            status_code=503,
            detail=(
                "Включите маршрутизацию: TELEGRAM_ASSISTANT_ROUTING_ENABLED=1 в env "
                "или в Swoop Admin → Service settings → Telegram personal assistant gateway"
            ),
        )

    if TELEGRAM_WEBHOOK_SECRET and (x_telegram_secret or "").strip() != TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid telegram webhook secret")

    if not cfg["n8nAssistantUrl"] or not cfg["fallbackUrl"]:
        raise HTTPException(
            status_code=503,
            detail=(
                "Задайте URL n8n и Hermes fallback: env TELEGRAM_N8N_ASSISTANT_WEBHOOK_URL / "
                "TELEGRAM_WEBHOOK_SECONDARY_FALLBACK_URL или поля в service_settings (Swoop)"
            ),
        )

    body = await request.body()
    payload: Any = {}
    try:
        payload = json.loads(body.decode("utf-8")) if body else {}
    except Exception:
        payload = {}

    text = _telegram_update_message_text(payload) if isinstance(payload, dict) else ""
    to_n8n = _telegram_should_route_to_n8n_assistant(text)
    dest = cfg["n8nAssistantUrl"] if to_n8n else cfg["fallbackUrl"]

    background_tasks.add_task(_telegram_forward_background, dest, body, TELEGRAM_WEBHOOK_SECRET)
    return {
        "ok": True,
        "forwardScheduled": True,
        "target": "n8n_assistant" if to_n8n else "secondary_fallback",
    }


@app.post("/api/v1/telegram/webhook/setup")
async def telegram_webhook_setup(
    payload: TelegramWebhookSetupPayload,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    settings = load_agent_settings()
    stored_key = settings.get("agent_api_key", "")
    if not (stored_key and x_api_key == stored_key):
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_TOKEN is not configured")

    secret = (payload.secretToken or TELEGRAM_WEBHOOK_SECRET or "").strip()
    req_payload: Dict[str, Any] = {"url": payload.webhookUrl.strip(), "drop_pending_updates": True}
    if secret:
        req_payload["secret_token"] = secret

    tg_req = UrlRequest(
        url=f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
        data=json.dumps(req_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(tg_req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            return {"ok": bool(data.get("ok")), "result": data.get("result"), "description": data.get("description")}
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to setup telegram webhook: {exc}")


@app.post("/api/v1/telegram/webhook/setup/autoro-gateway")
async def telegram_webhook_setup_autoro_gateway(
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    public_base_url: Optional[str] = Query(
        default=None,
        max_length=512,
        description="Публичный HTTPS origin agent-api без пути (опционально; иначе env или service_settings.telegram_gateway_public_base)",
    ),
):
    """Регистрирует webhook Bot API на /api/v1/telegram/autoro-gateway (деление команд n8n vs Hermes)."""

    settings = load_agent_settings()
    stored_key = settings.get("agent_api_key", "")
    if not (stored_key and x_api_key == stored_key):
        raise HTTPException(status_code=401, detail="Invalid API key")

    if not TELEGRAM_BOT_TOKEN:
        raise HTTPException(status_code=503, detail="TELEGRAM_BOT_TOKEN is not configured")
    cfg = resolve_telegram_gateway_config()
    if not cfg["routingEnabled"]:
        raise HTTPException(
            status_code=503,
            detail=(
                "Включите маршрутизацию: TELEGRAM_ASSISTANT_ROUTING_ENABLED=1 или "
                "флаг в Swoop → Service settings → Telegram gateway"
            ),
        )
    if not cfg["n8nAssistantUrl"] or not cfg["fallbackUrl"]:
        raise HTTPException(
            status_code=503,
            detail="Задайте URL n8n и Hermes fallback в env или в service_settings (Swoop)",
        )

    base = (public_base_url or cfg["publicBase"] or "").strip().rstrip("/")
    if not base:
        raise HTTPException(
            status_code=400,
            detail=(
                "Укажите query public_base_url=… или env TELEGRAM_AUTORO_GATEWAY_PUBLIC_BASE "
                "или поле «Публичный origin» в Swoop (HTTPS origin agent-api, без / в конце)"
            ),
        )

    webhook_url = f"{base}/api/v1/telegram/autoro-gateway"
    secret = (TELEGRAM_WEBHOOK_SECRET or "").strip()
    req_payload: Dict[str, Any] = {"url": webhook_url, "drop_pending_updates": True}
    if secret:
        req_payload["secret_token"] = secret

    tg_req = UrlRequest(
        url=f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook",
        data=json.dumps(req_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(tg_req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            return {
                "ok": bool(data.get("ok")),
                "telegram": data,
                "registeredWebhookUrl": webhook_url,
                "routing": {
                    "n8nAssistant": cfg["n8nAssistantUrl"],
                    "fallback": cfg["fallbackUrl"],
                },
            }
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to setup telegram autoro-gateway webhook: {exc}")


def verify_internal_access(request: Request, x_api_key: Optional[str], authorization: Optional[str]):
    if str(os.environ.get("AGENT_API_DEV_BYPASS_AUTH", "0")).strip().lower() in ("1", "true", "yes", "on"):
        return
    key = x_api_key or (authorization.split(" ", 1)[1] if authorization and authorization.lower().startswith("bearer ") else None)
    if not key:
        raise HTTPException(status_code=401, detail="Unauthorized")
    settings = load_agent_settings()
    admin_key = settings.get("agent_api_key", "")
    if (admin_key and key == admin_key) or (TELEGRAM_WEBHOOK_SECRET and key == TELEGRAM_WEBHOOK_SECRET):
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


@app.post("/api/v1/keept/telegram/link-code")
async def generate_telegram_link_code(
    request: Request,
    workspaceId: str = Query(...),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: User identity required")
    
    workspace_id = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)
    
    import random
    import string
    code = "KEEPT-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
    expires_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=10)
    
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.telegram_link_codes WHERE workspace_id = %s OR user_id = %s", (workspace_id, user_id))
            cur.execute(
                """
                INSERT INTO public.telegram_link_codes (code, user_id, workspace_id, expires_at)
                VALUES (%s, %s, %s, %s)
                """,
                (code, user_id, workspace_id, expires_at)
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to generate telegram link code: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to generate link code")
    finally:
        conn.close()
        
    bot_username = os.environ.get("TELEGRAM_BOT_USERNAME", "KeeptMeBot")
    return {"code": code, "botUsername": bot_username, "expiresAt": expires_at.isoformat()}


@app.post("/api/v1/keept/telegram/complete-link")
async def complete_telegram_link(
    payload: CompleteTelegramLinkPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    verify_internal_access(request, x_api_key, authorization)
    code = payload.code.strip()
    tg_user_id = str(payload.telegramUserId).strip()
    chat_id = str(payload.chatId).strip()
    
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT user_id, workspace_id, expires_at FROM public.telegram_link_codes WHERE code = %s",
                (code,)
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=400, detail="Invalid link code")
            if row["expires_at"] < datetime.datetime.now(datetime.timezone.utc):
                cur.execute("DELETE FROM public.telegram_link_codes WHERE code = %s", (code,))
                conn.commit()
                raise HTTPException(status_code=400, detail="Expired link code")
            
            user_id = row["user_id"]
            workspace_id = row["workspace_id"]
            
            cur.execute(
                """
                INSERT INTO public.telegram_workspace_links (telegram_user_id, chat_id, workspace_id, user_id, linked_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (chat_id)
                DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id,
                              workspace_id = EXCLUDED.workspace_id,
                              user_id = EXCLUDED.user_id,
                              linked_at = now()
                """,
                (tg_user_id, chat_id, workspace_id, user_id)
            )
            cur.execute("DELETE FROM public.telegram_link_codes WHERE code = %s", (code,))
            conn.commit()
            return {"ok": True, "workspaceId": str(workspace_id)}
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to complete telegram link: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to complete telegram link")

@app.get("/api/v1/keept/telegram/resolve")
async def resolve_telegram_info(
    request: Request,
    chat_id: Optional[str] = Query(None),
    telegram_user_id: Optional[str] = Query(None),
    webhook_secret: Optional[str] = Query(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    verify_internal_access(request, x_api_key, authorization)
    
    workspace_id = None
    user_id = None
    bot_token = None
    
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if webhook_secret:
                # Tier B bot lookup
                # Decrypt bot token using EXTENSION_BOOTSTRAP_SECRET
                secret_key = EXTENSION_BOOTSTRAP_SECRET
                cur.execute(
                    """
                    SELECT workspace_id, user_id, pgp_sym_decrypt(bot_token_encrypted::bytea, %s) AS bot_token
                    FROM public.user_telegram_bots
                    WHERE webhook_secret = %s AND status = 'active'
                    """,
                    (secret_key, webhook_secret.strip())
                )
                row = cur.fetchone()
                if row:
                    workspace_id = row["workspace_id"]
                    user_id = row["user_id"]
                    bot_token = row["bot_token"]
            else:
                # Tier A lookup by chat_id or telegram_user_id
                if chat_id:
                    cur.execute(
                        "SELECT workspace_id, user_id FROM public.telegram_workspace_links WHERE chat_id = %s",
                        (str(chat_id).strip(),)
                    )
                    row = cur.fetchone()
                    if row:
                        workspace_id = row["workspace_id"]
                        user_id = row["user_id"]
                if not workspace_id and telegram_user_id:
                    cur.execute(
                        "SELECT workspace_id, user_id FROM public.telegram_workspace_links WHERE telegram_user_id = %s",
                        (str(telegram_user_id).strip(),)
                    )
                    row = cur.fetchone()
                    if row:
                        workspace_id = row["workspace_id"]
                        user_id = row["user_id"]
                        
                if workspace_id:
                    bot_token = TELEGRAM_BOT_TOKEN
            
            if not workspace_id or not user_id:
                raise HTTPException(status_code=404, detail="Workspace link not found")
                
            # Lookup user email in auth.users
            email = "autoro.tech@gmail.com"
            try:
                cur.execute("SELECT email FROM auth.users WHERE id = %s::uuid", (str(user_id),))
                user_row = cur.fetchone()
                if user_row and user_row.get("email"):
                    email = user_row["email"]
            except Exception as e:
                logger.warning("Failed to fetch email from auth.users: %s", e)
                
            return {
                "workspace_id": str(workspace_id),
                "user_id": str(user_id),
                "bot_token": bot_token,
                "swoop_user_email": email
            }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to resolve telegram info: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to resolve telegram info")
    finally:
        conn.close()


@app.get("/api/v1/keept/telegram/status")
async def get_telegram_link_status(
    request: Request,
    workspaceId: str = Query(...),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: User identity required")
    
    workspace_id = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)
    
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT chat_id, telegram_user_id, linked_at FROM public.telegram_workspace_links WHERE workspace_id = %s AND user_id = %s LIMIT 1",
                (workspace_id, user_id)
            )
            link = cur.fetchone()
            
            cur.execute(
                "SELECT bot_username, status FROM public.user_telegram_bots WHERE workspace_id = %s AND user_id = %s LIMIT 1",
                (workspace_id, user_id)
            )
            bot = cur.fetchone()
            
            return {
                "linked": bool(link),
                "chatId": link["chat_id"] if link else None,
                "telegramUserId": link["telegram_user_id"] if link else None,
                "customBot": {
                    "username": bot["bot_username"],
                    "status": bot["status"]
                } if bot else None
            }
    except Exception as exc:
        logger.error("Failed to query telegram status: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to get telegram status")
    finally:
        conn.close()


@app.delete("/api/v1/keept/telegram/unlink")
async def unlink_telegram(
    request: Request,
    workspaceId: str = Query(...),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: User identity required")
    
    workspace_id = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)
    
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM public.telegram_workspace_links WHERE workspace_id = %s AND user_id = %s", (workspace_id, user_id))
            cur.execute("DELETE FROM public.user_telegram_bots WHERE workspace_id = %s AND user_id = %s", (workspace_id, user_id))
        conn.commit()
        return {"ok": True}
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to unlink telegram: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to unlink telegram")
    finally:
        conn.close()


@app.post("/api/v1/keept/telegram/bot-token")
async def save_telegram_bot_token(
    payload: SaveTelegramBotTokenPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: User identity required")
    
    workspace_id = parse_required_workspace_id(payload.workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)
    
    token = payload.botToken.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Bot token is required")
        
    try:
        req = UrlRequest(url=f"https://api.telegram.org/bot{token}/getMe", method="GET")
        with urlopen(req, timeout=10) as resp:
            get_me_data = json.loads(resp.read().decode("utf-8"))
            if not get_me_data.get("ok"):
                raise HTTPException(status_code=400, detail="Invalid bot token")
            bot_username = get_me_data["result"]["username"]
    except Exception as exc:
        logger.error("Telegram getMe failed: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid bot token or Telegram API unreachable")
        
    import secrets as pysecrets
    webhook_secret = pysecrets.token_urlsafe(16)
    
    cfg = resolve_telegram_gateway_config()
    n8n_url = cfg["n8nAssistantUrl"]
    if n8n_url:
        from urllib.parse import urlparse
        parsed = urlparse(n8n_url)
        n8n_base = f"{parsed.scheme}://{parsed.netloc}"
        webhook_url = f"{n8n_base}/webhook/keept-telegram/{webhook_secret}"
    else:
        webhook_url = f"https://swoop.autoro.tech/webhook/keept-telegram/{webhook_secret}"
        
    try:
        set_webhook_url = f"https://api.telegram.org/bot{token}/setWebhook?" + urlencode({
            "url": webhook_url,
            "secret_token": webhook_secret
        })
        req = UrlRequest(url=set_webhook_url, method="POST")
        with urlopen(req, timeout=10) as resp:
            set_wh_data = json.loads(resp.read().decode("utf-8"))
            if not set_wh_data.get("ok"):
                raise HTTPException(status_code=400, detail=f"Failed to set Telegram webhook: {set_wh_data.get('description')}")
    except Exception as exc:
        logger.error("Telegram setWebhook failed: %s", exc)
        raise HTTPException(status_code=400, detail="Failed to register bot webhook with Telegram")
        
    secret_key = EXTENSION_BOOTSTRAP_SECRET
    conn = pg_connect_bookmarks()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.user_telegram_bots 
                  (workspace_id, user_id, bot_token_encrypted, bot_username, webhook_secret, status, updated_at)
                VALUES 
                  (%s, %s, pgp_sym_encrypt(%s, %s), %s, %s, 'active', now())
                ON CONFLICT (workspace_id)
                DO UPDATE SET 
                  user_id = EXCLUDED.user_id,
                  bot_token_encrypted = EXCLUDED.bot_token_encrypted,
                  bot_username = EXCLUDED.bot_username,
                  webhook_secret = EXCLUDED.webhook_secret,
                  status = 'active',
                  updated_at = now()
                """,
                (workspace_id, user_id, token, secret_key, bot_username, webhook_secret)
            )
        conn.commit()
        return {"ok": True, "botUsername": bot_username, "webhookUrl": webhook_url}
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to save bot token to database: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to save bot token")
    finally:
        conn.close()


@app.post("/api/v1/telegram/webhook")
async def telegram_webhook_ingest(
    request: Request,
    x_telegram_secret: Optional[str] = Header(None, alias="X-Telegram-Bot-Api-Secret-Token"),
):
    if TELEGRAM_WEBHOOK_SECRET and x_telegram_secret != TELEGRAM_WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid telegram webhook secret")

    update = await request.json()
    message = (
        update.get("message")
        or update.get("edited_message")
        or update.get("channel_post")
        or update.get("edited_channel_post")
    )
    if not isinstance(message, dict):
        return {"ok": True, "ignored": True, "reason": "no_message"}

    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    sender = message.get("from") or {}
    telegram_user_id = sender.get("id")
    workspace_id = resolve_telegram_workspace_id(chat_id, telegram_user_id)
    if workspace_id is None:
        return {"ok": True, "ignored": True, "reason": "unlinked_chat"}
    text = str(message.get("text") or message.get("caption") or "").strip()
    if not text:
        return {"ok": True, "ignored": True, "reason": "empty_text", "workspaceId": str(workspace_id)}

    msg_id = str(message.get("message_id") or "")
    sender = message.get("from") or {}
    sender_name = (
        sender.get("username")
        or " ".join([str(sender.get("first_name") or "").strip(), str(sender.get("last_name") or "").strip()]).strip()
        or str(sender.get("id") or "")
    )
    if sender_name:
        sender_name = f"@{sender_name}" if not str(sender_name).startswith("@") else str(sender_name)

    links = extract_urls_from_text(text)
    first_url = links[0] if links else ""
    source = "telegram"
    if message.get("forward_origin") or message.get("forward_from") or message.get("forward_from_chat"):
        source = "telegram_forward"

    auto_extract = source == "telegram_forward" or _telegram_user_wants_kb_save(text)
    knowledge_row: Dict[str, Any] = {}
    extracted_meta: Optional[Dict[str, Any]] = None
    category = infer_category(first_url, text[:120], text)
    tags = infer_tags(first_url, text[:120], text, category)

    if auto_extract:
        fields = extract_knowledge_target_fields(
            text,
            user_instruction=text if _telegram_user_wants_kb_save(text) and source != "telegram_forward" else None,
            swoop_user_email=HERMES_SINGLE_USER_EMAIL,
        )
        extracted_meta = fields
        if fields.get("should_save", True):
            title_use = _truncate_text(str(fields.get("title") or text.splitlines()[0][:180] or "Telegram message"), 1000)
            content_use = str(fields.get("content") or text).strip()
            cat_use = str(fields.get("content_type") or fields.get("category") or infer_category(first_url, text[:120], text)).strip().lower()
            if cat_use not in {"prompt", "article", "note", "link", "task", "general"}:
                cat_use = infer_category(first_url, text[:120], text)
            tags_use = normalize_tags(fields.get("tags") or [])
            if not tags_use:
                tags_use = infer_tags(first_url, text[:120], content_use, cat_use)
            category = cat_use
            tags = tags_use
            knowledge_row = upsert_telegram_knowledge_item(
                workspace_id=workspace_id,
                source=source,
                original_sender=sender_name,
                title=title_use,
                raw_url=first_url or None,
                text=content_use,
                category=cat_use,
                tags=tags_use,
                ai_summary=str(fields.get("description") or "")[:4000] or None,
            )
        else:
            knowledge_row = {"skipped": True, "reason": "nothing_to_save"}
            category = infer_category(first_url, text[:120], text)
            tags = infer_tags(first_url, text[:120], text, category)
    else:
        category = infer_category(first_url, text[:120], text)
        tags = infer_tags(first_url, text[:120], text, category)
        knowledge_row = upsert_telegram_knowledge_item(
            workspace_id=workspace_id,
            source=source,
            original_sender=sender_name,
            title=text.splitlines()[0][:180] or "Telegram message",
            raw_url=first_url or None,
            text=text,
            category=category,
            tags=tags,
        )

    bookmark_job = {"jobId": None, "accepted": 0, "deduplicated": 0, "queuedTasks": 0}
    should_bookmark = bool(links) and (
        "#bookmark" in text.lower()
        or "#kb" in text.lower()
        or _telegram_user_wants_bookmark_save(text)
        or source == "telegram_forward"
        or category in {"ai-ml", "dev-tools", "marketing", "business"}
    )
    if should_bookmark:
        bookmark_job = enqueue_telegram_urls_as_bookmarks(
            workspace_id=workspace_id,
            chat_id=str(chat_id or "unknown"),
            message_id=msg_id or str(uuid.uuid4()),
            urls=links,
        )

    return {
        "ok": True,
        "workspaceId": str(workspace_id),
        "chatId": str(chat_id) if chat_id is not None else None,
        "messageId": msg_id or None,
        "source": source,
        "category": category,
        "tags": tags,
        "linksCount": len(links),
        "knowledge": knowledge_row,
        "bookmarks": bookmark_job,
        "extracted": extracted_meta,
        "autoExtract": auto_extract,
    }


@app.post("/api/v1/bookmarks/auth/login")
async def bookmarks_auth_login(payload: BookmarkAuthLoginPayload):
    auth = supabase_password_login(payload.email.strip(), payload.password)
    user = auth.get("user") if isinstance(auth.get("user"), dict) else {}
    return {
        "accessToken": auth.get("access_token"),
        "refreshToken": auth.get("refresh_token"),
        "tokenType": auth.get("token_type", "bearer"),
        "expiresIn": auth.get("expires_in"),
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
        },
    }


@app.post("/api/v1/bookmarks/auth/signup")
async def bookmarks_auth_signup(payload: BookmarkAuthLoginPayload):
    auth = supabase_password_signup(payload.email.strip(), payload.password)
    user = auth.get("user") if isinstance(auth.get("user"), dict) else {}
    return {
        "accessToken": auth.get("access_token"),
        "refreshToken": auth.get("refresh_token"),
        "tokenType": auth.get("token_type", "bearer"),
        "expiresIn": auth.get("expires_in"),
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
        },
    }


@app.post("/api/v1/bookmarks/auth/refresh")
async def bookmarks_auth_refresh(payload: BookmarkAuthRefreshPayload):
    auth = supabase_refresh_session(payload.refreshToken.strip())
    user = auth.get("user") if isinstance(auth.get("user"), dict) else {}
    if not user.get("id") and auth.get("access_token"):
        try:
            user = supabase_get_user(str(auth.get("access_token")))
        except HTTPException:
            user = {}
    return {
        "accessToken": auth.get("access_token"),
        "refreshToken": auth.get("refresh_token") or payload.refreshToken.strip(),
        "tokenType": auth.get("token_type", "bearer"),
        "expiresIn": auth.get("expires_in"),
        "user": {
            "id": user.get("id"),
            "email": user.get("email"),
        },
    }


@app.post("/api/v1/bookmarks/bootstrap")
async def bookmarks_bootstrap(
    request: Request,
    payload: Optional[BookmarkBootstrapPayload] = None,
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    settings = load_agent_settings()
    if not settings.get("agent_enabled"):
        raise HTTPException(status_code=503, detail="Agent API is currently disabled")

    client_ip = get_request_ip(request)
    bootstrap_limit = min(max(int(settings.get("agent_rate_limit", 30)), 10), 120)
    if not check_rate_limit(client_ip, bootstrap_limit):
        raise HTTPException(status_code=429, detail=f"Rate limit exceeded ({bootstrap_limit}/min)")

    supabase_user = None
    if authorization and authorization.lower().startswith("bearer "):
        user_token = authorization.split(" ", 1)[1].strip()
        supabase_user = supabase_get_user(user_token)

    issued = issue_extension_access_token(client_ip, user_id=(supabase_user or {}).get("id"))
    return {
        "accessToken": issued["token"],
        "tokenType": "Bearer",
        "expiresIn": max(60, EXTENSION_BOOTSTRAP_TTL_SEC),
        "expiresAt": issued["exp"],
        "clientIp": client_ip,
        "userId": (supabase_user or {}).get("id"),
        "authorized": bool((supabase_user or {}).get("id")),
        "trialBookmarksLimit": BOOKMARKS_UNAUTHORIZED_MAX_ITEMS,
    }


@app.post("/api/v1/bookmarks/sync/start")
async def start_bookmarks_sync(
    payload: BookmarkSyncStartPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)

    if not payload.bookmarks:
        raise HTTPException(status_code=400, detail="bookmarks list is empty")
    incoming_bookmarks = list(payload.bookmarks)
    trial_limited = False
    if (
        BOOKMARKS_UNAUTHORIZED_LIMIT_ENABLED
        and auth_ctx.get("auth_mode") == "bootstrap_token"
        and not auth_ctx.get("user_id")
    ):
        if len(incoming_bookmarks) > BOOKMARKS_UNAUTHORIZED_MAX_ITEMS:
            incoming_bookmarks = incoming_bookmarks[:BOOKMARKS_UNAUTHORIZED_MAX_ITEMS]
            trial_limited = True

    browser_type = payload.profile.browserType.strip().lower()
    allowed_browsers = {"chrome", "edge", "brave", "opera", "firefox"}
    if browser_type not in allowed_browsers:
        raise HTTPException(status_code=400, detail=f"browserType must be one of: {', '.join(sorted(allowed_browsers))}")

    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be a numeric id for now")

    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT to_regclass('public.workspaces')::text AS rel")
            has_workspaces_table = bool((cur.fetchone() or {}).get("rel"))
            if has_workspaces_table:
                cur.execute("SELECT id FROM public.workspaces WHERE id = %s LIMIT 1", (workspace_id,))
                ws = cur.fetchone()
                if not ws:
                    raise HTTPException(status_code=404, detail="Workspace not found")

            cur.execute(
                """
                INSERT INTO public.browser_profiles (workspace_id, browser_type, profile_external_id, display_name, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (workspace_id, browser_type, profile_external_id)
                DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
                RETURNING id
                """,
                (
                    workspace_id,
                    browser_type,
                    payload.profile.profileExternalId,
                    payload.profile.displayName or payload.profile.profileExternalId,
                ),
            )
            profile_id = cur.fetchone()["id"]

            cur.execute(
                """
                INSERT INTO public.bookmark_sync_jobs (workspace_id, profile_id, status, total_items, processed_items, failed_items, created_at)
                VALUES (%s, %s, 'queued', %s, 0, 0, now())
                RETURNING id
                """,
                (workspace_id, profile_id, len(incoming_bookmarks)),
            )
            job_id = cur.fetchone()["id"]

            accepted = 0
            deduplicated = 0
            for item in incoming_bookmarks:
                try:
                    normalized = normalize_url(item.url)
                    url_hash = compute_url_hash(normalized)
                except Exception:
                    continue

                cur.execute(
                    """
                    INSERT INTO public.bookmarks_bro_bookmarks
                      (workspace_id, profile_id, source_bookmark_id, parent_path, title, url, url_normalized, url_hash, first_seen_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                    ON CONFLICT (workspace_id, url_hash)
                    DO UPDATE SET
                      title = EXCLUDED.title,
                      parent_path = EXCLUDED.parent_path,
                      profile_id = EXCLUDED.profile_id,
                      last_seen_at = now(),
                      is_deleted = false,
                      deleted_at = null
                    RETURNING id, (xmax = 0) as inserted
                    """,
                    (
                        workspace_id,
                        profile_id,
                        item.sourceBookmarkId,
                        item.parentPath,
                        item.title.strip(),
                        item.url.strip(),
                        normalized,
                        url_hash,
                    ),
                )
                bookmark_row = cur.fetchone()
                bookmark_id = bookmark_row["id"]
                if bookmark_row["inserted"]:
                    accepted += 1
                else:
                    deduplicated += 1

                cur.execute(
                    """
                    INSERT INTO public.bookmark_job_tasks (job_id, workspace_id, bookmark_id, task_type, status, priority, attempts, max_attempts, available_at, created_at, updated_at)
                    VALUES (%s, %s, %s, 'fetch_content', 'queued', 10, 0, 3, now(), now(), now())
                    """,
                    (job_id, workspace_id, bookmark_id),
                )

            conn.commit()
            return {
                "jobId": str(job_id),
                "accepted": accepted,
                "deduplicated": deduplicated,
                "queuedTasks": accepted + deduplicated,
                "totalReceived": len(incoming_bookmarks),
                "trialLimited": trial_limited,
                "trialLimit": BOOKMARKS_UNAUTHORIZED_MAX_ITEMS if trial_limited else None,
            }
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        logger.error("Failed to start bookmarks sync: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to start bookmarks sync job")
    finally:
        conn.close()


def enqueue_telegram_urls_as_bookmarks(
    workspace_id: int,
    chat_id: str,
    message_id: str,
    urls: List[str],
) -> Dict[str, Any]:
    if not urls:
        return {"jobId": None, "accepted": 0, "deduplicated": 0, "queuedTasks": 0}

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            profile_external_id = f"telegram-chat-{chat_id}"
            display_name = f"Telegram chat {chat_id}"
            cur.execute(
                """
                INSERT INTO public.browser_profiles (workspace_id, browser_type, profile_external_id, display_name, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (workspace_id, browser_type, profile_external_id)
                DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
                RETURNING id
                """,
                (workspace_id, "chrome", profile_external_id, display_name),
            )
            profile_id = cur.fetchone()["id"]

            cur.execute(
                """
                INSERT INTO public.bookmark_sync_jobs (workspace_id, profile_id, status, total_items, processed_items, failed_items, created_at)
                VALUES (%s, %s, 'queued', %s, 0, 0, now())
                RETURNING id
                """,
                (workspace_id, profile_id, len(urls)),
            )
            job_id = cur.fetchone()["id"]
            accepted = 0
            deduplicated = 0

            for idx, url in enumerate(urls):
                try:
                    normalized = normalize_url(url)
                    url_hash = compute_url_hash(normalized)
                except Exception:
                    continue
                title = f"Telegram message {message_id} link #{idx + 1}"
                source_bookmark_id = f"tg-{chat_id}-{message_id}-{idx + 1}"
                cur.execute(
                    """
                    INSERT INTO public.bookmarks_bro_bookmarks
                      (workspace_id, profile_id, source_bookmark_id, parent_path, title, url, url_normalized, url_hash, first_seen_at, last_seen_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now(), now())
                    ON CONFLICT (workspace_id, url_hash)
                    DO UPDATE SET
                      title = EXCLUDED.title,
                      parent_path = EXCLUDED.parent_path,
                      profile_id = EXCLUDED.profile_id,
                      last_seen_at = now(),
                      is_deleted = false,
                      deleted_at = null
                    RETURNING id, (xmax = 0) as inserted
                    """,
                    (
                        workspace_id,
                        profile_id,
                        source_bookmark_id,
                        "telegram/inbox",
                        title,
                        url,
                        normalized,
                        url_hash,
                    ),
                )
                row = cur.fetchone()
                if row["inserted"]:
                    accepted += 1
                else:
                    deduplicated += 1
                cur.execute(
                    """
                    INSERT INTO public.bookmark_job_tasks (job_id, workspace_id, bookmark_id, task_type, status, priority, attempts, max_attempts, available_at, created_at, updated_at)
                    VALUES (%s, %s, %s, 'fetch_content', 'queued', 10, 0, 3, now(), now(), now())
                    """,
                    (job_id, workspace_id, row["id"]),
                )
            conn.commit()
            return {
                "jobId": str(job_id),
                "accepted": accepted,
                "deduplicated": deduplicated,
                "queuedTasks": accepted + deduplicated,
            }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert_telegram_knowledge_item(
    workspace_id: int,
    source: str,
    original_sender: Optional[str],
    title: str,
    raw_url: Optional[str],
    text: str,
    category: str,
    tags: List[str],
    captured_at: Optional[str] = None,
    ai_summary: Optional[str] = None,
) -> Dict[str, Any]:
    canonical_url = normalize_url(raw_url) if raw_url else ""
    content_hash = build_knowledge_content_hash(source, canonical_url, text)
    note_path = resolve_knowledge_obsidian_note_path(workspace_id, content_hash, None)
    if not ai_summary:
        ai_summary = _truncate_text(text.replace("\n", " ").strip(), 4000) if text else ""

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                insert into public.knowledge_items (
                  workspace_id, source, original_sender, title, url, canonical_url,
                  content_text, ai_summary, category, tags, content_hash, status, note_path, created_at
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'to_process', %s, coalesce(%s::timestamptz, now()))
                on conflict (workspace_id, content_hash)
                do update set
                  updated_at = now(),
                  last_seen_at = now(),
                  seen_count = public.knowledge_items.seen_count + 1,
                  title = excluded.title,
                  url = excluded.url,
                  canonical_url = excluded.canonical_url,
                  ai_summary = case when coalesce(excluded.ai_summary, '') <> '' then excluded.ai_summary else public.knowledge_items.ai_summary end,
                  category = coalesce(nullif(excluded.category, ''), public.knowledge_items.category),
                  tags = case when jsonb_array_length(excluded.tags) > 0 then excluded.tags else public.knowledge_items.tags end,
                  note_path = coalesce(excluded.note_path, public.knowledge_items.note_path)
                returning id, seen_count, created_at, updated_at
                """,
                (
                    workspace_id,
                    source,
                    original_sender,
                    _truncate_text(title or "Telegram message", 1000),
                    raw_url or None,
                    canonical_url or None,
                    text,
                    ai_summary or None,
                    _truncate_text(category or "general", 128),
                    psycopg2.extras.Json(tags[:12]),
                    content_hash,
                    _truncate_text(note_path, 4000),
                    captured_at,
                ),
            )
            row = cur.fetchone() or {}
        conn.commit()
        obsidian_sync: Dict[str, Any] = {"ok": False, "skipped": True, "reason": "not_attempted"}
        if text and note_path:
            note_md = build_obsidian_knowledge_note(
                {
                    "workspaceId": str(workspace_id),
                    "source": source,
                    "originalSender": original_sender,
                    "url": raw_url or "",
                    "tags": tags,
                    "status": "to_process",
                    "contentHash": content_hash,
                    "title": title,
                    "aiSummary": ai_summary,
                    "text": text,
                }
            )
            obsidian_sync = sync_knowledge_note_to_obsidian(note_path, note_md, mode="update")
        return {
            "knowledgeItemId": int(row.get("id")) if row.get("id") is not None else None,
            "seenCount": int(row.get("seen_count") or 1),
            "contentHash": content_hash,
            "notePath": note_path,
            "obsidianSync": obsidian_sync,
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/capture")
async def bookmarks_capture(
    payload: BookmarkCapturePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Одна закладка из Hermes/Telegram (после нахождения URL агентом)."""
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    raw_url = str(payload.url or "").strip()
    if not raw_url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        normalized = normalize_url(raw_url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid url: {exc}")

    title = _truncate_text(str(payload.title or normalized or "Bookmark").strip(), 1000)
    parent_path = _truncate_text(str(payload.parentPath or "telegram/hermes").strip(), 1000) or "telegram/hermes"
    source = _truncate_text(str(payload.source or "telegram").strip().lower(), 64) or "telegram"
    capture_id = str(uuid.uuid4())[:12]

    job = enqueue_telegram_urls_as_bookmarks(
        workspace_id=workspace_id,
        chat_id=f"hermes-{source}",
        message_id=capture_id,
        urls=[raw_url],
    )

    url_hash = compute_url_hash(normalized)
    conn = pg_connect()
    bookmark_id: Optional[int] = None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                update public.bookmarks_bro_bookmarks
                set title = %s,
                    parent_path = %s,
                    last_seen_at = now(),
                    is_deleted = false,
                    deleted_at = null
                where workspace_id = %s and url_hash = %s
                returning id
                """,
                (title, parent_path, workspace_id, url_hash),
            )
            row = cur.fetchone()
            bookmark_id = int(row["id"]) if row and row.get("id") is not None else None
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return {
        "ok": True,
        "workspaceId": payload.workspaceId,
        "url": raw_url,
        "title": title,
        "bookmarkId": bookmark_id,
        "syncJob": job,
    }


@app.get("/api/v1/bookmarks/workspaces")
async def list_bookmark_workspaces(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    auth_mode = auth_ctx.get("auth_mode")

    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if auth_mode in ("supabase_user", "bootstrap_token") and user_id:
                cur.execute("SELECT id, name FROM public.workspaces WHERE owner_id = %s ORDER BY id ASC", (user_id,))
                items = cur.fetchall() or []
                return {
                    "items": [{"id": str(row["id"]), "name": row["name"] or f"Workspace {row['id']}"} for row in items],
                    "count": len(items),
                }
            else:
                cur.execute("SELECT id, name FROM public.workspaces ORDER BY id ASC LIMIT 1000")
                items = cur.fetchall() or []
                return {
                    "items": [{"id": str(row["id"]), "name": row["name"] or f"Workspace {row['id']}"} for row in items],
                    "count": len(items),
                }
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/workspaces/ensure")
async def ensure_bookmark_workspace(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """
    Ensures at least one workspace exists in Bookmarks storage and returns it.
    This is used by BB UI to avoid hardcoded client workspace ids.
    """
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    user_id = auth_ctx.get("user_id")
    auth_mode = auth_ctx.get("auth_mode")

    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.workspaces (
                  id bigserial PRIMARY KEY,
                  owner_id uuid,
                  name text NOT NULL DEFAULT 'Default Workspace',
                  created_at timestamptz NOT NULL DEFAULT now(),
                  updated_at timestamptz NOT NULL DEFAULT now()
                )
                """
            )
            
            if auth_mode in ("supabase_user", "bootstrap_token") and user_id:
                cur.execute("SELECT id, name FROM public.workspaces WHERE owner_id = %s ORDER BY id ASC LIMIT 1", (user_id,))
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        """
                        INSERT INTO public.workspaces(owner_id, name)
                        VALUES (%s, 'Default Workspace')
                        RETURNING id, name
                        """,
                        (user_id,)
                    )
                    row = cur.fetchone()
                conn.commit()
                return {
                    "workspaceId": str(row["id"]),
                    "workspaceName": row["name"] or f"Workspace {row['id']}",
                }
            else:
                cur.execute("SELECT id, name FROM public.workspaces ORDER BY id ASC LIMIT 1")
                row = cur.fetchone()
                if not row:
                    cur.execute(
                        """
                        INSERT INTO public.workspaces(name)
                        VALUES ('Default Workspace')
                        RETURNING id, name
                        """
                    )
                    row = cur.fetchone()
                conn.commit()
                return {
                    "workspaceId": str(row["id"]),
                    "workspaceName": row["name"] or f"Workspace {row['id']}",
                }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


@app.get("/api/v1/bookmarks/sync/jobs/{job_id}")
async def get_bookmark_sync_job(
    job_id: str,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    verify_bookmarks_access(request, x_api_key, authorization)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT id, status, total_items, processed_items, failed_items, created_at, started_at, finished_at, error
                FROM public.bookmark_sync_jobs
                WHERE id = %s
                LIMIT 1
                """,
                (job_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Sync job not found")
            return {
                "jobId": str(row["id"]),
                "status": row["status"],
                "totalItems": row["total_items"],
                "processedItems": row["processed_items"],
                "failedItems": row["failed_items"],
                "createdAt": str(row["created_at"]) if row.get("created_at") else None,
                "startedAt": str(row["started_at"]) if row.get("started_at") else None,
                "finishedAt": str(row["finished_at"]) if row.get("finished_at") else None,
                "error": row.get("error"),
            }
    finally:
        conn.close()


@app.get("/api/v1/bookmarks/metrics")
async def get_bookmark_metrics(
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    workspaceId: Optional[str] = None,
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    ws_only = parse_optional_workspace_id(workspaceId)
    if ws_only is None and auth_ctx.get("auth_mode") not in ("dev_bypass", "api_key", "env_api_key"):
        raise HTTPException(status_code=400, detail="workspaceId is required")
    if ws_only is not None:
        verify_workspace_membership(auth_ctx, ws_only)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            job_where = ""
            task_where = ""
            bookmark_where = "WHERE b.is_deleted = false"
            page_where = ""
            params_jobs: List[Any] = []
            params_tasks: List[Any] = []
            params_bookmarks: List[Any] = []
            params_pages: List[Any] = []

            if ws_only is not None:
                job_where = "WHERE workspace_id = %s"
                task_where = "WHERE workspace_id = %s"
                bookmark_where += " AND b.workspace_id = %s"
                page_where = "WHERE pc.workspace_id = %s"
                params_jobs.append(ws_only)
                params_tasks.append(ws_only)
                params_bookmarks.append(ws_only)
                params_pages.append(ws_only)

            cur.execute(
                f"""
                SELECT
                  count(*) AS total_jobs,
                  count(*) FILTER (WHERE status = 'queued') AS queued_jobs,
                  count(*) FILTER (WHERE status = 'running') AS running_jobs,
                  count(*) FILTER (WHERE status = 'completed') AS completed_jobs,
                  count(*) FILTER (WHERE status = 'partial') AS partial_jobs,
                  count(*) FILTER (WHERE failed_items > 0) AS jobs_with_failures
                FROM public.bookmark_sync_jobs
                {job_where}
                """,
                tuple(params_jobs),
            )
            jobs = dict(cur.fetchone() or {})

            cur.execute(
                f"""
                SELECT
                  count(*) AS total_tasks,
                  count(*) FILTER (WHERE status = 'queued') AS queued_tasks,
                  count(*) FILTER (WHERE status = 'running') AS running_tasks,
                  count(*) FILTER (WHERE status = 'retry') AS retry_tasks,
                  count(*) FILTER (WHERE status = 'done') AS done_tasks,
                  count(*) FILTER (WHERE status = 'failed') AS failed_tasks
                FROM public.bookmark_job_tasks
                {task_where}
                """,
                tuple(params_tasks),
            )
            tasks = dict(cur.fetchone() or {})

            cur.execute(
                f"""
                SELECT count(*) AS total_bookmarks
                FROM public.bookmarks_bro_bookmarks b
                {bookmark_where}
                """,
                tuple(params_bookmarks),
            )
            bookmarks = dict(cur.fetchone() or {})

            cur.execute(
                f"""
                SELECT
                  count(*) AS fetched_total,
                  count(*) FILTER (WHERE fetch_status = 'ok') AS fetched_ok,
                  count(*) FILTER (WHERE fetch_status = 'blocked') AS blocked_total,
                  count(*) FILTER (WHERE fetch_status = 'failed') AS failed_total,
                  count(*) FILTER (WHERE summary IS NOT NULL AND summary <> '') AS enriched_total,
                  count(*) FILTER (WHERE embedding IS NOT NULL) AS embedded_total
                FROM public.bookmark_page_content pc
                {page_where}
                """,
                tuple(params_pages),
            )
            page_content = dict(cur.fetchone() or {})

            cur.execute(
                f"""
                SELECT id, status, total_items, processed_items, failed_items, created_at, started_at, finished_at
                FROM public.bookmark_sync_jobs
                {job_where}
                ORDER BY created_at DESC
                LIMIT 5
                """,
                tuple(params_jobs),
            )
            recent_jobs = [
                {
                    "jobId": str(row["id"]),
                    "status": row["status"],
                    "totalItems": row["total_items"],
                    "processedItems": row["processed_items"],
                    "failedItems": row["failed_items"],
                    "createdAt": str(row["created_at"]) if row.get("created_at") else None,
                    "startedAt": str(row["started_at"]) if row.get("started_at") else None,
                    "finishedAt": str(row["finished_at"]) if row.get("finished_at") else None,
                }
                for row in (cur.fetchall() or [])
            ]

            return {
                "workspaceIdFilter": str(ws_only) if ws_only is not None else None,
                "jobs": jobs,
                "tasks": tasks,
                "bookmarks": bookmarks,
                "content": page_content,
                "recentJobs": recent_jobs,
            }
    finally:
        conn.close()


@app.get("/api/v1/bookmarks/library/facets")
async def bookmarks_library_facets(
    request: Request,
    workspaceId: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Категории и теги для фильтров библиотеки (по обогащённым закладкам)."""
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    ws = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, ws)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT DISTINCT trim(pc.category) AS category
                FROM public.bookmark_page_content pc
                JOIN public.bookmarks_bro_bookmarks b ON b.id = pc.bookmark_id
                WHERE b.workspace_id = %s AND b.is_deleted = false
                  AND pc.category IS NOT NULL AND trim(pc.category) <> ''
                ORDER BY 1
                LIMIT 500
                """,
                (ws,),
            )
            categories = [str(r["category"]) for r in (cur.fetchall() or []) if r.get("category")]

            cur.execute(
                """
                SELECT DISTINCT trim(t.val) AS tag
                FROM public.bookmark_page_content pc
                JOIN public.bookmarks_bro_bookmarks b ON b.id = pc.bookmark_id
                CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(pc.tags, '[]'::jsonb)) AS t(val)
                WHERE b.workspace_id = %s AND b.is_deleted = false
                  AND trim(t.val) <> ''
                ORDER BY 1
                LIMIT 2000
                """,
                (ws,),
            )
            tags = [str(r["tag"]) for r in (cur.fetchall() or []) if r.get("tag")]

            return {"workspaceId": str(ws), "categories": categories, "tags": tags}
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/token-usage/log")
async def log_bookmark_token_usage(
    payload: BookmarkTokenUsageLogPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    workspace_id = parse_required_workspace_id(payload.workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)

    prompt_tokens = max(0, int(payload.promptTokens or 0))
    completion_tokens = max(0, int(payload.completionTokens or 0))
    total_tokens = (
        max(0, int(payload.totalTokens))
        if payload.totalTokens is not None
        else prompt_tokens + completion_tokens
    )

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.bookmarks_token_usage
                  (workspace_id, user_id, auth_mode, task_name, model, provider, prompt_tokens, completion_tokens, total_tokens, meta, updated_at)
                VALUES
                  (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, now())
                RETURNING id, created_at
                """,
                (
                    workspace_id,
                    auth_ctx.get("user_id"),
                    auth_ctx.get("auth_mode"),
                    payload.taskName.strip(),
                    (payload.model or "unknown").strip() or "unknown",
                    (payload.provider or "unknown").strip() or "unknown",
                    prompt_tokens,
                    completion_tokens,
                    total_tokens,
                    json.dumps(payload.meta or {}),
                ),
            )
            row = cur.fetchone() or {}
        conn.commit()
        return {
            "id": str(row.get("id")),
            "workspaceId": str(workspace_id),
            "taskName": payload.taskName.strip(),
            "promptTokens": prompt_tokens,
            "completionTokens": completion_tokens,
            "totalTokens": total_tokens,
            "createdAt": str(row.get("created_at")) if row.get("created_at") else None,
        }
    except Exception as exc:
        conn.rollback()
        logger.error("Token usage log failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to log token usage")
    finally:
        conn.close()


@app.get("/api/v1/bookmarks/token-usage")
async def get_bookmark_token_usage(
    request: Request,
    workspaceId: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    taskName: Optional[str] = None,
    limit: int = 100,
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    workspace_id = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)
    limit = max(1, min(int(limit or 100), 500))

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if taskName and taskName.strip():
                cur.execute(
                    """
                    SELECT
                      task_name,
                      sum(prompt_tokens)::bigint AS prompt_tokens,
                      sum(completion_tokens)::bigint AS completion_tokens,
                      sum(total_tokens)::bigint AS total_tokens,
                      max(updated_at) AS updated_at
                    FROM public.bookmarks_token_usage
                    WHERE workspace_id = %s AND task_name = %s
                    GROUP BY task_name
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (workspace_id, taskName.strip(), limit),
                )
            else:
                cur.execute(
                    """
                    SELECT
                      task_name,
                      sum(prompt_tokens)::bigint AS prompt_tokens,
                      sum(completion_tokens)::bigint AS completion_tokens,
                      sum(total_tokens)::bigint AS total_tokens,
                      max(updated_at) AS updated_at
                    FROM public.bookmarks_token_usage
                    WHERE workspace_id = %s
                    GROUP BY task_name
                    ORDER BY updated_at DESC
                    LIMIT %s
                    """,
                    (workspace_id, limit),
                )
            rows = cur.fetchall() or []

            cur.execute(
                """
                SELECT
                  count(*)::bigint AS events_total,
                  coalesce(sum(total_tokens), 0)::bigint AS tokens_total
                FROM public.bookmarks_token_usage
                WHERE workspace_id = %s
                """,
                (workspace_id,),
            )
            totals = cur.fetchone() or {}

        return {
            "workspaceId": str(workspace_id),
            "items": [
                {
                    "taskName": r.get("task_name"),
                    "promptTokens": int(r.get("prompt_tokens") or 0),
                    "completionTokens": int(r.get("completion_tokens") or 0),
                    "totalTokens": int(r.get("total_tokens") or 0),
                    "updatedAt": str(r.get("updated_at")) if r.get("updated_at") else None,
                }
                for r in rows
            ],
            "eventsTotal": int(totals.get("events_total") or 0),
            "tokensTotal": int(totals.get("tokens_total") or 0),
        }
    finally:
        conn.close()


_BB_UI_MAX_ROWS = 500


@app.get("/api/v1/bookmarks/workspace-ui-state")
async def get_bookmarks_workspace_ui_state(
    request: Request,
    workspaceId: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Snapshots идей, напоминаний и карточек KB Bookmarks Bro для workspace."""
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    workspace_id = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT ideas, reminders, knowledge_cards, updated_at
                FROM public.bookmarks_bro_workspace_ui
                WHERE workspace_id = %s
                LIMIT 1
                """,
                (workspace_id,),
            )
            row = cur.fetchone()
        if not row:
            return {
                "workspaceId": str(workspace_id),
                "ideas": [],
                "reminders": [],
                "knowledgeItems": [],
                "updatedAt": None,
            }
        ideas = row.get("ideas") or []
        reminders = row.get("reminders") or []
        kcards = row.get("knowledge_cards") or []
        if not isinstance(ideas, list):
            ideas = []
        if not isinstance(reminders, list):
            reminders = []
        if not isinstance(kcards, list):
            kcards = []
        return {
            "workspaceId": str(workspace_id),
            "ideas": ideas,
            "reminders": reminders,
            "knowledgeItems": kcards,
            "updatedAt": str(row["updated_at"]) if row.get("updated_at") is not None else None,
        }
    finally:
        conn.close()


@app.put("/api/v1/bookmarks/workspace-ui-state")
async def put_bookmarks_workspace_ui_state(
    payload: BookmarkWorkspaceUiStatePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    workspace_id = parse_required_workspace_id(payload.workspaceId)
    verify_workspace_membership(auth_ctx, workspace_id)

    ideas = payload.ideas[:_BB_UI_MAX_ROWS] if payload.ideas else []
    reminders = payload.reminders[:_BB_UI_MAX_ROWS] if payload.reminders else []
    knowledge = payload.knowledgeItems[:_BB_UI_MAX_ROWS] if payload.knowledgeItems else []

    conn = pg_connect_bookmarks()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                INSERT INTO public.bookmarks_bro_workspace_ui
                  (workspace_id, ideas, reminders, knowledge_cards, updated_at)
                VALUES (%s, %s::jsonb, %s::jsonb, %s::jsonb, now())
                ON CONFLICT (workspace_id) DO UPDATE SET
                  ideas = EXCLUDED.ideas,
                  reminders = EXCLUDED.reminders,
                  knowledge_cards = EXCLUDED.knowledge_cards,
                  updated_at = now()
                RETURNING updated_at
                """,
                (
                    workspace_id,
                    json.dumps(ideas),
                    json.dumps(reminders),
                    json.dumps(knowledge),
                ),
            )
            row = cur.fetchone() or {}
        conn.commit()
        return {
            "ok": True,
            "workspaceId": str(workspace_id),
            "updatedAt": str(row.get("updated_at")) if row.get("updated_at") is not None else None,
            "counts": {
                "ideas": len(ideas),
                "reminders": len(reminders),
                "knowledgeItems": len(knowledge),
            },
        }
    except Exception as exc:
        conn.rollback()
        logger.error("workspace-ui-state upsert failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to persist workspace UI state")
    finally:
        conn.close()


@app.get("/api/v1/bookmarks/library")
async def bookmarks_library_list(
    request: Request,
    workspaceId: str,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    q: Optional[str] = None,
    category: Optional[str] = None,
    tag: Optional[str] = None,
    fetchStatus: Optional[str] = None,
    sort: str = "updated",
    order: str = "desc",
    limit: int = 40,
    offset: int = 0,
):
    """
    Список закладок workspace с обогащением: фильтры, сортировка, пагинация.
    sort: title | updated | created
    order: asc | desc
    """
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    ws = parse_required_workspace_id(workspaceId)
    verify_workspace_membership(auth_ctx, ws)
    lim = max(1, min(int(limit or 40), 80))
    off = max(0, int(offset or 0))
    sort_l = (sort or "updated").lower()
    order_l = (order or "desc").lower()
    if sort_l not in ("title", "updated", "created"):
        raise HTTPException(status_code=400, detail="sort must be title|updated|created")
    if order_l not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="order must be asc|desc")

    order_sql = "DESC" if order_l == "desc" else "ASC"
    if sort_l == "title":
        order_by = f"b.title COLLATE \"C\" {order_sql}"
    elif sort_l == "created":
        order_by = f"b.first_seen_at {order_sql} NULLS LAST"
    else:
        order_by = f"COALESCE(pc.updated_at, pc.fetched_at, b.last_seen_at, b.first_seen_at) {order_sql} NULLS LAST"

    like_q = _norm_like(q)
    cat_like = _norm_like(category) if (category or "").strip() else None
    tag_like = _norm_like(tag) if (tag or "").strip() else None
    fs = (fetchStatus or "").strip() or None

    where_clauses = [
        "b.workspace_id = %s",
        "b.is_deleted = false",
    ]
    params: List[Any] = [ws]

    if like_q:
        where_clauses.append(
            "(b.title ILIKE %s OR b.url ILIKE %s OR COALESCE(pc.summary, '') ILIKE %s)"
        )
        params.extend([like_q, like_q, like_q])

    if cat_like:
        where_clauses.append("COALESCE(pc.category, '') ILIKE %s")
        params.append(cat_like)

    if tag_like:
        where_clauses.append(
            """EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(pc.tags, '[]'::jsonb)) AS t(val)
              WHERE t.val ILIKE %s
            )"""
        )
        params.append(tag_like)

    if fs:
        where_clauses.append("COALESCE(pc.fetch_status, '') = %s")
        params.append(fs)

    where_sql = " AND ".join(where_clauses)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS c
                FROM public.bookmarks_bro_bookmarks b
                LEFT JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                WHERE {where_sql}
                """,
                tuple(params),
            )
            total = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                f"""
                SELECT
                  b.id AS bookmark_id,
                  b.title,
                  b.url,
                  b.parent_path,
                  b.first_seen_at,
                  b.last_seen_at,
                  pc.fetch_status,
                  pc.summary,
                  pc.category,
                  pc.tags,
                  pc.fetched_at,
                  pc.updated_at AS content_updated_at
                FROM public.bookmarks_bro_bookmarks b
                LEFT JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                WHERE {where_sql}
                ORDER BY {order_by}
                LIMIT %s OFFSET %s
                """,
                tuple(params + [lim, off]),
            )
            rows = cur.fetchall() or []
            items: List[Dict[str, Any]] = []
            for row in rows:
                tags_raw = row.get("tags")
                if isinstance(tags_raw, str):
                    try:
                        tags_raw = json.loads(tags_raw)
                    except Exception:
                        tags_raw = []
                if not isinstance(tags_raw, list):
                    tags_raw = []
                items.append(
                    {
                        "bookmarkId": str(row["bookmark_id"]),
                        "title": row.get("title"),
                        "url": row.get("url"),
                        "parentPath": row.get("parent_path"),
                        "firstSeenAt": str(row["first_seen_at"]) if row.get("first_seen_at") else None,
                        "lastSeenAt": str(row["last_seen_at"]) if row.get("last_seen_at") else None,
                        "fetchStatus": row.get("fetch_status"),
                        "summary": row.get("summary"),
                        "category": row.get("category"),
                        "tags": [str(t) for t in tags_raw],
                        "fetchedAt": str(row["fetched_at"]) if row.get("fetched_at") else None,
                        "contentUpdatedAt": str(row["content_updated_at"])
                        if row.get("content_updated_at")
                        else None,
                    }
                )

            return {
                "workspaceId": str(ws),
                "total": total,
                "limit": lim,
                "offset": off,
                "sort": sort_l,
                "order": order_l,
                "items": items,
            }
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/pipeline/run")
async def run_bookmark_pipeline(
    payload: BookmarkPipelineRunPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    sync_result = await start_bookmarks_sync(
        BookmarkSyncStartPayload(
            workspaceId=payload.workspaceId,
            profile=payload.profile,
            bookmarks=payload.bookmarks,
        ),
        request,
        x_api_key,
        authorization,
    )
    job_id = str(sync_result["jobId"])

    worker_result = await run_bookmark_worker(
        BookmarkWorkerRunPayload(
            max_tasks=payload.workerMaxTasks,
            workspaceId=payload.workspaceId,
            jobId=job_id,
        ),
        request,
        x_api_key,
        authorization,
    )

    enrich_result = await run_bookmark_enrichment(
        BookmarkWorkerRunPayload(
            max_tasks=payload.enrichMaxTasks,
            workspaceId=payload.workspaceId,
            jobId=job_id,
        ),
        request,
        x_api_key,
        authorization,
    )

    status_result = await get_bookmark_sync_job(job_id, request, x_api_key, authorization)
    metrics_result = await get_bookmark_metrics(request, x_api_key, authorization, workspaceId=payload.workspaceId)

    return {
        "jobId": job_id,
        "sync": sync_result,
        "worker": worker_result,
        "enrich": enrich_result,
        "status": status_result,
        "metrics": metrics_result,
    }


@app.post("/api/v1/bookmarks/worker/run")
async def run_bookmark_worker(
    payload: BookmarkWorkerRunPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    max_tasks = payload.max_tasks
    ws_only = parse_optional_workspace_id(payload.workspaceId)
    if ws_only is None and auth_ctx.get("auth_mode") not in ("dev_bypass", "api_key", "env_api_key"):
        raise HTTPException(status_code=400, detail="workspaceId is required")
    if ws_only is not None:
        verify_workspace_membership(auth_ctx, ws_only)
    job_only = parse_optional_job_id(payload.jobId)

    processed = 0
    succeeded = 0
    failed = 0
    blocked = 0
    retried = 0
    details: List[Dict[str, Any]] = []

    conn = pg_connect()
    try:
        for _ in range(max_tasks):
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                sql = """
                    SELECT t.id, t.job_id, t.workspace_id, t.bookmark_id, t.attempts, t.max_attempts, b.url
                    FROM public.bookmark_job_tasks t
                    JOIN public.bookmarks_bro_bookmarks b ON b.id = t.bookmark_id
                    WHERE t.status IN ('queued', 'retry')
                      AND t.task_type = 'fetch_content'
                      AND t.available_at <= now()
                """
                params = []
                if job_only is not None:
                    sql += " AND t.job_id = %s"
                    params.append(job_only)
                if ws_only is not None:
                    sql += " AND t.workspace_id = %s"
                    params.append(ws_only)
                sql += " ORDER BY t.priority ASC, t.created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED"
                cur.execute(sql, tuple(params))
                task = cur.fetchone()
                if not task:
                    break

                cur.execute(
                    """
                    UPDATE public.bookmark_job_tasks
                    SET status = 'running', updated_at = now()
                    WHERE id = %s
                    """,
                    (task["id"],),
                )
                conn.commit()

            fetch_result = fetch_content_via_jina(task["url"])
            processed += 1

            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if fetch_result["ok"]:
                    raw_text = fetch_result.get("content_text") or ""
                    content_hash = hashlib.sha256(raw_text.encode("utf-8")).hexdigest() if raw_text else None
                    cur.execute(
                        """
                        INSERT INTO public.bookmark_page_content
                          (workspace_id, bookmark_id, fetch_status, http_status, content_text, content_hash, fetched_at, updated_at)
                        VALUES (%s, %s, 'ok', %s, %s, %s, now(), now())
                        ON CONFLICT (bookmark_id)
                        DO UPDATE SET
                          workspace_id = EXCLUDED.workspace_id,
                          fetch_status = 'ok',
                          http_status = EXCLUDED.http_status,
                          content_text = EXCLUDED.content_text,
                          content_hash = EXCLUDED.content_hash,
                          fetched_at = now(),
                          updated_at = now(),
                          fetch_error = null
                        """,
                        (
                            task["workspace_id"],
                            task["bookmark_id"],
                            fetch_result["status_code"],
                            raw_text,
                            content_hash,
                        ),
                    )
                    cur.execute(
                        """
                        UPDATE public.bookmark_job_tasks
                        SET status = 'done', updated_at = now(), last_error = null
                        WHERE id = %s
                        """,
                        (task["id"],),
                    )
                    cur.execute(
                        """
                        UPDATE public.bookmark_sync_jobs
                        SET
                          processed_items = processed_items + 1,
                          status = CASE
                            WHEN started_at IS NULL THEN 'running'
                            ELSE status
                          END,
                          started_at = COALESCE(started_at, now())
                        WHERE id = %s
                        """,
                        (task["job_id"],),
                    )
                    succeeded += 1
                    details.append({"taskId": str(task["id"]), "bookmarkId": task["bookmark_id"], "status": "done"})
                else:
                    next_attempt = task["attempts"] + 1
                    is_final = next_attempt >= task["max_attempts"]
                    if is_final:
                        is_blocked = int(fetch_result.get("status_code") or 0) == 451
                        final_status = 'blocked' if is_blocked else 'failed'
                        cur.execute(
                            """
                            INSERT INTO public.bookmark_page_content
                              (workspace_id, bookmark_id, fetch_status, http_status, fetched_at, fetch_error, updated_at)
                            VALUES (%s, %s, %s, %s, now(), %s, now())
                            ON CONFLICT (bookmark_id)
                            DO UPDATE SET
                              workspace_id = EXCLUDED.workspace_id,
                              fetch_status = EXCLUDED.fetch_status,
                              http_status = EXCLUDED.http_status,
                              fetched_at = now(),
                              fetch_error = EXCLUDED.fetch_error,
                              updated_at = now()
                            """,
                            (task["workspace_id"], task["bookmark_id"], final_status, fetch_result["status_code"], fetch_result["error"]),
                        )
                        cur.execute(
                            """
                            UPDATE public.bookmark_job_tasks
                            SET status = 'failed', attempts = %s, updated_at = now(), last_error = %s
                            WHERE id = %s
                            """,
                            (next_attempt, fetch_result["error"], task["id"]),
                        )
                        cur.execute(
                            """
                            UPDATE public.bookmark_sync_jobs
                            SET
                              processed_items = processed_items + 1,
                              failed_items = failed_items + 1,
                              status = CASE
                                WHEN started_at IS NULL THEN 'running'
                                ELSE status
                              END,
                              started_at = COALESCE(started_at, now())
                            WHERE id = %s
                            """,
                            (task["job_id"],),
                        )
                        if is_blocked:
                            blocked += 1
                            details.append({"taskId": str(task["id"]), "bookmarkId": task["bookmark_id"], "status": "blocked", "error": fetch_result["error"]})
                        else:
                            failed += 1
                            details.append({"taskId": str(task["id"]), "bookmarkId": task["bookmark_id"], "status": "failed", "error": fetch_result["error"]})
                    else:
                        cur.execute(
                            """
                            UPDATE public.bookmark_job_tasks
                            SET status = 'retry',
                                attempts = %s,
                                available_at = now() + interval '30 seconds',
                                updated_at = now(),
                                last_error = %s
                            WHERE id = %s
                            """,
                            (next_attempt, fetch_result["error"], task["id"]),
                        )
                        retried += 1
                        details.append({"taskId": str(task["id"]), "bookmarkId": task["bookmark_id"], "status": "retry", "error": fetch_result["error"]})

                cur.execute(
                    """
                    UPDATE public.bookmark_sync_jobs j
                    SET
                      status = CASE
                        WHEN j.processed_items >= j.total_items AND j.failed_items = 0 THEN 'completed'
                        WHEN j.processed_items >= j.total_items AND j.failed_items > 0 THEN 'partial'
                        ELSE j.status
                      END,
                      finished_at = CASE
                        WHEN j.processed_items >= j.total_items THEN now()
                        ELSE j.finished_at
                      END
                    WHERE j.id = %s
                    """,
                    (task["job_id"],),
                )
                conn.commit()

        return {
            "processed": processed,
            "succeeded": succeeded,
            "failed": failed,
            "blocked": blocked,
            "retried": retried,
            "workspaceIdFilter": str(ws_only) if ws_only is not None else None,
            "jobIdFilter": job_only,
            "details": details[:50],
        }
    except Exception as exc:
        conn.rollback()
        logger.error("Bookmark worker failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Bookmark worker failed: {str(exc)}")
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/enrich/run")
async def run_bookmark_enrichment(
    payload: BookmarkWorkerRunPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    limit = payload.max_tasks
    ws_only = parse_optional_workspace_id(payload.workspaceId)
    if ws_only is None and auth_ctx.get("auth_mode") not in ("dev_bypass", "api_key", "env_api_key"):
        raise HTTPException(status_code=400, detail="workspaceId is required")
    if ws_only is not None:
        verify_workspace_membership(auth_ctx, ws_only)
    processed = 0
    enrich_failed = 0
    max_llm = bookmarks_ai_enrich_max_calls_per_run()
    llm_attempts = 0
    llm_summaries = 0
    local_summaries = 0
    embeddings_computed = 0
    embeddings_missing = 0
    ai_flag = is_bookmarks_ai_enrich_enabled()
    has_keys = has_any_bookmark_llm_keys()

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if ws_only is not None:
                cur.execute(
                    """
                    SELECT
                      b.id as bookmark_id,
                      b.title,
                      b.url,
                      coalesce(pc.content_text, '') as content_text
                    FROM public.bookmarks_bro_bookmarks b
                    JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                    WHERE b.is_deleted = false
                      AND b.workspace_id = %s
                      AND pc.fetch_status = 'ok'
                      AND (pc.summary is null OR pc.summary = '')
                    ORDER BY b.last_seen_at DESC
                    LIMIT %s
                    """,
                    (ws_only, limit),
                )
            else:
                cur.execute(
                    """
                    SELECT
                      b.id as bookmark_id,
                      b.title,
                      b.url,
                      coalesce(pc.content_text, '') as content_text
                    FROM public.bookmarks_bro_bookmarks b
                    JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                    WHERE b.is_deleted = false
                      AND pc.fetch_status = 'ok'
                      AND (pc.summary is null OR pc.summary = '')
                    ORDER BY b.last_seen_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
            rows = cur.fetchall()

        for row in rows:
            try:
                enriched = None
                allow_llm = ai_flag and has_keys and (max_llm == 0 or llm_attempts < max_llm)
                if allow_llm:
                    enriched = ai_enrich_bookmark(row["url"], row["title"], row["content_text"])
                    llm_attempts += 1
                if enriched:
                    llm_summaries += 1
                    logger.info("Enrich: LLM summary for bookmark_id=%s", row["bookmark_id"])
                else:
                    enriched = local_enrich_bookmark(row["url"], row["title"], row["content_text"])
                    local_summaries += 1
                    logger.info("Enrich: local heuristics for bookmark_id=%s", row["bookmark_id"])
                embedding = get_openai_embedding(
                    f"{row['title']}\n{row['url']}\n{enriched['summary']}\n{' '.join(enriched['tags'])}"
                )
                with conn.cursor() as cur:
                    if embedding:
                        embeddings_computed += 1
                        cur.execute(
                            """
                            UPDATE public.bookmark_page_content
                            SET
                              summary = %s,
                              category = %s,
                              tags = %s::jsonb,
                              embedding = %s::vector,
                              enriched_at = now(),
                              updated_at = now()
                            WHERE bookmark_id = %s
                            """,
                            (
                                enriched["summary"],
                                enriched["category"],
                                json.dumps(enriched["tags"]),
                                build_vector_literal(embedding),
                                row["bookmark_id"],
                            ),
                        )
                    else:
                        embeddings_missing += 1
                        cur.execute(
                            """
                            UPDATE public.bookmark_page_content
                            SET
                              summary = %s,
                              category = %s,
                              tags = %s::jsonb,
                              enriched_at = now(),
                              updated_at = now()
                            WHERE bookmark_id = %s
                            """,
                            (
                                enriched["summary"],
                                enriched["category"],
                                json.dumps(enriched["tags"]),
                                row["bookmark_id"],
                            ),
                        )
                processed += 1
            except Exception as row_exc:
                conn.rollback()
                enrich_failed += 1
                logger.warning(
                    "Enrich skipped bookmark_id=%s: %s",
                    row.get("bookmark_id"),
                    row_exc,
                )
        conn.commit()

        return {
            "processed": processed,
            "requested": limit,
            "workspaceIdFilter": str(ws_only) if ws_only is not None else None,
            "failedBookmarks": enrich_failed,
            "aiEnrichEnabled": ai_flag,
            "hasLlmKeys": has_keys,
            "maxLlmAttemptsPerRun": max_llm if max_llm > 0 else None,
            "llmAttempts": llm_attempts,
            "llmSummaries": llm_summaries,
            "localSummaries": local_summaries,
            "embeddingsComputed": embeddings_computed,
            "embeddingsMissing": embeddings_missing,
        }
    except Exception as exc:
        conn.rollback()
        logger.error("Bookmark enrichment failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Bookmark enrichment failed: {str(exc)}")
    finally:
        conn.close()


@app.post("/api/v1/bookmarks/search")
async def bookmark_search(
    payload: BookmarkSearchPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if payload.semantic:
                query_embedding = get_openai_embedding(payload.query)
                if query_embedding:
                    vec = build_vector_literal(query_embedding)
                    cur.execute(
                        """
                        SELECT
                          b.id,
                          b.title,
                          b.url,
                          coalesce(pc.summary, '') as summary,
                          coalesce(pc.category, 'general') as category,
                          coalesce(pc.tags, '[]'::jsonb) as tags,
                          (pc.embedding <-> %s::vector) as distance
                        FROM public.bookmarks_bro_bookmarks b
                        LEFT JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                        WHERE b.workspace_id = %s
                          AND b.is_deleted = false
                          AND pc.embedding IS NOT NULL
                        ORDER BY pc.embedding <-> %s::vector ASC
                        LIMIT %s
                        """,
                        (vec, workspace_id, vec, payload.limit),
                    )
                    rows = cur.fetchall()
                    return {
                        "mode": "semantic",
                        "query": payload.query,
                        "items": [
                            {
                                "bookmarkId": r["id"],
                                "title": r["title"],
                                "url": r["url"],
                                "summary": r["summary"],
                                "category": r["category"],
                                "tags": r["tags"],
                                "distance": float(r["distance"]) if r.get("distance") is not None else None,
                            }
                            for r in rows
                        ],
                    }

            like = f"%{payload.query.lower()}%"
            cur.execute(
                """
                SELECT
                  b.id,
                  b.title,
                  b.url,
                  coalesce(pc.summary, '') as summary,
                  coalesce(pc.category, 'general') as category,
                  coalesce(pc.tags, '[]'::jsonb) as tags
                FROM public.bookmarks_bro_bookmarks b
                LEFT JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                WHERE b.workspace_id = %s
                  AND b.is_deleted = false
                  AND (
                    lower(b.title) LIKE %s
                    OR lower(b.url) LIKE %s
                    OR lower(coalesce(pc.summary, '')) LIKE %s
                    OR lower(coalesce(pc.content_text, '')) LIKE %s
                  )
                ORDER BY b.last_seen_at DESC
                LIMIT %s
                """,
                (workspace_id, like, like, like, like, payload.limit),
            )
            rows = cur.fetchall()
            return {
                "mode": "text",
                "query": payload.query,
                "items": [
                    {
                        "bookmarkId": r["id"],
                        "title": r["title"],
                        "url": r["url"],
                        "summary": r["summary"],
                        "category": r["category"],
                        "tags": r["tags"],
                    }
                    for r in rows
                ],
            }
    finally:
        conn.close()


@app.post("/api/v1/web/search")
async def web_search(
    payload: WebSearchPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Веб-поиск: провайдер выбирается на сервере (ключи Swoop / env)."""
    verify_hermes_agent_access(request, x_api_key, authorization)
    query = payload.query.strip()
    limit = max(1, min(int(payload.limit or 10), 20))
    items = external_web_search_from_settings(query, limit)
    providers = sorted({str(i.get("sourceProvider") or "unknown") for i in items if isinstance(i, dict)})
    return {
        "ok": True,
        "query": query,
        "count": len(items),
        "items": items,
        "providersUsed": providers,
    }


@app.post("/api/v1/vision/analyze")
async def vision_analyze(
    payload: VisionAnalyzePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Распознавание текста и анализ изображения (vision-модели Swoop)."""
    verify_hermes_agent_access(request, x_api_key, authorization)
    if not payload.image_url and not payload.image_base64:
        raise HTTPException(status_code=400, detail="image_url or image_base64 is required")
    from hermes_media import vision_analyze_from_settings

    return vision_analyze_from_settings(
        task=payload.task,
        image_url=payload.image_url,
        image_base64=payload.image_base64,
    )


@app.post("/api/v1/social/parse")
async def social_parse(
    payload: SocialParsePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Метаданные поста / страницы по URL (Open Graph; для закрытых лент — Apify)."""
    verify_hermes_agent_access(request, x_api_key, authorization)
    from hermes_media import social_parse_post_url

    return social_parse_post_url(payload.url)


@app.post("/api/v1/media/transcribe")
async def media_transcribe(
    payload: MediaTranscribePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Транскрипция аудио/видео по URL (Whisper, ключ OpenAI в Swoop)."""
    verify_hermes_agent_access(request, x_api_key, authorization)
    from hermes_media import transcribe_media_url

    return transcribe_media_url(payload.media_url, language=payload.language)


@app.post("/api/v1/bookmarks/ai-recommend")
async def bookmark_ai_recommend(
    payload: BookmarkAiRecommendPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_llm_tier: Optional[str] = Header(None, alias="X-LLM-Tier"),
):
    """
    RAG для закладок: embedding(задача) → ближайшие векторы в БД → LLM выбирает и объясняет.
    Нужны ключи LLM: в env (OPENAI_API_KEY) и/или в service_settings админки (glm, Gemini, OpenRouter и т.д.).
    """
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    if not has_any_bookmark_llm_keys():
        raise HTTPException(
            status_code=503,
            detail="Нет ключей для эмбеддингов и LLM: добавьте ключи в Swoop service_settings или OPENAI_API_KEY в окружении agent-api.",
        )

    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    search_mode_raw = str(payload.searchMode or "bookmarks").strip().lower()
    if search_mode_raw == "kb":
        search_mode = "bookmarks"
    elif search_mode_raw in {"web_research", "fast"}:
        search_mode = "fast"
    elif search_mode_raw == "deep":
        search_mode = "fast"
    else:
        search_mode = search_mode_raw
    if search_mode not in {"fast", "bookmarks", "web", "hybrid"}:
        search_mode = "bookmarks"

    task = payload.task.strip()
    rows: List[Dict[str, Any]] = []
    retrieval_mode = search_mode

    if search_mode in {"bookmarks", "hybrid", "fast"}:
        query_embedding = get_openai_embedding(task)
        if not query_embedding:
            raise HTTPException(
                status_code=503,
                detail="Не удалось получить эмбеддинг задачи (ключи квота/размерность 1536; см. ключи в Swoop или env).",
            )

        vec = build_vector_literal(query_embedding)
        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT
                      b.id,
                      b.title,
                      b.url,
                      coalesce(pc.summary, '') as summary,
                      coalesce(pc.category, 'general') as category,
                      coalesce(pc.tags, '[]'::jsonb) as tags,
                      (pc.embedding <-> %s::vector) as distance
                    FROM public.bookmarks_bro_bookmarks b
                    INNER JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                    WHERE b.workspace_id = %s
                      AND b.is_deleted = false
                      AND pc.embedding IS NOT NULL
                    ORDER BY pc.embedding <-> %s::vector ASC
                    LIMIT %s
                    """,
                    (vec, workspace_id, vec, payload.retrieveLimit),
                )
                rows = cur.fetchall()
                retrieval_mode = "semantic" if search_mode == "bookmarks" else f"{search_mode}_semantic"

                if not rows:
                    needle = _truncate_text(task, 120).lower()
                    like = f"%{needle}%"
                    cur.execute(
                        """
                        SELECT
                          b.id,
                          b.title,
                          b.url,
                          coalesce(pc.summary, '') as summary,
                          coalesce(pc.category, 'general') as category,
                          coalesce(pc.tags, '[]'::jsonb) as tags,
                          NULL::double precision as distance
                        FROM public.bookmarks_bro_bookmarks b
                        LEFT JOIN public.bookmark_page_content pc ON pc.bookmark_id = b.id
                        WHERE b.workspace_id = %s
                          AND b.is_deleted = false
                          AND (
                            lower(b.title) LIKE %s
                            OR lower(b.url) LIKE %s
                            OR lower(coalesce(pc.summary, '')) LIKE %s
                            OR lower(coalesce(pc.content_text, '')) LIKE %s
                          )
                        ORDER BY b.last_seen_at DESC NULLS LAST
                        LIMIT %s
                        """,
                        (workspace_id, like, like, like, like, payload.retrieveLimit),
                    )
                    rows = cur.fetchall()
                    retrieval_mode = "text_fallback" if search_mode == "bookmarks" else f"{search_mode}_text"
        finally:
            conn.close()

    web_rows: List[Dict[str, Any]] = []
    if search_mode in {"web", "hybrid", "fast"}:
        web_rows = external_web_search_from_settings(task, payload.webLimit)
        if search_mode == "web":
            retrieval_mode = "web_fast"
        elif web_rows:
            retrieval_mode = "fast_hybrid" if search_mode == "fast" else "hybrid"

    if not rows and not web_rows:
        return {
            "task": task,
            "workspaceId": payload.workspaceId,
            "retrievalMode": retrieval_mode,
            "candidateCount": 0,
            "notice": "Нет кандидатов в закладках и внешнем поиске. Сделайте Worker → Enrichment или уточните запрос.",
            "overview": "",
            "recommendations": [],
        }

    allowed_ids = {int(r["id"]) for r in rows if r.get("id") is not None}
    slim: List[Dict[str, Any]] = []
    for r in rows:
        tags_val = r.get("tags")
        if isinstance(tags_val, list):
            tags_list = tags_val
        else:
            tags_list = []
        bid = int(r["id"])
        slim.append(
            {
                "candidateId": f"b:{bid}",
                "source": "bookmark",
                "sourceProvider": "bookmark",
                "bookmarkId": bid,
                "title": _truncate_text(str(r.get("title") or ""), 200),
                "url": str(r.get("url") or ""),
                "summary": _truncate_text(str(r.get("summary") or ""), 400),
                "category": str(r.get("category") or "general"),
                "tags": tags_list,
                "distance": float(r["distance"]) if r.get("distance") is not None else None,
            }
        )

    for idx, wr in enumerate(web_rows):
        slim.append(
            {
                "candidateId": f"w:{idx}",
                "source": "web",
                "sourceProvider": str(wr.get("sourceProvider") or "web"),
                "bookmarkId": None,
                "title": _truncate_text(str(wr.get("title") or ""), 200),
                "url": str(wr.get("url") or ""),
                "summary": _truncate_text(str(wr.get("summary") or ""), 400),
                "category": str(wr.get("category") or "external"),
                "tags": wr.get("tags") if isinstance(wr.get("tags"), list) else ["external"],
                "distance": None,
            }
        )

    system_prompt = (
        "You are an AI assistant for the user's saved bookmarks and knowledge base. Based on the TASK, "
        "recommend the most helpful links from the CANDIDATES list that will help solve the user's problem. "
    )
    if payload.autonomy in {"suggest", "act"}:
        system_prompt += (
            "Provide your output strictly as a JSON object with the following keys: "
            '"overview" (string, 2-4 sentences summarizing how the recommended candidates help), '
            '"picks" (array of objects containing { "candidateId": string, "relevance": number from 0 to 1, "reason": string explaining why, max 220 chars }), '
            '"actions" (array of objects representing suggested actions based on the task and recommendations. '
            'Each action must have "type" which can be: '
            '"create_task" (requires "title" and "description"), '
            '"create_knowledge" (requires "title" and "description" containing markdown text), '
            '"create_reminder" (requires "title" and "minutesDelay" like 60 or 1440), or '
            '"modify_tags" (requires "bookmarkId" and "tags" array of strings). '
            'Also include a "reason" string for each action explaining why it is recommended). '
        )
    else:
        system_prompt += (
            "Provide your output strictly as a JSON object with the following keys: "
            '"overview" (string, 2-4 sentences summarizing how the recommended candidates help), '
            '"picks" (array of objects containing { "candidateId": string, "relevance": number from 0 to 1, "reason": string explaining why, max 220 chars }). '
        )
    system_prompt += (
        f"Do not exceed {payload.maxPicks} items in the picks array. Only use candidateIds from the input list. "
        "Sort picks by relevance in descending order. If no candidate is relevant, return an empty picks array and explain why in overview."
    )
    user_prompt = "TASK:\n" + task + "\n\nCANDIDATES_JSON:\n" + json.dumps(slim, ensure_ascii=False)

    tier_hdr = (x_llm_tier or "").strip().lower()
    if tier_hdr in _LLM_TIER_NAMES:
        tier_override = tier_hdr
    else:
        depth_raw = str(payload.depth or "quick").strip().lower()
        if depth_raw == "deep":
            tier_override = "reasoning"
        else:
            tier_override = "fast"

    llm_res = openai_chat_json_object(
        system_prompt,
        user_prompt,
        tier_override=tier_override,
        route_provider_override=payload.llm_provider,
        route_model_override=payload.llm_model,
        swoop_user_email=swoop_user_email,
    )
    parsed = llm_res.data
    if not parsed:
        raise HTTPException(status_code=502, detail="LLM ranking failed (OpenAI error or empty response).")

    overview = str(parsed.get("overview") or "").strip()
    raw_picks = parsed.get("picks")
    if not isinstance(raw_picks, list):
        raw_picks = []

    by_candidate: Dict[str, Dict[str, Any]] = {str(x["candidateId"]): x for x in slim}
    recommendations: List[Dict[str, Any]] = []
    for item in raw_picks[: payload.maxPicks]:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("candidateId") or "").strip()
        if not cid:
            continue
        row = by_candidate.get(cid)
        if not row:
            continue
        if row.get("source") == "bookmark":
            bid = row.get("bookmarkId")
            if bid is None or int(bid) not in allowed_ids:
                continue
        rel = item.get("relevance")
        try:
            relevance_f = float(rel) if rel is not None else None
        except (TypeError, ValueError):
            relevance_f = None
        if relevance_f is not None:
            relevance_f = max(0.0, min(1.0, relevance_f))
            # In hybrid mode prefer user's own bookmarks over web results.
            if search_mode == "hybrid" and str(row.get("source")) == "bookmark":
                relevance_f = min(1.0, relevance_f + 0.08)
        recommendations.append(
            {
                "candidateId": cid,
                "source": row.get("source") or "bookmark",
                "sourceProvider": row.get("sourceProvider") or (row.get("source") or "bookmark"),
                "bookmarkId": row.get("bookmarkId"),
                "title": row.get("title"),
                "url": row.get("url"),
                "summary": row.get("summary"),
                "category": row.get("category"),
                "tags": row.get("tags"),
                "relevance": relevance_f,
                "reason": _truncate_text(str(item.get("reason") or ""), 400),
                "vectorDistance": float(row["distance"]) if row.get("distance") is not None else None,
            }
        )

    swoop_cfg = load_swoop_llm_key_settings()
    route_model = str(llm_res.model_resolved or "").strip()
    route_parts = [route_model] if route_model else []
    if llm_res.provider_used:
        route_parts.insert(0, llm_res.provider_used)
    route_header = " ".join(route_parts) if route_parts else ""
    model_hints = [
        m
        for m in [
            route_model,
            f"{llm_res.provider_used}/{route_model}" if llm_res.provider_used and route_model else "",
            str(swoop_cfg.get("openrouter_default_model") or "").strip(),
            str(swoop_cfg.get("openrouter_qwen_model") or "").strip(),
        ]
        if m
    ]

    actions: List[Dict[str, Any]] = []
    if payload.autonomy in {"suggest", "act"}:
        raw_actions = parsed.get("actions")
        if isinstance(raw_actions, list):
            for item in raw_actions:
                if not isinstance(item, dict):
                    continue
                atype = str(item.get("type") or "").strip().lower()
                if atype not in {"create_task", "create_knowledge", "create_reminder", "modify_tags"}:
                    continue
                
                bid = item.get("bookmarkId")
                if isinstance(bid, str) and bid.startswith("b:"):
                    try:
                        bid = int(bid[2:])
                    except ValueError:
                        pass
                try:
                    if bid is not None:
                        bid = int(bid)
                except (ValueError, TypeError):
                    bid = None

                actions.append({
                    "type": atype,
                    "title": str(item.get("title") or "").strip(),
                    "description": str(item.get("description") or "").strip(),
                    "bookmarkId": bid,
                    "tags": [str(t).strip() for t in item.get("tags") or [] if str(t).strip()],
                    "minutesDelay": int(item.get("minutesDelay")) if item.get("minutesDelay") is not None else None,
                    "reason": str(item.get("reason") or "").strip()
                })

    body = {
        "task": task,
        "workspaceId": payload.workspaceId,
        "retrievalMode": retrieval_mode,
        "candidateCount": len(slim),
        "overview": overview,
        "recommendations": recommendations,
        "actions": actions,
        "modelHints": list(dict.fromkeys(model_hints)),
    }
    headers = {
        "X-LLM-Tier": llm_res.tier or "",
        "X-LLM-Route": route_header,
    }
    return JSONResponse(content=body, headers={k: v for k, v in headers.items() if v})


class BookmarkModifyTagsPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    bookmarkId: int
    tags: List[str]


@app.post("/api/v1/bookmarks/modify-tags")
async def bookmark_modify_tags(
    payload: BookmarkModifyTagsPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM public.bookmarks_bro_bookmarks WHERE id = %s AND workspace_id = %s AND is_deleted = false",
                (payload.bookmarkId, workspace_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Bookmark not found in workspace")

            cur.execute(
                """
                INSERT INTO public.bookmark_page_content (bookmark_id, tags)
                VALUES (%s, %s::jsonb)
                ON CONFLICT (bookmark_id)
                DO UPDATE SET tags = %s::jsonb
                """,
                (payload.bookmarkId, json.dumps(payload.tags), json.dumps(payload.tags)),
            )
            conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@app.get("/v1/models")
@app.get("/api/v1/models")
async def list_openai_models(
    request: Request,
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """OpenAI-compatible models list for Hermes / OpenAI SDK health checks."""
    verify_bookmarks_access(request, x_api_key, authorization)
    swoop = load_swoop_llm_key_settings()
    merged = build_openai_models_list(swoop)
    return {"object": "list", "data": merged}


@app.post("/v1/chat/completions")
@app.post("/api/v1/chat/completions")
async def chat_completions_openai_compatible(
    request: Request,
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """
    Стандартная ручка OpenAI chat completions с поддержкой пулов и групп ключей Swoop.
    """
    verify_bookmarks_access(request, x_api_key, authorization)

    try:
        payload = await request.json()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {e}")

    messages = payload.get("messages") or []
    if not messages:
        raise HTTPException(status_code=400, detail="messages field is required and cannot be empty")

    model = payload.get("model") or ""
    temperature = payload.get("temperature", 0.35)
    response_format = payload.get("response_format")
    max_tokens = payload.get("max_tokens")
    want_stream = bool(payload.get("stream"))

    swoop_user_email = HERMES_SINGLE_USER_EMAIL

    forced_provider = None
    forced_model = None
    model_str = str(model).strip()
    if "/" in model_str:
        parts = model_str.split("/", 1)
        if parts[0].lower() in _LLM_ROUTING_PROVIDERS:
            forced_provider = parts[0].lower()
            forced_model = parts[1]

    res = openai_chat_completions_generic(
        messages=messages,
        temperature=temperature,
        response_format=response_format,
        route_provider_override=forced_provider,
        route_model_override=forced_model,
        swoop_user_email=swoop_user_email,
        max_tokens_override=max_tokens,
        tools=payload.get("tools") if isinstance(payload.get("tools"), list) else None,
        tool_choice=payload.get("tool_choice"),
        hermes_proxy=True,
    )

    if res.content is None and not res.tool_calls:
        if _messages_have_tool_results(messages):
            synth = _synthesize_post_tool_ack(
                _normalize_hermes_proxy_messages(messages)
                if isinstance(messages, list)
                else messages
            )
            if synth.strip():
                res = ChatCompletionsResult(
                    content=synth,
                    tier=res.tier or "general",
                    provider_used=res.provider_used or "synthesized",
                    model_resolved=res.model_resolved or str(model) or "routed-model",
                    finish_reason="stop",
                )
    if res.content is None and not res.tool_calls:
        raise HTTPException(
            status_code=502,
            detail=(
                "All keys/providers from Swoop settings exhausted. "
                f"Last provider tried: {res.provider_used or 'none'}; model: {res.model_resolved or 'none'}."
            )
        )

    import time
    resp_id = f"chatcmpl-{int(time.time())}"
    resolved_model = res.model_resolved or model or "routed-model"

    assistant_msg: Dict[str, Any] = {"role": "assistant", "content": res.content or ""}
    if res.tool_calls:
        assistant_msg["tool_calls"] = res.tool_calls
    finish_reason = res.finish_reason or ("tool_calls" if res.tool_calls else "stop")

    response_body = {
        "id": resp_id,
        "object": "chat.completion",
        "created": int(time.time()),
        "model": resolved_model,
        "choices": [
            {
                "index": 0,
                "message": assistant_msg,
                "logprobs": None,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        },
        "system_fingerprint": "fp_swoop_router"
    }

    headers = {
        "X-LLM-Tier": res.tier,
        "X-LLM-Route": f"{res.provider_used or ''} {resolved_model}".strip(),
    }
    hdr = {k: v for k, v in headers.items() if v}

    if want_stream:
        created = int(time.time())

        async def sse_body():
            stream_text = (res.content or "").strip()
            if not stream_text and res.tool_calls:
                stream_text = " "
            for line in _iter_openai_chat_completion_sse(
                resp_id, created, resolved_model, stream_text
            ):
                yield line

        return StreamingResponse(
            sse_body(),
            media_type="text/event-stream",
            headers={**hdr, "Cache-Control": "no-cache", "Connection": "keep-alive"},
        )

    return JSONResponse(content=response_body, headers=hdr)


@app.post("/api/v1/hermes/run")
async def hermes_run_via_swoop_routing(
    payload: HermesAgentRunPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_llm_tier: Optional[str] = Header(None, alias="X-LLM-Tier"),
    x_swoop_user_email: Optional[str] = Header(None, alias="X-Swoop-User-Email"),
):
    """
    HTTP-обработчик для Hermes-пайплайна n8n:
    - берёт ключи/модели из Swoop service_settings;
    - выбирает tier/route (с поддержкой X-LLM-Tier);
    - использует существующую ротацию ключей в openai_chat_json_object().
    """
    verify_bookmarks_access(request, x_api_key, authorization)

    mode = str(payload.mode or "ask").strip().lower()
    if mode not in {"ask", "research", "optimize", "json", "cursor"}:
        mode = "ask"

    tier_raw = (x_llm_tier or payload.llm_tier or "").strip().lower()
    if tier_raw in _LLM_TIER_NAMES:
        tier_override = tier_raw
    elif mode == "research":
        tier_override = "reasoning"
    elif mode in {"optimize", "json"}:
        tier_override = "fast"
    else:
        tier_override = "general"

    # Один пользователь на текущем этапе: форсируем админский email для детерминированной маршрутизации ключей.
    swoop_user_email = HERMES_SINGLE_USER_EMAIL

    if mode == "cursor":
        answer, meta = _run_cursor_cli(payload.prompt, payload.context)
        return JSONResponse(
            content={
                "ok": True,
                "answer": answer,
                "mode": mode,
                "tier": tier_override,
                "provider": "cursor_cli",
                "model": "",
                "swoop_user_email_used": swoop_user_email,
                "chat_id": payload.chat_id,
                "meta": meta,
            },
            headers={"X-LLM-Tier": tier_override, "X-LLM-Route": "cursor_cli"},
        )

    task_hint = str(payload.prompt or "").strip()
    system_prompt = (
        "Ты Hermes-ассистент. Верни строго JSON-объект без markdown с ключом "
        '"answer" (string, понятный пользователю ответ по-русски). '
        "При необходимости добавь ключи summary и next_steps."
    )
    user_prompt = (
        "MODE:\n"
        f"{mode}\n\n"
        "TASK:\n"
        f"{task_hint}\n\n"
        "CONTEXT_JSON:\n"
        f"{json.dumps(payload.context or {}, ensure_ascii=False)}\n\n"
        "REQUESTED_ROUTE:\n"
        f"provider={payload.llm_provider or ''}; model={payload.llm_model or ''}; "
        f"tier={tier_override}; swoop_user_email={swoop_user_email}"
    )

    chat_max_tokens = 1800 if mode == "research" else 1200
    llm_res = openai_chat_json_object(
        system_prompt,
        user_prompt,
        tier_override=tier_override,
        route_provider_override=payload.llm_provider,
        route_model_override=payload.llm_model,
        swoop_user_email=swoop_user_email,
        max_tokens_override=chat_max_tokens,
    )
    parsed = llm_res.data
    if not parsed:
        raise HTTPException(
            status_code=502,
            detail=(
                "LLM routing failed: all keys/models from Swoop settings exhausted. "
                f"Last tier={llm_res.tier or tier_override}; provider={llm_res.provider_used or 'none'}; "
                f"model={llm_res.model_resolved or 'none'}. "
                "Add keys in Swoop → Global API keys / API key groups or change agent_llm_routing."
            ),
        )

    answer = str(parsed.get("answer") or "").strip()
    if not answer:
        summary = str(parsed.get("summary") or "").strip()
        if summary:
            answer = summary
        else:
            answer = json.dumps(parsed, ensure_ascii=False)

    route_model = str(llm_res.model_resolved or "").strip()
    route_parts = [route_model] if route_model else []
    if llm_res.provider_used:
        route_parts.insert(0, llm_res.provider_used)
    route_header = " ".join(route_parts) if route_parts else ""

    body = {
        "ok": True,
        "answer": answer,
        "mode": mode,
        "tier": llm_res.tier or tier_override,
        "provider": llm_res.provider_used or "",
        "model": route_model,
        "swoop_user_email_used": swoop_user_email,
        "chat_id": payload.chat_id,
    }
    headers = {
        "X-LLM-Tier": llm_res.tier or tier_override,
        "X-LLM-Route": route_header,
    }
    return JSONResponse(content=body, headers={k: v for k, v in headers.items() if v})


_KB_UI_META_MARKERS = (
    "telegram desktop",
    "application screenshot",
    "screenshot of the telegram",
    "screenshot of telegram",
    "left sidebar",
    "desktop client",
    "desktop application",
    "user interface",
    "app-ui",
    "chat window",
    "messaging app",
    "this note describes",
    "this image shows",
    "visual representation",
    "typical user interface",
    "channel navigation",
    "official telegram account",
)


def _is_kb_extract_ui_meta(title: str, content: str) -> bool:
    blob = f"{title}\n{content}".lower()
    hits = sum(1 for m in _KB_UI_META_MARKERS if m in blob)
    if hits >= 2:
        return True
    if (
        "screenshot" in blob
        and "telegram" in blob
        and "http://" not in blob
        and "https://" not in blob
    ):
        return True
    return False


def _strip_vision_wrappers_for_kb(raw: str) -> str:
    text = (raw or "").strip()
    text = re.sub(
        r"\[The user sent an image~[\s\S]*?\]\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\[If you need a closer look[^\]]*\]\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    return text.strip()


def _meaningful_ocr_lines_from_raw(raw: str) -> str:
    body = (raw or "").strip()
    m = re.search(
        r"\[The user sent an image~ Here's what I can see:\s*\n(.*?)\]",
        body,
        re.DOTALL | re.IGNORECASE,
    )
    if m:
        body = (m.group(1) or "").strip()
    else:
        body = _strip_vision_wrappers_for_kb(body)
    kept: List[str] = []
    for ln in body.splitlines():
        line = ln.strip()
        if not line or line.startswith("##"):
            continue
        ll = line.lower()
        if any(m in ll for m in _KB_UI_META_MARKERS):
            continue
        if any(
            p in ll
            for p in (
                "sidebar",
                "chat window",
                "screenshot of",
                "describes a screenshot",
                "illustrates the user interface",
            )
        ):
            continue
        if re.search(r"https?://", line, re.I) or re.search(r"@[\w.]{2,}", line):
            kept.append(line)
        elif len(line) <= 220:
            kept.append(line)
    return "\n".join(dict.fromkeys(kept)).strip()


def _fallback_kb_fields_from_raw(
    raw_text: str,
    user_instruction: Optional[str] = None,
) -> Dict[str, Any]:
    urls = extract_urls_from_text(raw_text or "")
    ocr = _meaningful_ocr_lines_from_raw(raw_text or "")
    content = ocr
    if urls:
        url_block = "\n".join(urls)
        content = f"{ocr}\n\n{url_block}".strip() if ocr else url_block
    if not content:
        content = _strip_vision_wrappers_for_kb(raw_text or "")
    title = (user_instruction or "").strip()
    if len(title) > 120:
        title = title[:120]
    if urls:
        try:
            from urllib.parse import urlparse

            host = (urlparse(urls[0]).netloc or urls[0]).replace("www.", "").strip()
            if host:
                title = host[:120]
        except Exception:
            title = urls[0][:120]
    if not title and ocr:
        title = _pick_kb_title_from_ocr(ocr)
    if not title:
        title = "Заметка из Telegram"
    category = "link" if urls else "note"
    return {
        "should_save": True,
        "title": _truncate_text(title, 120),
        "description": (user_instruction or "OCR и ссылки с изображения Telegram.")[:500],
        "content": content[:50000],
        "category": category,
        "content_type": category,
        "tags": ["telegram", "link"] if urls else ["telegram", "ocr"],
        "links": [{"label": u, "url": u} for u in urls[:15]],
        "confidence": 0.55,
        "extract_fallback": True,
        "ui_meta_rejected": True,
    }


KNOWLEDGE_EXTRACT_SYSTEM = (
    "Extract the target knowledge from noisy forwarded or pasted messages for a personal knowledge base. "
    "Return strict JSON only with keys: "
    "title (string, max 120 chars), "
    "description (string, 1-3 sentences), "
    "content (string, full cleaned text to store — only valuable material), "
    "category (one of: prompt, article, note, link, task, general), "
    "content_type (prompt|article|note|link|task|other), "
    "tags (array of 2-6 lowercase strings), "
    "links (array of {label, url} — REQUIRED when the post lists tools, sites, or services: "
    "include every explicit http(s) URL from RAW_MESSAGE; for each named product/service also add "
    "its official https homepage if the text has no URL; use accurate label; omit if unsure), "
    "confidence (number 0-1), "
    "should_save (boolean, false if nothing worth saving). "
    "Drop forward headers, signatures, ads, and unrelated chat noise. "
    "If user instruction is provided, follow it. "
    "STRICT: use only facts present in RAW_MESSAGE. Do not invent URLs, repos, file trees, or UI details. "
    "NEVER title or summarize the Telegram/IDE/messenger chrome (sidebars, chat window, desktop app UI). "
    "For screenshots/social posts: title and content MUST be the post/caption OCR and http(s) URLs — not 'screenshot of Telegram'. "
    "For interview/career/offers prompts use category=prompt and content_type=prompt. "
    "content must be self-contained and ready to reuse as a prompt or note."
)


def _telegram_user_wants_bookmark_save(text: str) -> bool:
    t = (text or "").lower()
    markers = (
        "закладк",
        "bookmark",
        "добавь в заклад",
        "сохрани в заклад",
        "в закладки",
        "add to bookmark",
        "#bookmark",
    )
    return any(m in t for m in markers)


def _telegram_user_wants_kb_save(text: str) -> bool:
    t = (text or "").lower()
    markers = (
        "в бз",
        "в базу",
        "базу знаний",
        "knowledge base",
        "#kb",
        "сохрани",
        "добавь в",
        "запиши в",
        "capture",
    )
    return any(m in t for m in markers)


def extract_knowledge_target_fields(
    raw_text: str,
    user_instruction: Optional[str] = None,
    swoop_user_email: Optional[str] = None,
) -> Dict[str, Any]:
    user_prompt = (
        f"USER_INSTRUCTION:\n{(user_instruction or '').strip() or '(none)'}\n\n"
        f"RAW_MESSAGE:\n{(raw_text or '').strip()[:50000]}"
    )
    res = openai_chat_json_object(
        KNOWLEDGE_EXTRACT_SYSTEM,
        user_prompt,
        tier_override="fast",
        swoop_user_email=swoop_user_email,
    )
    data = res.data if isinstance(res.data, dict) else {}
    if not data:
        return {
            "should_save": True,
            "title": (raw_text or "").splitlines()[0][:120] or "Telegram message",
            "description": (raw_text or "")[:500],
            "content": raw_text,
            "category": "general",
            "content_type": "note",
            "tags": ["telegram"],
            "confidence": 0.3,
            "extract_fallback": True,
        }
    data["extract_fallback"] = False
    return data


@app.post("/api/v1/knowledge/extract-and-capture")
async def knowledge_extract_and_capture(
    payload: KnowledgeExtractCapturePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)
    fields = extract_knowledge_target_fields(
        payload.rawText,
        user_instruction=payload.userInstruction,
        swoop_user_email=HERMES_SINGLE_USER_EMAIL,
    )
    if _is_kb_extract_ui_meta(
        str(fields.get("title") or ""),
        str(fields.get("content") or ""),
    ):
        fields = _fallback_kb_fields_from_raw(payload.rawText or "", payload.userInstruction)
    if not fields.get("should_save", True):
        urls_in_raw = extract_urls_from_text(payload.rawText or "")
        if not urls_in_raw:
            for m in re.finditer(
                r"(?:https?://)?(?:www\.)?"
                r"([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:[a-z]{2,})(?:\.[a-z]{2,})?(?:/[^\s\])<>\"']*)?)",
                payload.rawText or "",
                re.IGNORECASE,
            ):
                frag = (m.group(0) or "").strip().rstrip(".,;:)")
                host = (m.group(1) or "").split("/")[0].lower()
                if host in {"instagram.com", "cdninstagram.com", "facebook.com", "t.me", "example.com"}:
                    continue
                url = frag if frag.lower().startswith("http") else f"https://{frag.lstrip('/')}"
                if url not in urls_in_raw:
                    urls_in_raw.append(url)
        if len((payload.rawText or "").strip()) >= 180:
            fields = {
                "should_save": True,
                "title": _truncate_text(
                    (payload.userInstruction or "Заметка с фото (OCR)").strip()[:120],
                    120,
                ),
                "description": (payload.userInstruction or "Текст с изображения Telegram.")[:500],
                "content": (payload.rawText or "").strip(),
                "category": "link" if urls_in_raw else "note",
                "content_type": "link" if urls_in_raw else "note",
                "tags": ["telegram", "link"] if urls_in_raw else ["telegram", "ocr"],
                "links": [{"label": u, "url": u} for u in urls_in_raw[:15]],
                "confidence": 0.5,
                "extract_fallback": True,
                "ocr_substantial": True,
            }
        elif urls_in_raw:
            fields = {
                "should_save": True,
                "title": _truncate_text(
                    (payload.userInstruction or urls_in_raw[0] or "Ссылка с фото").strip()[:120],
                    120,
                ),
                "description": (payload.userInstruction or "Текст и ссылки с изображения Telegram.")[:500],
                "content": (payload.rawText or "").strip(),
                "category": "link",
                "content_type": "link",
                "tags": ["telegram", "link"],
                "links": [{"label": u, "url": u} for u in urls_in_raw[:15]],
                "confidence": 0.45,
                "extract_fallback": True,
            }
        else:
            return {"ok": True, "saved": False, "reason": "nothing_to_save", "extracted": fields}

    title = _truncate_text(str(fields.get("title") or "Untitled").strip(), 1000)
    content = str(fields.get("content") or payload.rawText).strip()
    if _is_kb_extract_ui_meta(title, content):
        fb = _fallback_kb_fields_from_raw(payload.rawText or "", payload.userInstruction)
        title = _truncate_text(str(fb.get("title") or title).strip(), 1000)
        content = str(fb.get("content") or content).strip()
        if fb.get("category"):
            fields["category"] = fb["category"]
            fields["content_type"] = fb.get("content_type")
        if fb.get("links"):
            fields["links"] = fb["links"]
    # Отсечь типичные галлюцинации extract (шаблон VS Code), если в raw нет этих маркеров
    if content and "visual studio code" in content.lower() and "visual studio code" not in (
        payload.rawText or ""
    ).lower():
        content = (payload.rawText or "").strip() or content
        title = _truncate_text((payload.rawText or "").splitlines()[0][:120] or title, 1000)
    description = _truncate_text(str(fields.get("description") or "").strip(), 4000)
    category = _truncate_text(str(fields.get("content_type") or fields.get("category") or "general").strip().lower(), 128)
    if category not in {"prompt", "article", "note", "link", "task", "general"}:
        category = _truncate_text(str(fields.get("category") or "general").strip().lower(), 128) or "general"

    tags_raw = fields.get("tags") if isinstance(fields.get("tags"), list) else []
    tags = normalize_tags(tags_raw)
    if category and category not in tags:
        tags.insert(0, category)
    for t in ("telegram", payload.source or "telegram"):
        if t and t not in tags:
            tags.append(t)
    tags = list(dict.fromkeys(tags))[:12]

    note_subdir = "Prompts Library" if category == "prompt" else "Knowledge Inbox"
    slug = re.sub(r"[^\w\s-]", "", title, flags=re.UNICODE)
    slug = re.sub(r"[-\s]+", "-", slug.strip()).strip("-").lower()[:80] or "item"
    note_path = f"{note_subdir}/{slug}.md"

    extract_url = str(fields.get("url") or payload.url or "").strip()
    if not extract_url:
        found_urls = extract_urls_from_text(content)
        if found_urls:
            extract_url = found_urls[0]

    ref_links = collect_knowledge_reference_links(
        payload.rawText or "",
        content,
        primary_url=extract_url,
        extracted_links=fields.get("links"),
    )

    cap = KnowledgeCapturePayload(
        workspaceId=payload.workspaceId,
        source=payload.source or "telegram_forward",
        originalSender=payload.originalSender,
        url=extract_url or None,
        title=title,
        text=content,
        aiSummary=description or content[:500],
        category=category,
        tags=tags,
        status="to_process",
        notePath=note_path,
        referenceLinks=ref_links,
        syncReferenceBookmarks=True,
        enrich=True,
    )
    captured = await knowledge_capture(cap, request, x_api_key, authorization)
    return {
        "ok": True,
        "saved": True,
        "extracted": fields,
        "referenceLinks": ref_links,
        "bookmarksSync": captured.get("bookmarksSync") if isinstance(captured, dict) else None,
        "capture": captured,
    }


@app.post("/api/v1/knowledge/capture")
async def knowledge_capture(
    payload: KnowledgeCapturePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    source = _truncate_text(str(payload.source or "unknown").strip().lower(), 64)
    raw_url = str(payload.url or "").strip()
    title = _truncate_text(str(payload.title or raw_url or "Untitled").strip(), 1000)
    text = str(payload.text or "").strip()
    ai_summary = _truncate_text(str(payload.aiSummary or "").strip(), 4000) if payload.aiSummary else ""
    category = _truncate_text(str(payload.category or "general").strip().lower(), 128) or "general"
    tags = [str(t).strip().lower() for t in (payload.tags or []) if str(t).strip()]
    if category and category not in tags:
        tags.insert(0, category)
    tags = list(dict.fromkeys(tags))[:12]

    urls_in_text = extract_urls_from_text(text)
    if not raw_url and urls_in_text:
        raw_url = urls_in_text[0]
    # Любая ссылка в сообщении → обязательно парсинг страницы + семантика (не только URL в Obsidian).
    if raw_url or urls_in_text:
        do_enrich = True
    elif payload.enrich is not None:
        do_enrich = bool(payload.enrich)
    else:
        do_enrich = is_knowledge_pipeline_enrich_enabled()
    enrich_meta: Dict[str, Any] = {"enriched": False}
    security_flagged = False
    finalized: Dict[str, Any] = {}
    if do_enrich:
        finalized = finalize_knowledge_capture_fields(
            raw_url=raw_url,
            title=title,
            text=text,
            ai_summary=ai_summary,
            category=category,
            tags=tags,
            source=source,
        )
        security_flagged = bool(finalized.get("security_flagged"))
        raw_url = str(finalized.get("url") or raw_url).strip()
        canonical_url = str(finalized.get("canonical_url") or "").strip()
        if not canonical_url and raw_url:
            canonical_url = normalize_url(raw_url)
        title = finalized["title"]
        text = finalized["text"]
        ai_summary = finalized.get("ai_summary") or ai_summary
        category = finalized.get("category") or category
        tags = finalized.get("tags") or tags
        enrich_meta = {
            "enriched": not security_flagged,
            "urlFetched": bool(finalized.get("url_fetched")),
            "securityFlagged": security_flagged,
        }
    else:
        canonical_url = normalize_url(raw_url) if raw_url else ""
        sec = screen_capture_content(text)
        if sec.route == "human_review":
            security_flagged = True
            finalized = _build_security_flagged_capture_fields(
                raw_url=raw_url,
                canonical_url=canonical_url,
                title=title,
                merged_text=text,
                security=sec,
            )
            title = finalized["title"]
            text = finalized["text"]
            ai_summary = finalized.get("ai_summary") or ai_summary
            category = finalized.get("category") or category
            tags = finalized.get("tags") or tags
            enrich_meta = {"enriched": False, "securityFlagged": True}
        elif sec.redacted_categories:
            text = sec.text

    if security_flagged:
        status = "pending"
    else:
        status = _truncate_text(str(payload.status or "to_process").strip().lower(), 64) or "to_process"
    content_hash = build_knowledge_content_hash(source, canonical_url, text)
    note_path_explicit = _truncate_text(str(payload.notePath or "").strip(), 4000) if payload.notePath else None
    note_path_resolved = resolve_knowledge_obsidian_note_path(
        workspace_id, content_hash, note_path_explicit
    )
    note_path = _truncate_text(note_path_resolved, 4000)

    conn = pg_connect()
    item_row: Optional[Dict[str, Any]] = None
    moderation_id: Optional[str] = None
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                insert into public.knowledge_items (
                  workspace_id, source, original_sender, title, url, canonical_url,
                  content_text, ai_summary, category, tags, content_hash, status, note_path
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (workspace_id, content_hash)
                do update set
                  updated_at = now(),
                  last_seen_at = now(),
                  seen_count = public.knowledge_items.seen_count + 1,
                  title = excluded.title,
                  url = excluded.url,
                  canonical_url = excluded.canonical_url,
                  content_text = case
                    when length(coalesce(excluded.content_text, '')) > length(coalesce(public.knowledge_items.content_text, ''))
                    then excluded.content_text
                    else public.knowledge_items.content_text
                  end,
                  ai_summary = case when coalesce(excluded.ai_summary, '') <> '' then excluded.ai_summary else public.knowledge_items.ai_summary end,
                  category = coalesce(nullif(excluded.category, ''), public.knowledge_items.category),
                  tags = case when jsonb_array_length(excluded.tags) > 0 then excluded.tags else public.knowledge_items.tags end,
                  status = coalesce(nullif(excluded.status, ''), public.knowledge_items.status),
                  note_path = coalesce(excluded.note_path, public.knowledge_items.note_path)
                returning id, created_at, updated_at, seen_count
                """,
                (
                    workspace_id,
                    source,
                    payload.originalSender,
                    title,
                    raw_url or None,
                    canonical_url or None,
                    text,
                    ai_summary or None,
                    category,
                    psycopg2.extras.Json(tags),
                    content_hash,
                    status,
                    note_path,
                ),
            )
            item_row = cur.fetchone()
            if not item_row:
                raise HTTPException(status_code=500, detail="Failed to upsert knowledge item")

            moderation_id = None
            if security_flagged:
                raw_for_queue = str(finalized.get("raw_text") or text)
                cur.execute(
                    """
                    insert into public.capture_moderation_queue (
                      workspace_id, knowledge_item_id, source, url, original_title,
                      raw_text, redacted_text, redacted_categories, prompt_injection, status
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending_approval')
                    returning id
                    """,
                    (
                        workspace_id,
                        int(item_row["id"]),
                        source,
                        raw_url or None,
                        title,
                        raw_for_queue,
                        text,
                        psycopg2.extras.Json(finalized.get("redacted_categories") or []),
                        bool(finalized.get("prompt_injection")),
                    ),
                )
                mod_row = cur.fetchone()
                moderation_id = str(mod_row["id"]) if mod_row else None
            else:
                embed_source = "\n".join(
                    p
                    for p in (
                        title,
                        ai_summary,
                        (text or "")[:4000],
                    )
                    if p
                )[:8000]
                vec = get_openai_embedding(embed_source)
                if vec and len(vec) == BOOKMARKS_VECTOR_DIM:
                    vec_lit = build_vector_literal(vec)
                    cur.execute(
                        """
                        insert into public.knowledge_vectors (knowledge_item_id, embedding, embedding_model, embedded_at, updated_at)
                        values (%s, %s::vector, %s, now(), now())
                        on conflict (knowledge_item_id)
                        do update set
                          embedding = excluded.embedding,
                          embedding_model = excluded.embedding_model,
                          embedded_at = now(),
                          updated_at = now()
                        """,
                        (
                            int(item_row["id"]),
                            vec_lit,
                            str(load_swoop_llm_key_settings().get("openrouter_default_model") or "embedding-fallback"),
                        ),
                    )
                    cur.execute(
                        """
                        update public.knowledge_items
                        set status = case when status in ('to_process','processed') then 'embedded' else status end,
                            updated_at = now()
                        where id = %s
                        """,
                        (int(item_row["id"]),),
                    )
            conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Knowledge capture failed: {exc}")
    finally:
        conn.close()

    kid = int(item_row["id"]) if item_row else None

    if security_flagged:
        return {
            "ok": True,
            "status": "pending_moderation",
            "workspaceId": payload.workspaceId,
            "knowledgeItemId": kid,
            "moderationId": moderation_id,
            "contentHash": content_hash,
            "seenCount": int(item_row["seen_count"]) if item_row else 1,
            "pipeline": enrich_meta,
            "securityRoute": "human_review",
            "redactedCategories": finalized.get("redacted_categories") or [],
            "promptInjection": bool(finalized.get("prompt_injection")),
            "obsidian": {
                "written": False,
                "skipped": True,
                "reason": "pending_moderation",
            },
        }

    if payload.referenceLinks:
        ref_links = collect_knowledge_reference_links(
            text,
            primary_url=raw_url,
            extracted_links=payload.referenceLinks,
        )
    else:
        ref_links = collect_knowledge_reference_links(text, primary_url=raw_url)
    bookmarks_sync: Dict[str, Any] = {"ok": True, "accepted": 0, "items": []}
    if ref_links and payload.syncReferenceBookmarks is not False and kid:
        bookmarks_sync = sync_knowledge_reference_bookmarks(
            workspace_id,
            ref_links,
            parent_path=f"knowledge/{kid}",
            knowledge_item_id=kid,
        )

    note_markdown = build_obsidian_knowledge_note(
        {
            "workspaceId": str(workspace_id),
            "source": source,
            "originalSender": payload.originalSender,
            "url": raw_url,
            "tags": tags,
            "status": status,
            "contentHash": content_hash,
            "title": title,
            "aiSummary": ai_summary,
            "text": text,
            "capturedAt": payload.capturedAt,
            "referenceLinks": ref_links,
        }
    )
    obsidian_sync = sync_knowledge_note_to_obsidian(note_path, note_markdown, mode="update")
    return {
        "ok": True,
        "workspaceId": payload.workspaceId,
        "knowledgeItemId": kid,
        "contentHash": content_hash,
        "seenCount": int(item_row["seen_count"]) if item_row else 1,
        "referenceLinks": ref_links,
        "bookmarksSync": bookmarks_sync,
        "pipeline": enrich_meta,
        "obsidian": {
            "vaultRootSuggested": knowledge_obsidian_vault_relative_root(workspace_id),
            "notePathSuggested": note_path,
            "written": bool(obsidian_sync.get("ok")),
            "serverWritten": bool(obsidian_sync.get("serverWritten")),
            "localWritten": bool(obsidian_sync.get("localWritten")),
            "sync": obsidian_sync,
            "markdown": note_markdown,
        },
    }


@app.get("/api/v1/keept/moderation/items")
async def keept_moderation_items(
    request: Request,
    workspaceId: str = Query(...),
    status: str = Query("pending_approval"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    status_filter = _truncate_text(status.strip().lower(), 32) or "pending_approval"
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select
                  id, workspace_id, knowledge_item_id, source, url, original_title,
                  redacted_text, redacted_categories, prompt_injection, status, created_at, resolved_at
                from public.capture_moderation_queue
                where workspace_id = %s and status = %s
                order by created_at desc
                limit 100
                """,
                (workspace_id, status_filter),
            )
            rows = cur.fetchall() or []
    finally:
        conn.close()

    items = []
    for row in rows:
        items.append(
            {
                "id": str(row["id"]),
                "workspaceId": row["workspace_id"],
                "knowledgeItemId": row.get("knowledge_item_id"),
                "source": row.get("source"),
                "url": row.get("url"),
                "title": row.get("original_title"),
                "redactedText": row.get("redacted_text"),
                "redactedCategories": row.get("redacted_categories") or [],
                "promptInjection": bool(row.get("prompt_injection")),
                "status": row.get("status"),
                "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
                "resolvedAt": row["resolved_at"].isoformat() if row.get("resolved_at") else None,
            }
        )
    return {"ok": True, "items": items}


@app.post("/api/v1/keept/moderation/resolve")
async def keept_moderation_resolve(
    payload: KeeptModerationResolvePayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    decision = payload.decision.strip().lower()
    if decision not in ("approve", "reject", "approved", "rejected"):
        raise HTTPException(status_code=400, detail="decision must be approve or reject")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select
                  id, workspace_id, knowledge_item_id, source, url, original_title,
                  raw_text, redacted_text, redacted_categories, prompt_injection, status
                from public.capture_moderation_queue
                where id = %s and workspace_id = %s
                limit 1
                """,
                (payload.id, workspace_id),
            )
            mod = cur.fetchone()
            if not mod:
                raise HTTPException(status_code=404, detail="Moderation item not found")
            if mod["status"] != "pending_approval":
                raise HTTPException(status_code=409, detail="Moderation item already resolved")

            kid = mod.get("knowledge_item_id")
            if decision in ("reject", "rejected"):
                cur.execute(
                    """
                    update public.capture_moderation_queue
                    set status = 'rejected', resolved_at = now()
                    where id = %s
                    """,
                    (payload.id,),
                )
                if kid:
                    cur.execute(
                        """
                        update public.knowledge_items
                        set status = 'rejected', updated_at = now()
                        where id = %s and workspace_id = %s
                        """,
                        (int(kid), workspace_id),
                    )
                conn.commit()
                return {"ok": True, "status": "rejected", "moderationId": payload.id, "knowledgeItemId": kid}

            finalized = finalize_knowledge_capture_fields(
                raw_url=str(mod.get("url") or ""),
                title=str(mod.get("original_title") or "Untitled"),
                text=str(mod.get("raw_text") or ""),
                ai_summary="",
                category="general",
                tags=["general"],
                source=str(mod.get("source") or "web"),
                skip_security=True,
            )
            raw_url = str(finalized.get("url") or mod.get("url") or "").strip()
            canonical_url = str(finalized.get("canonical_url") or "").strip()
            title = finalized["title"]
            text = finalized["text"]
            ai_summary = finalized.get("ai_summary") or ""
            category = finalized.get("category") or "general"
            tags = finalized.get("tags") or ["general"]

            if not kid:
                raise HTTPException(status_code=500, detail="Moderation item missing knowledge_item_id")

            cur.execute(
                """
                update public.knowledge_items
                set
                  title = %s,
                  url = %s,
                  canonical_url = %s,
                  content_text = %s,
                  ai_summary = %s,
                  category = %s,
                  tags = %s,
                  status = 'searchable',
                  updated_at = now(),
                  last_seen_at = now()
                where id = %s and workspace_id = %s
                returning note_path, content_hash
                """,
                (
                    title,
                    raw_url or None,
                    canonical_url or None,
                    text,
                    ai_summary or None,
                    category,
                    psycopg2.extras.Json(tags),
                    int(kid),
                    workspace_id,
                ),
            )
            item_row = cur.fetchone()
            if not item_row:
                raise HTTPException(status_code=404, detail="Knowledge item not found for approval")

            note_path = item_row.get("note_path") or resolve_knowledge_obsidian_note_path(
                workspace_id, str(item_row.get("content_hash") or "")
            )
            embed_source = "\n".join(p for p in (title, ai_summary, (text or "")[:4000]) if p)[:8000]
            vec = get_openai_embedding(embed_source)
            if vec and len(vec) == BOOKMARKS_VECTOR_DIM:
                vec_lit = build_vector_literal(vec)
                cur.execute(
                    """
                    insert into public.knowledge_vectors (knowledge_item_id, embedding, embedding_model, embedded_at, updated_at)
                    values (%s, %s::vector, %s, now(), now())
                    on conflict (knowledge_item_id)
                    do update set
                      embedding = excluded.embedding,
                      embedding_model = excluded.embedding_model,
                      embedded_at = now(),
                      updated_at = now()
                    """,
                    (
                        int(kid),
                        vec_lit,
                        str(load_swoop_llm_key_settings().get("openrouter_default_model") or "embedding-fallback"),
                    ),
                )
                cur.execute(
                    """
                    update public.knowledge_items
                    set status = 'embedded', updated_at = now()
                    where id = %s
                    """,
                    (int(kid),),
                )

            cur.execute(
                """
                update public.capture_moderation_queue
                set status = 'approved', resolved_at = now()
                where id = %s
                """,
                (payload.id,),
            )
            conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Moderation resolve failed: {exc}")
    finally:
        conn.close()

    note_markdown = build_obsidian_knowledge_note(
        {
            "workspaceId": str(workspace_id),
            "source": str(mod.get("source") or "web"),
            "originalSender": None,
            "url": raw_url,
            "tags": tags,
            "status": "embedded",
            "contentHash": str(item_row.get("content_hash") or ""),
            "title": title,
            "aiSummary": ai_summary,
            "text": text,
        }
    )
    obsidian_sync = sync_knowledge_note_to_obsidian(note_path, note_markdown, mode="update")
    return {
        "ok": True,
        "status": "approved",
        "moderationId": payload.id,
        "knowledgeItemId": kid,
        "obsidian": {
            "written": bool(obsidian_sync.get("ok")),
            "sync": obsidian_sync,
        },
    }


@app.post("/api/v1/knowledge/{knowledge_item_id}/re-enrich")
async def knowledge_reenrich_by_id(
    knowledge_item_id: int,
    payload: KnowledgeReEnrichPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)
    if knowledge_item_id <= 0:
        raise HTTPException(status_code=400, detail="knowledge_item_id must be positive")

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select
                  id, workspace_id, source, original_sender, title, url, canonical_url,
                  content_text, ai_summary, category, tags, content_hash, status, note_path, created_at
                from public.knowledge_items
                where id = %s and workspace_id = %s
                limit 1
                """,
                (knowledge_item_id, workspace_id),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Knowledge item not found")

            raw_url = str(row.get("url") or row.get("canonical_url") or "").strip()
            finalized = finalize_knowledge_capture_fields(
                raw_url=raw_url if payload.forceFetch else "",
                title=str(row.get("title") or "Untitled"),
                text=str(row.get("content_text") or ""),
                ai_summary=str(row.get("ai_summary") or ""),
                category=str(row.get("category") or "general"),
                tags=normalize_tags(row.get("tags") or []),
                source=str(row.get("source") or "unknown"),
            )

            title = _truncate_text(str(finalized.get("title") or row.get("title") or "Untitled"), 1000)
            text = str(finalized.get("text") or row.get("content_text") or "").strip()[:200000]
            ai_summary = _truncate_text(str(finalized.get("ai_summary") or row.get("ai_summary") or ""), 4000)
            category = _truncate_text(str(finalized.get("category") or row.get("category") or "general").lower(), 128) or "general"
            tags = normalize_tags(finalized.get("tags") or row.get("tags") or [])
            if category and category not in tags:
                tags.insert(0, category)
            tags = list(dict.fromkeys(tags))[:12]
            canonical_url = str(finalized.get("canonical_url") or row.get("canonical_url") or normalize_url(raw_url) or "").strip()
            url_use = str(finalized.get("url") or row.get("url") or raw_url).strip()
            status = _truncate_text(str(row.get("status") or "embedded").strip().lower(), 64) or "embedded"
            note_path = _truncate_text(str(row.get("note_path") or "").strip(), 4000)

            cur.execute(
                """
                update public.knowledge_items
                set
                  title = %s,
                  url = %s,
                  canonical_url = %s,
                  content_text = %s,
                  ai_summary = %s,
                  category = %s,
                  tags = %s,
                  updated_at = now(),
                  status = case when status in ('to_process','processed') then 'embedded' else status end
                where id = %s and workspace_id = %s
                """,
                (
                    title,
                    url_use or None,
                    canonical_url or None,
                    text,
                    ai_summary or None,
                    category,
                    psycopg2.extras.Json(tags),
                    knowledge_item_id,
                    workspace_id,
                ),
            )

            embed_source = "\n".join([p for p in (title, ai_summary, (text or "")[:4000]) if p])[:8000]
            vec = get_openai_embedding(embed_source)
            if vec and len(vec) == BOOKMARKS_VECTOR_DIM:
                vec_lit = build_vector_literal(vec)
                cur.execute(
                    """
                    insert into public.knowledge_vectors (knowledge_item_id, embedding, embedding_model, embedded_at, updated_at)
                    values (%s, %s::vector, %s, now(), now())
                    on conflict (knowledge_item_id)
                    do update set
                      embedding = excluded.embedding,
                      embedding_model = excluded.embedding_model,
                      embedded_at = now(),
                      updated_at = now()
                    """,
                    (
                        knowledge_item_id,
                        vec_lit,
                        str(load_swoop_llm_key_settings().get("openrouter_default_model") or "embedding-fallback"),
                    ),
                )
            conn.commit()
    except HTTPException:
        conn.rollback()
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Knowledge re-enrich failed: {exc}")
    finally:
        conn.close()

    link_extract = extract_knowledge_target_fields(text, swoop_user_email=HERMES_SINGLE_USER_EMAIL)
    ref_links = collect_knowledge_reference_links(
        text,
        primary_url=url_use,
        extracted_links=link_extract.get("links"),
    )
    bookmarks_sync: Dict[str, Any] = {"ok": True, "accepted": 0, "items": []}
    if ref_links:
        bookmarks_sync = sync_knowledge_reference_bookmarks(
            workspace_id,
            ref_links,
            parent_path=f"knowledge/{knowledge_item_id}",
            knowledge_item_id=knowledge_item_id,
        )

    note_payload = {
        "workspaceId": str(workspace_id),
        "source": str(row.get("source") or "unknown"),
        "originalSender": row.get("original_sender"),
        "url": url_use,
        "tags": tags,
        "status": status,
        "contentHash": str(row.get("content_hash") or ""),
        "title": title,
        "aiSummary": ai_summary,
        "text": text,
        "capturedAt": str(row.get("created_at") or ""),
        "referenceLinks": ref_links,
    }
    note_markdown = build_obsidian_knowledge_note(note_payload)
    obsidian_sync = sync_knowledge_note_to_obsidian(note_path, note_markdown, mode="update")
    return {
        "ok": True,
        "workspaceId": payload.workspaceId,
        "knowledgeItemId": knowledge_item_id,
        "referenceLinks": ref_links,
        "bookmarksSync": bookmarks_sync,
        "pipeline": {"reEnriched": True, "urlFetched": bool(finalized.get("url_fetched"))},
        "obsidian": {
            "notePathSuggested": note_path,
            "written": bool(obsidian_sync.get("ok")),
            "serverWritten": bool(obsidian_sync.get("serverWritten")),
            "localWritten": bool(obsidian_sync.get("localWritten")),
            "sync": obsidian_sync,
        },
    }


class KnowledgeSyncObsidianPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    limit: int = Field(default=500, ge=1, le=2000)
    resyncBookmarks: bool = Field(default=True)


@app.post("/api/v1/knowledge/sync-obsidian-all")
async def knowledge_sync_obsidian_all(
    payload: KnowledgeSyncObsidianPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Переэкспорт всех записей БЗ в Obsidian (+ ссылки → Bookmarks Bro)."""
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    ids: List[int] = []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select id from public.knowledge_items
                where workspace_id = %s
                order by id asc
                limit %s
                """,
                (workspace_id, payload.limit),
            )
            ids = [int(r["id"]) for r in (cur.fetchall() or []) if r.get("id") is not None]
    finally:
        conn.close()

    results: List[Dict[str, Any]] = []
    for kid in ids:
        try:
            one = await knowledge_reenrich_by_id(
                kid,
                KnowledgeReEnrichPayload(workspaceId=payload.workspaceId, forceFetch=False),
                request,
                x_api_key,
                authorization,
            )
            results.append(
                {
                    "knowledgeItemId": kid,
                    "ok": bool(one.get("obsidian", {}).get("written")),
                    "links": len(one.get("referenceLinks") or []),
                }
            )
        except HTTPException as exc:
            results.append({"knowledgeItemId": kid, "ok": False, "error": exc.detail})
        except Exception as exc:
            results.append({"knowledgeItemId": kid, "ok": False, "error": str(exc)[:200]})

    ok_n = sum(1 for r in results if r.get("ok"))
    return {
        "ok": True,
        "workspaceId": payload.workspaceId,
        "total": len(ids),
        "exported": ok_n,
        "failed": len(ids) - ok_n,
        "items": results,
    }


@app.post("/api/v1/knowledge/search")
async def knowledge_search(
    payload: KnowledgeSearchPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            if payload.semantic:
                emb = get_openai_embedding(payload.query)
                if emb and len(emb) == BOOKMARKS_VECTOR_DIM:
                    vec = build_vector_literal(emb)
                    cur.execute(
                        """
                        select
                          k.id,
                          k.source,
                          k.title,
                          k.url,
                          k.ai_summary,
                          k.category,
                          k.tags,
                          k.status,
                          k.note_path,
                          (v.embedding <-> %s::vector) as distance
                        from public.knowledge_items k
                        join public.knowledge_vectors v on v.knowledge_item_id = k.id
                        where k.workspace_id = %s
                        order by v.embedding <-> %s::vector asc
                        limit %s
                        """,
                        (vec, workspace_id, vec, payload.limit),
                    )
                    rows = cur.fetchall()
                    if rows:
                        return {
                            "mode": "semantic",
                            "query": payload.query,
                            "items": [
                                {
                                    "knowledgeItemId": int(r["id"]),
                                    "source": r.get("source"),
                                    "title": r.get("title"),
                                    "url": r.get("url"),
                                    "summary": r.get("ai_summary"),
                                    "category": r.get("category"),
                                    "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
                                    "status": r.get("status"),
                                    "notePath": r.get("note_path"),
                                    "distance": float(r["distance"]) if r.get("distance") is not None else None,
                                }
                                for r in rows
                            ],
                        }

            like = f"%{payload.query.strip().lower()}%"
            cur.execute(
                """
                select
                  k.id,
                  k.source,
                  k.title,
                  k.url,
                  k.ai_summary,
                  k.category,
                  k.tags,
                  k.status,
                  k.note_path
                from public.knowledge_items k
                where k.workspace_id = %s
                  and (
                    lower(coalesce(k.title, '')) like %s
                    or lower(coalesce(k.url, '')) like %s
                    or lower(coalesce(k.content_text, '')) like %s
                    or lower(coalesce(k.ai_summary, '')) like %s
                  )
                order by k.last_seen_at desc nulls last
                limit %s
                """,
                (workspace_id, like, like, like, like, payload.limit),
            )
            rows = cur.fetchall()
            return {
                "mode": "text",
                "query": payload.query,
                "items": [
                    {
                        "knowledgeItemId": int(r["id"]),
                        "source": r.get("source"),
                        "title": r.get("title"),
                        "url": r.get("url"),
                        "summary": r.get("ai_summary"),
                        "category": r.get("category"),
                        "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
                        "status": r.get("status"),
                        "notePath": r.get("note_path"),
                    }
                    for r in rows
                ],
            }
    finally:
        conn.close()


@app.post("/api/v1/knowledge/export")
async def knowledge_export(
    payload: KnowledgeExportPayload,
    request: Request,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """
    On-demand export of knowledge base with Obsidian markdown body plus vector metadata.
    Intended for user-triggered "export my Obsidian + vector knowledge" operations.
    """
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    try:
        workspace_id = int(payload.workspaceId)
    except ValueError:
        raise HTTPException(status_code=400, detail="workspaceId must be numeric")
    verify_workspace_membership(auth_ctx, workspace_id)

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            rows: List[Dict[str, Any]] = []
            mode = "text"
            if payload.semantic:
                emb = get_openai_embedding(payload.query)
                if emb and len(emb) == BOOKMARKS_VECTOR_DIM:
                    vec = build_vector_literal(emb)
                    cur.execute(
                        """
                        select
                          k.id,
                          k.source,
                          k.title,
                          k.url,
                          k.ai_summary,
                          k.category,
                          k.tags,
                          k.status,
                          k.note_path,
                          v.embedding_model,
                          (v.embedding <-> %s::vector) as distance
                        from public.knowledge_items k
                        join public.knowledge_vectors v on v.knowledge_item_id = k.id
                        where k.workspace_id = %s
                        order by v.embedding <-> %s::vector asc
                        limit %s
                        """,
                        (vec, workspace_id, vec, payload.limit),
                    )
                    rows = [dict(r) for r in (cur.fetchall() or [])]
                    if rows:
                        mode = "semantic"

            if not rows:
                like = f"%{payload.query.strip().lower()}%"
                cur.execute(
                    """
                    select
                      k.id,
                      k.source,
                      k.title,
                      k.url,
                      k.ai_summary,
                      k.category,
                      k.tags,
                      k.status,
                      k.note_path,
                      v.embedding_model,
                      null::float8 as distance
                    from public.knowledge_items k
                    left join public.knowledge_vectors v on v.knowledge_item_id = k.id
                    where k.workspace_id = %s
                      and (
                        lower(coalesce(k.title, '')) like %s
                        or lower(coalesce(k.url, '')) like %s
                        or lower(coalesce(k.content_text, '')) like %s
                        or lower(coalesce(k.ai_summary, '')) like %s
                      )
                    order by k.last_seen_at desc nulls last
                    limit %s
                    """,
                    (workspace_id, like, like, like, like, payload.limit),
                )
                rows = [dict(r) for r in (cur.fetchall() or [])]

            vector_count = sum(1 for r in rows if r.get("embedding_model"))
            markdown_lines = [
                "---",
                f'workspace_id: "{workspace_id}"',
                f'mode: "{mode}"',
                f'query: "{payload.query.replace(chr(34), chr(92) + chr(34))}"',
                f'item_count: {len(rows)}',
                f'vector_count: {vector_count}',
                f'exported_at: "{datetime.datetime.utcnow().isoformat()}Z"',
                "---",
                "",
                "# Knowledge Export",
                "",
            ]
            for r in rows:
                title = str(r.get("title") or f"Knowledge {r.get('id')}")
                markdown_lines.append(f"## {title}")
                markdown_lines.append("")
                if r.get("url"):
                    markdown_lines.append(f"- URL: {r.get('url')}")
                if r.get("source"):
                    markdown_lines.append(f"- Source: {r.get('source')}")
                if r.get("category"):
                    markdown_lines.append(f"- Category: {r.get('category')}")
                if r.get("status"):
                    markdown_lines.append(f"- Status: {r.get('status')}")
                tags = r.get("tags") if isinstance(r.get("tags"), list) else []
                if tags:
                    markdown_lines.append(f"- Tags: {', '.join(str(t) for t in tags)}")
                if r.get("embedding_model"):
                    markdown_lines.append(f"- Embedding Model: {r.get('embedding_model')}")
                if r.get("distance") is not None:
                    markdown_lines.append(f"- Vector Distance: {float(r.get('distance')):.6f}")
                summary = str(r.get("ai_summary") or "").strip()
                if summary:
                    markdown_lines.append("")
                    markdown_lines.append("### Summary")
                    markdown_lines.append(summary)
                markdown_lines.append("")

            items = [
                {
                    "knowledgeItemId": int(r["id"]),
                    "source": r.get("source"),
                    "title": r.get("title"),
                    "url": r.get("url"),
                    "summary": r.get("ai_summary"),
                    "category": r.get("category"),
                    "tags": r.get("tags") if isinstance(r.get("tags"), list) else [],
                    "status": r.get("status"),
                    "notePath": r.get("note_path"),
                    "distance": float(r["distance"]) if r.get("distance") is not None else None,
                    "embeddingModel": r.get("embedding_model"),
                }
                for r in rows
            ]
            return {
                "workspaceId": str(workspace_id),
                "query": payload.query,
                "mode": mode,
                "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
                "itemCount": len(items),
                "vectorCount": vector_count,
                "items": items,
                "markdown": "\n".join(markdown_lines),
            }
    finally:
        conn.close()
