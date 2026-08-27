import contextlib
import csv
import io
import json
import math
import os
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
from urllib.parse import urljoin, urlparse

import psycopg2
import psycopg2.extras
import requests
import jwt
import yaml

from scrapling.fetchers import Fetcher, StealthyFetcher, DynamicFetcher
from scrapling import Selector as Adaptor


SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

PGHOST = os.environ.get("PGHOST", "supabase-db")
PGPORT = int(os.environ.get("PGPORT") or "5433")
PGDATABASE = os.environ.get("PGDATABASE", "postgres")
PGUSER = os.environ.get("PGUSER", "supabase_admin")
PGPASSWORD = os.environ.get("PGPASSWORD", "supabase_password_e97577f974376e8d")

POLL_INTERVAL_SEC = float(os.environ.get("POLL_INTERVAL_SEC", "5"))
RESULT_BUCKET = os.environ.get("SCRAPLING_RESULT_BUCKET", "user_uploads")
RESULT_PREFIX = os.environ.get("SCRAPLING_RESULT_PREFIX", "scrapling-results")

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")

GOLOGIN_API_TOKEN = os.environ.get("GOLOGIN_API_TOKEN", "")
GOLOGIN_API_URL = "https://api.gologin.com"
GOLOGIN_CLOUD_WS = "wss://cloudbrowser.gologin.com/connect"

MAX_CONTENT_PER_PAGE = 100_000
MAX_CRAWL_PAGES = 100
MAX_CRAWL_DEPTH = 5

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

_jwt_secret: Optional[str] = None
_service_role_jwt: Optional[str] = None
_jwt_expires_at: float = 0.0


def log(*args: Any) -> None:
    print("[scrapling-worker]", *args, flush=True)


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def pg_connect():
    return psycopg2.connect(
        host=PGHOST, port=PGPORT, dbname=PGDATABASE,
        user=PGUSER, password=PGPASSWORD,
    )


def get_jwt_secret() -> str:
    global _jwt_secret
    if _jwt_secret:
        return _jwt_secret
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT current_setting('app.settings.jwt_secret', true)")
            row = cur.fetchone()
            if row and row[0]:
                _jwt_secret = row[0]
                return _jwt_secret
    finally:
        conn.close()
    raise RuntimeError("Failed to get JWT_SECRET from Postgres")


def get_service_role_jwt() -> str:
    global _service_role_jwt, _jwt_expires_at
    now = time.time()
    if _service_role_jwt and now < _jwt_expires_at:
        return _service_role_jwt
    secret = get_jwt_secret()
    payload = {
        "iss": "supabase", "aud": "authenticated", "role": "service_role",
        "iat": int(now), "exp": int(now) + 3600,
    }
    _service_role_jwt = jwt.encode(payload, secret, algorithm="HS256")
    _jwt_expires_at = now + 3600
    return _service_role_jwt


# ---------------------------------------------------------------------------
# Template & proxy list loaders
# ---------------------------------------------------------------------------

def load_template(template_id: str) -> Optional[Dict[str, Any]]:
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.scrapling_templates WHERE id = %s", (template_id,))
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def load_proxy_list(proxy_list_id: str) -> Optional[Dict[str, Any]]:
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.scrapling_proxy_lists WHERE id = %s", (proxy_list_id,))
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


class ProxyRotator:
    """Round-robin proxy rotation + single-proxy IP rotation via API call."""

    def __init__(self, proxies: List[str], rotate_url: Optional[str] = None):
        self._proxies = proxies if proxies else []
        self._rotate_url = rotate_url
        self._idx = 0

    def next(self) -> Optional[str]:
        if not self._proxies:
            return None
        proxy = self._proxies[self._idx % len(self._proxies)]
        self._idx += 1
        return proxy

    def rotate_ip(self) -> None:
        """Call the rotate URL to trigger IP change on the provider side."""
        if not self._rotate_url:
            return
        try:
            resp = requests.get(self._rotate_url, timeout=15)
            log(f"proxy rotate: {resp.status_code} — {resp.text[:100]}")
            time.sleep(2)
        except Exception as e:
            log(f"proxy rotate error: {e}")

    @property
    def has_proxies(self) -> bool:
        return len(self._proxies) > 0

    @property
    def has_rotate(self) -> bool:
        return bool(self._rotate_url)


def build_proxy_rotator(job: Dict[str, Any]) -> ProxyRotator:
    proxies: List[str] = []
    rotate_url = (job.get("proxy_rotate_url") or "").strip() or None

    if job.get("proxy_list_id"):
        pl = load_proxy_list(str(job["proxy_list_id"]))
        if pl:
            raw = pl.get("proxies") or []
            if isinstance(raw, str):
                raw = json.loads(raw)
            proxies = [p.strip() for p in raw if p and p.strip()]
            if not rotate_url and pl.get("rotate_url"):
                rotate_url = pl["rotate_url"].strip()

    if not proxies:
        single_proxy = (job.get("proxy") or "").strip()
        if single_proxy:
            proxies = [single_proxy]

    return ProxyRotator(proxies, rotate_url)


# ---------------------------------------------------------------------------
# GoLogin Cloud Browser
# ---------------------------------------------------------------------------

def _load_global_settings() -> Dict[str, Any]:
    """Load centralized service settings (cascade level 2)."""
    defaults: Dict[str, Any] = {
        "gemini_api_key": "",
        "gologin_api_token": "",
        "gemini_keys": [],
        "groq_keys": [],
        "glm_keys": [],
        "openai_keys": [],
        "openrouter_keys": [],
        "brave_keys": [],
        "api_key_groups": [],
        "agent_api_key": "",
        "agent_enabled": False,
        "agent_rate_limit": 30,
    }
    try:
        conn = pg_connect()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.service_settings WHERE id = 1")
            row = cur.fetchone()
        conn.close()
    except Exception as e:
        log(f"Global settings load error (using defaults): {e}")
        return defaults
    if not row:
        return defaults
    cfg: Dict[str, Any] = {k: row.get(k, v) for k, v in defaults.items()}
    # Normalize JSONB arrays into Python lists
    for key in ("gemini_keys", "groq_keys", "glm_keys", "openai_keys", "openrouter_keys", "brave_keys"):
        val = cfg.get(key) or []
        if isinstance(val, str):
            try:
                val = json.loads(val)
            except Exception:
                val = []
        if not isinstance(val, list):
            val = []
        cfg[key] = [s for s in val if isinstance(s, str) and s.strip()]

    groups_raw = cfg.get("api_key_groups") or []
    if isinstance(groups_raw, str):
        try:
            groups_raw = json.loads(groups_raw)
        except Exception:
            groups_raw = []
    if not isinstance(groups_raw, list):
        groups_raw = []
    normalized_groups: list[Dict[str, Any]] = []
    for i, item in enumerate(groups_raw):
        if not isinstance(item, dict):
            continue
        gid = str(item.get("id") or "").strip().lower()
        gid = "".join(c if c.isalnum() or c == "_" else "_" for c in gid).strip("_") or f"group_{i}"
        name = str(item.get("name") or gid).strip()
        klist = item.get("keys") or []
        if isinstance(klist, str):
            try:
                klist = json.loads(klist)
            except Exception:
                klist = []
        if not isinstance(klist, list):
            klist = []
        keys = [s.strip() for s in klist if isinstance(s, str) and s.strip()]
        normalized_groups.append({"id": gid, "name": name, "keys": keys})
    cfg["api_key_groups"] = normalized_groups
    return cfg


def _resolve_api_group_keys(group_id: str) -> list[str]:
    """
    Keys for a named group from service_settings.api_key_groups (by id, case-insensitive).
    Optional env: SWOOP_API_GROUP_<ID>_KEYS as JSON array — appended after DB keys.
    """
    want = (group_id or "").strip().lower()
    if not want:
        return []
    gs = _load_global_settings()
    out: list[str] = []
    for g in gs.get("api_key_groups") or []:
        if not isinstance(g, dict):
            continue
        gid = str(g.get("id") or "").strip().lower()
        if gid == want:
            for k in g.get("keys") or []:
                if isinstance(k, str) and k.strip():
                    out.append(k.strip())
            break
    env_name = f"SWOOP_API_GROUP_{want.upper()}_KEYS"
    raw = os.environ.get(env_name, "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                for k in parsed:
                    if isinstance(k, str) and k.strip():
                        out.append(k.strip())
        except Exception:
            pass
    seen: set[str] = set()
    dedup: list[str] = []
    for k in out:
        if k in seen:
            continue
        seen.add(k)
        dedup.append(k)
    return dedup


def _resolve_gemini_keys() -> list[str]:
    """Cascade: service config → global settings → env var (multiple keys)."""
    keys: list[str] = []
    # 1) Service-specific override in scrapling_gologin_config
    try:
        conn = pg_connect()
        with conn.cursor() as cur:
            cur.execute("SELECT gemini_api_key FROM scrapling_gologin_config WHERE id = 1")
            row = cur.fetchone()
        conn.close()
        if row and row[0]:
            keys.append(str(row[0]))
    except Exception:
        pass
    # 2) Global settings arrays / legacy single key
    gs = _load_global_settings()
    keys.extend(gs.get("gemini_keys") or [])
    legacy = gs.get("gemini_api_key")
    if legacy:
        keys.append(str(legacy))
    # 3) Env fallback
    if GEMINI_API_KEY:
        keys.append(GEMINI_API_KEY)
    # Deduplicate preserving order
    seen = set()
    result: list[str] = []
    for k in keys:
        k = k.strip()
        if not k or k in seen:
            continue
        seen.add(k)
        result.append(k)
    return result


def _resolve_gologin_token() -> str:
    """Cascade: service config → global settings → env var."""
    try:
        conn = pg_connect()
        with conn.cursor() as cur:
            cur.execute("SELECT api_token FROM scrapling_gologin_config WHERE id = 1")
            row = cur.fetchone()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass
    gs = _load_global_settings()
    if gs.get("gologin_api_token"):
        return gs["gologin_api_token"]
    return GOLOGIN_API_TOKEN


def _load_gologin_config() -> Dict[str, Any]:
    """Load GoLogin configuration from the DB settings table."""
    defaults: Dict[str, Any] = {
        "api_token": "",
        "profiles": [],
        "proxy_type": "residential",
        "default_country": "",
        "wait_until": "networkidle",
        "wait_timeout_sec": 60,
    }
    try:
        conn = pg_connect()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM scrapling_gologin_config WHERE id = 1")
            row = cur.fetchone()
        conn.close()
    except Exception as e:
        log(f"GoLogin config load error (using defaults): {e}")
        return defaults
    if not row:
        return defaults
    profiles = row.get("profiles") or []
    if isinstance(profiles, str):
        profiles = json.loads(profiles)
    return {
        "api_token": row.get("api_token", ""),
        "profiles": profiles,
        "proxy_type": row.get("proxy_type", "residential"),
        "default_country": row.get("default_country", ""),
        "wait_until": row.get("wait_until", "networkidle"),
        "wait_timeout_sec": int(row.get("wait_timeout_sec", 60)),
    }


class GoLoginBrowser:
    """Context manager for GoLogin Cloud Browser sessions.

    Supports two modes:
    - Existing profile (profile_id provided): reuses a pre-created GoLogin
      profile. Optionally applies a custom proxy. Does NOT delete the profile.
    - Temporary profile (no profile_id): creates a new profile with random
      fingerprint, configures proxy, and deletes it on exit.
    """

    def __init__(
        self,
        token: str,
        country: str = "",
        custom_proxy: str = "",
        proxy_type: str = "residential",
        wait_until: str = "networkidle",
        wait_timeout_sec: int = 60,
        profile_id: Optional[str] = None,
    ):
        self._token = token
        self._country = country.strip().lower() if country else ""
        self._custom_proxy = custom_proxy.strip() if custom_proxy else ""
        self._proxy_type = proxy_type.strip().lower() if proxy_type else "residential"
        self._wait_until = wait_until or "networkidle"
        self._wait_timeout_ms = wait_timeout_sec * 1000
        self._given_profile_id = profile_id
        self._profile_id: Optional[str] = profile_id
        self._is_temp_profile = profile_id is None
        self._proxy_id: Optional[str] = None
        self._pw_ctx: Any = None
        self._pw: Any = None
        self._browser: Any = None

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def _apply_gologin_proxy(self, h: Dict[str, str]) -> None:
        """Create a GoLogin built-in proxy and attach to the profile."""
        proxy_body: Dict[str, Any] = {
            "mode": "geolocation",
            "autoProxyRegion": self._country,
        }
        if self._proxy_type in ("mobile", "residential"):
            proxy_body["autoProxyType"] = self._proxy_type
        pr = requests.post(
            f"{GOLOGIN_API_URL}/proxy",
            headers=h, json=proxy_body, timeout=15,
        )
        if pr.ok:
            proxy_data = pr.json()
            self._proxy_id = proxy_data.get("id")
            requests.patch(
                f"{GOLOGIN_API_URL}/browser/{self._profile_id}",
                headers=h, json={"proxy": proxy_data}, timeout=15,
            )
            log(f"GoLogin {self._proxy_type} proxy ({self._country}) attached")
        else:
            log(f"GoLogin proxy create warning: {pr.status_code} {pr.text[:200]}")

    def _apply_custom_proxy(self, h: Dict[str, str]) -> None:
        """Set a custom proxy on the profile."""
        p = urlparse(self._custom_proxy)
        proxy_payload: Dict[str, Any] = {
            "mode": p.scheme.replace("socks5", "socks5") if p.scheme else "http",
            "host": p.hostname or "",
            "port": p.port or 8080,
        }
        if p.username:
            proxy_payload["username"] = p.username
        if p.password:
            proxy_payload["password"] = p.password
        requests.patch(
            f"{GOLOGIN_API_URL}/browser/{self._profile_id}",
            headers=h, json={"proxy": proxy_payload}, timeout=15,
        )
        log("Custom proxy attached to GoLogin profile")

    def __enter__(self) -> "GoLoginBrowser":
        h = self._headers()

        if self._is_temp_profile:
            resp = requests.post(
                f"{GOLOGIN_API_URL}/browser/quick",
                headers=h, json={"os": "lin"}, timeout=30,
            )
            if not resp.ok:
                raise RuntimeError(f"GoLogin create profile failed {resp.status_code}: {resp.text[:300]}")
            self._profile_id = resp.json()["id"]
            log(f"GoLogin temp profile created: {self._profile_id}")
        else:
            log(f"GoLogin using existing profile: {self._profile_id}")

        if self._custom_proxy:
            self._apply_custom_proxy(h)
        elif self._is_temp_profile and self._country:
            self._apply_gologin_proxy(h)

        try:
            requests.patch(
                f"{GOLOGIN_API_URL}/browser/{self._profile_id}",
                headers=h, json={"pasteAsHumanTyping": True}, timeout=15,
            )
        except Exception as e:
            log(f"pasteAsHumanTyping patch warning: {e}")

        from playwright.sync_api import sync_playwright
        self._pw_ctx = sync_playwright()
        self._pw = self._pw_ctx.start()

        ws_url = f"{GOLOGIN_CLOUD_WS}?token={self._token}&profile={self._profile_id}"
        self._browser = self._pw.chromium.connect_over_cdp(ws_url)
        log("Connected to GoLogin Cloud Browser")
        return self

    def fetch(self, url: str) -> str:
        """Navigate to a URL and return the full HTML."""
        page = self._browser.new_page()
        try:
            page.goto(url, wait_until=self._wait_until, timeout=self._wait_timeout_ms)
            return page.content()
        finally:
            page.close()

    def __exit__(self, *args: Any) -> None:
        h = self._headers()
        try:
            if self._browser:
                self._browser.close()
        except Exception as e:
            log(f"GoLogin browser close: {e}")
        try:
            if self._pw:
                self._pw.stop()
        except Exception as e:
            log(f"GoLogin pw stop: {e}")
        if self._is_temp_profile and self._profile_id:
            try:
                requests.delete(
                    f"{GOLOGIN_API_URL}/browser/{self._profile_id}",
                    headers=h, timeout=15,
                )
                log(f"GoLogin temp profile deleted: {self._profile_id}")
            except Exception as e:
                log(f"GoLogin profile delete: {e}")
        if self._proxy_id:
            try:
                requests.delete(
                    f"{GOLOGIN_API_URL}/proxy/{self._proxy_id}",
                    headers=h, timeout=15,
                )
            except Exception as e:
                log(f"GoLogin proxy delete: {e}")


def _build_gologin_ctx(job: Dict[str, Any]) -> Optional[GoLoginBrowser]:
    """Build a GoLoginBrowser from DB config + per-job overrides."""
    mode = (job.get("mode") or "fetcher").lower()
    if mode != "gologin":
        return None

    config = _load_gologin_config()
    token = _resolve_gologin_token()
    if not token:
        raise RuntimeError("GoLogin API token not configured (DB or env)")

    profiles = config["profiles"] or []
    job_profile_id = (job.get("gologin_profile_id") or "").strip() or None
    proxy_type = (job.get("gologin_proxy_type") or "").strip() or config["proxy_type"]
    wait_until = (job.get("gologin_wait_until") or "").strip() or config["wait_until"]
    wait_timeout_sec = config.get("wait_timeout_sec", 60)

    proxy_val = (job.get("proxy") or "").strip()
    country = ""
    custom_proxy = ""
    profile_id: Optional[str] = None

    if job_profile_id:
        profile_id = job_profile_id
        matched = [p for p in profiles if p.get("profile_id") == job_profile_id]
        if matched and matched[0].get("custom_proxy"):
            custom_proxy = matched[0]["custom_proxy"]
    elif profiles:
        first = profiles[0]
        profile_id = first.get("profile_id")
        if first.get("custom_proxy"):
            custom_proxy = first["custom_proxy"]

    if proxy_val and not custom_proxy:
        if len(proxy_val) <= 3 and proxy_val.isalpha():
            country = proxy_val
        elif "://" in proxy_val or ":" in proxy_val:
            custom_proxy = proxy_val

    if not country and not custom_proxy and profile_id is None:
        country = config.get("default_country", "")

    return GoLoginBrowser(
        token=token,
        country=country,
        custom_proxy=custom_proxy,
        proxy_type=proxy_type,
        wait_until=wait_until,
        wait_timeout_sec=wait_timeout_sec,
        profile_id=profile_id,
    )


# ---------------------------------------------------------------------------
# CSV template extraction
# ---------------------------------------------------------------------------

def extract_with_template(page: Any, template_columns: List[Dict[str, Any]], url: str) -> Dict[str, str]:
    """Extract one row of data from a page using template column definitions."""
    row: Dict[str, str] = {"_url": url}
    for col in template_columns:
        name = col.get("name", "")
        sel = (col.get("selector") or "").strip()
        attr = (col.get("attribute") or "").strip()
        if not sel:
            row[name] = ""
            continue
        try:
            if sel.startswith("//"):
                elements = page.xpath(sel)
            else:
                elements = page.css(sel)

            if not elements:
                row[name] = ""
            elif attr:
                vals = []
                for el in elements:
                    v = el.attrib.get(attr, "")
                    if v:
                        vals.append(v)
                row[name] = vals[0] if len(vals) == 1 else " | ".join(vals)
            else:
                if sel.startswith("//"):
                    texts = elements.getall()
                else:
                    texts = page.css(f"{sel} ::text").getall()
                joined = " ".join(t.strip() for t in texts if t.strip())
                row[name] = joined
        except Exception as e:
            row[name] = f"[error: {e}]"
    return row


def rows_to_csv(rows: List[Dict[str, str]], columns: List[Dict[str, Any]]) -> str:
    headers = ["_url"] + [c["name"] for c in columns]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=headers, extrasaction="ignore")
    writer.writeheader()
    for r in rows:
        writer.writerow(r)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Supabase REST / Storage
# ---------------------------------------------------------------------------

def supabase_rest(path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None):
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/{path}"
    jwt_token = get_service_role_jwt()
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {jwt_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation",
    }
    resp = requests.request(method, url, headers=headers, json=body, timeout=60)
    if not resp.ok:
        raise RuntimeError(f"Supabase {method} {path} failed {resp.status_code}: {resp.text}")
    return resp.json() if resp.text else None


def supabase_storage_upload(bucket: str, object_path: str, data: bytes, content_type: str = "text/markdown") -> None:
    url = f"{SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{object_path}"
    jwt_token = get_service_role_jwt()
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {jwt_token}",
        "Content-Type": content_type,
        "x-upsert": "true",
    }
    r = requests.post(url, headers=headers, data=data, timeout=120)
    if not r.ok:
        raise RuntimeError(f"Storage upload failed {r.status_code}: {r.text}")


# ---------------------------------------------------------------------------
# Job queue
# ---------------------------------------------------------------------------

def fetch_one_queued_job() -> Optional[Dict[str, Any]]:
    conn = pg_connect()
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM public.scrapling_jobs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            """)
            row = cur.fetchone()
            if not row:
                conn.commit()
                return None
            cur.execute(
                "UPDATE public.scrapling_jobs SET status = 'running' WHERE id = %s",
                (row["id"],),
            )
            conn.commit()
            return dict(row)
    finally:
        conn.close()


def update_progress(job_id: str, completed: int, total: int, errors: int = 0) -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE public.scrapling_jobs SET progress = %s WHERE id = %s",
                (json.dumps({"completed": completed, "total": total, "errors": errors}), job_id),
            )
        conn.commit()
    finally:
        conn.close()


def update_job_success(job_id: str, object_path: str, preview: str) -> None:
    supabase_rest(f"scrapling_jobs?id=eq.{job_id}", method="PATCH", body={
        "status": "done",
        "result_path": object_path,
        "result_preview": preview,
        "error_message": None,
    })


def update_job_error(job_id: str, message: str) -> None:
    supabase_rest(f"scrapling_jobs?id=eq.{job_id}", method="PATCH", body={
        "status": "error",
        "error_message": message[:2000],
    })


# ---------------------------------------------------------------------------
# AI extraction via Gemini
# ---------------------------------------------------------------------------

def ai_extract(content: str, prompt: str) -> str:
    keys = _resolve_gemini_keys()
    if not keys:
        return f"[AI extraction unavailable — no Gemini API key configured]\n\n{content}"

    truncated = content[:MAX_CONTENT_PER_PAGE]
    body = {
        "contents": [{"parts": [{"text": (
            "You are a data extraction assistant. Extract data from web page content based on the user's request.\n"
            "Return results in a clean, structured markdown format.\n\n"
            f"User's request: {prompt}\n\n"
            f"Web page content:\n{truncated}"
        )}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
    }

    retry_delays = [5, 15]
    last_error = None

    for api_key in keys:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={api_key}"
        for attempt in range(1 + len(retry_delays)):
            try:
                resp = requests.post(url, json=body, timeout=120)
                if resp.status_code == 429:
                    last_error = "429"
                    if attempt < len(retry_delays):
                        delay = retry_delays[attempt]
                        log(f"Gemini 429 rate limit, retry in {delay}s (attempt {attempt + 1})")
                        time.sleep(delay)
                        continue
                    # выйти из внутреннего цикла и попробовать следующий ключ
                    log("Gemini 429 after retries for this key, trying next key if available")
                    break
                if not resp.ok:
                    last_error = f"{resp.status_code}"
                    log(f"Gemini API error {resp.status_code}: {resp.text[:200]}")
                    # при жестких ошибках (401/403 и т.п.) переходим к следующему ключу
                    break

                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except Exception as e:
                last_error = str(e)
                log(f"AI extraction failed with current key: {e}")
                if attempt < len(retry_delays):
                    time.sleep(retry_delays[attempt])
                    continue
                # ошибка на этом ключе — пробуем следующий
                break

    # Все ключи и попытки исчерпаны
    if last_error == "429":
        return (
            "[Лимит запросов Gemini (429) по всем ключам. Попробуйте позже или добавьте новые ключи. "
            "Ниже — исходный контент без AI-обработки.]\n\n" + content[:8000]
        )
    return f"[AI error across all keys: {last_error}]\n\n{content[:2000]}"


# ---------------------------------------------------------------------------
# Scraping core
# ---------------------------------------------------------------------------

def scrape_url(
    url: str,
    opts: Dict[str, Any],
    proxy_override: Optional[str] = None,
    gologin_browser: Optional[GoLoginBrowser] = None,
) -> tuple[str, Any]:
    """Fetch one URL and extract content. Returns (content_string, page_object)."""
    mode = (opts.get("mode") or "fetcher").lower()
    selector = (opts.get("selector") or "").strip()
    output_format = (opts.get("output_format") or "markdown").lower()
    impersonate = (opts.get("impersonate") or "").strip() or None
    solve_cf = bool(opts.get("solve_cloudflare"))
    net_idle = bool(opts.get("network_idle"))
    headless = opts.get("headless", True)
    proxy = proxy_override or (opts.get("proxy") or "").strip() or None

    if mode == "gologin" and gologin_browser:
        page_html = gologin_browser.fetch(url)
        page = Adaptor(page_html, url=url)
    elif mode == "stealth":
        kw: Dict[str, Any] = {"headless": headless}
        if solve_cf:
            kw["solve_cloudflare"] = True
        if proxy:
            kw["proxy"] = {"server": proxy}
        page = StealthyFetcher.fetch(url, **kw)
        page_html = getattr(page, "html_content", None) or getattr(page, "html", None) or ""
    elif mode == "dynamic":
        kw = {"headless": headless}
        if net_idle:
            kw["network_idle"] = True
        if proxy:
            kw["proxy"] = {"server": proxy}
        page = DynamicFetcher.fetch(url, **kw)
        page_html = getattr(page, "html_content", None) or getattr(page, "html", None) or ""
    else:
        kw = {}
        if impersonate:
            kw["impersonate"] = impersonate
        if proxy:
            kw["proxy"] = proxy
        page = Fetcher.get(url, **kw)
        page_html = getattr(page, "html_content", None) or getattr(page, "html", None) or ""

    if selector:
        if selector.startswith("//"):
            items = page.xpath(selector).getall()
        else:
            items = page.css(selector).getall()
        content = "\n\n---\n\n".join(items) if items else f"No elements matched selector: {selector}"
        else:
        if output_format == "html":
            content = page_html
    else:
            texts = page.css("body ::text").getall()
        content = "\n".join(t.strip() for t in texts if t.strip())

    return (content or "No content extracted.")[:MAX_CONTENT_PER_PAGE], page


def extract_page_links(page: Any, link_selector: str, base_url: str, base_domain: str) -> List[str]:
    """Extract and normalize links from a page, filtering to same domain."""
    if link_selector and link_selector.strip():
        sel = link_selector.strip()
        if sel.startswith("//"):
            elements = page.xpath(sel)
        else:
            elements = page.css(sel)
        raw = []
        for el in elements:
            href = el.attrib.get("href", "")
            if not href:
                text = getattr(el, "text", "")
                if text and text.startswith("http"):
                    href = text
            if href:
                raw.append(href)
    else:
        raw = page.css("a::attr(href)").getall()

    links: list[str] = []
    seen: set[str] = set()
    for href in raw:
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full = urljoin(base_url, href)
        parsed = urlparse(full)
        if parsed.netloc != base_domain:
            continue
        clean = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
        if parsed.query:
            clean += f"?{parsed.query}"
        if clean not in seen:
            seen.add(clean)
            links.append(clean)
    return links


# ---------------------------------------------------------------------------
# Job processors
# ---------------------------------------------------------------------------

def _load_job_template(job: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
    tid = job.get("template_id")
    if not tid:
        return None
    tpl = load_template(str(tid))
    if not tpl:
        return None
    cols = tpl.get("columns") or []
    if isinstance(cols, str):
        cols = json.loads(cols)
    return cols if cols else None


def process_single(job: Dict[str, Any]) -> tuple[str, str]:
    mode = (job.get("mode") or "fetcher").lower()
    gl_ctx = _build_gologin_ctx(job) if mode == "gologin" else None

    with (gl_ctx or contextlib.nullcontext()) as gl_browser:
        rotator = build_proxy_rotator(job)
        proxy = rotator.next() if mode != "gologin" else None
        if rotator.has_rotate and mode != "gologin":
            rotator.rotate_ip()

        content, page = scrape_url(job["url"], job, proxy_override=proxy, gologin_browser=gl_browser)

    template_cols = _load_job_template(job)
    if template_cols:
        row = extract_with_template(page, template_cols, job["url"])
        csv_str = rows_to_csv([row], template_cols)
        preview = csv_str[:500]
        return csv_str, preview

    if job.get("ai_prompt"):
        content = ai_extract(content, job["ai_prompt"])
    preview = (content[:500] + "...") if len(content) > 500 else content
    return content, preview


def process_batch(job: Dict[str, Any]) -> tuple[str, str]:
    urls = job.get("urls") or []
    if isinstance(urls, str):
        urls = json.loads(urls)

    total = len(urls)
    results: List[Dict[str, Any]] = []
    csv_rows: List[Dict[str, str]] = []
    err_count = 0
    ai_prompt = job.get("ai_prompt")
    job_id = str(job["id"])
    template_cols = _load_job_template(job)
    mode = (job.get("mode") or "fetcher").lower()
    rotator = build_proxy_rotator(job)
    gl_ctx = _build_gologin_ctx(job) if mode == "gologin" else None

    with (gl_ctx or contextlib.nullcontext()) as gl_browser:
        for i, url in enumerate(urls):
            url = url.strip()
            if not url:
                continue

            proxy = rotator.next() if mode != "gologin" else None
            if rotator.has_rotate and mode != "gologin":
                rotator.rotate_ip()

            try:
                content, page = scrape_url(url, job, proxy_override=proxy, gologin_browser=gl_browser)
                if template_cols:
                    row = extract_with_template(page, template_cols, url)
                    csv_rows.append(row)
                    results.append({"url": url, "status": "ok", "content": "(template)", "length": len(str(row))})
                else:
                    if ai_prompt:
                        content = ai_extract(content, ai_prompt)
                    results.append({"url": url, "status": "ok", "content": content, "length": len(content)})
            except Exception as e:
                err_count += 1
                results.append({"url": url, "status": "error", "error": str(e)})
                log(f"batch url error: {url} — {e}")
            update_progress(job_id, i + 1, total, err_count)

    if template_cols and csv_rows:
        csv_str = rows_to_csv(csv_rows, template_cols)
        preview = _build_summary(results, total, err_count)
        return csv_str, preview

    aggregate = _build_aggregate(results, job, "Batch Scraping Results")
    preview = _build_summary(results, total, err_count)
    return aggregate, preview


def process_crawl(job: Dict[str, Any]) -> tuple[str, str]:
    start_url = job["url"]
    max_pages = min(int(job.get("max_pages") or 10), MAX_CRAWL_PAGES)
    crawl_depth = min(int(job.get("crawl_depth") or 1), MAX_CRAWL_DEPTH)
    link_selector = (job.get("link_selector") or "").strip()
    ai_prompt = job.get("ai_prompt")
    job_id = str(job["id"])
    template_cols = _load_job_template(job)
    mode = (job.get("mode") or "fetcher").lower()
    rotator = build_proxy_rotator(job)
    gl_ctx = _build_gologin_ctx(job) if mode == "gologin" else None

    base_domain = urlparse(start_url).netloc
    visited: set[str] = set()
    queue: list[tuple[str, int]] = [(start_url, 0)]
    results: List[Dict[str, Any]] = []
    csv_rows: List[Dict[str, str]] = []
    err_count = 0

    with (gl_ctx or contextlib.nullcontext()) as gl_browser:
        while queue and len(visited) < max_pages:
            url, depth = queue.pop(0)
            if url in visited:
                continue
            visited.add(url)

            proxy = rotator.next() if mode != "gologin" else None
            if rotator.has_rotate and mode != "gologin":
                rotator.rotate_ip()

            try:
                content, page = scrape_url(url, job, proxy_override=proxy, gologin_browser=gl_browser)

                if template_cols:
                    row = extract_with_template(page, template_cols, url)
                    csv_rows.append(row)
                    results.append({"url": url, "depth": depth, "status": "ok", "content": "(template)", "length": len(str(row))})
                else:
                    if ai_prompt:
                        content = ai_extract(content, ai_prompt)
                    results.append({
                        "url": url, "depth": depth, "status": "ok",
                        "content": content, "length": len(content),
                    })

                if depth < crawl_depth:
                    new_links = extract_page_links(page, link_selector, start_url, base_domain)
                    for lnk in new_links:
                        if lnk not in visited:
                            queue.append((lnk, depth + 1))
            except Exception as e:
                err_count += 1
                results.append({"url": url, "depth": depth, "status": "error", "error": str(e)})
                log(f"crawl error: {url} — {e}")

            update_progress(job_id, len(visited), max_pages, err_count)

    if template_cols and csv_rows:
        csv_str = rows_to_csv(csv_rows, template_cols)
        preview = _build_summary(results, len(visited), err_count)
        return csv_str, preview

    aggregate = _build_aggregate(results, job, "Crawl Results")
    preview = _build_summary(results, len(visited), err_count)
    return aggregate, preview


# ---------------------------------------------------------------------------
# Result formatting
# ---------------------------------------------------------------------------

def _build_aggregate(results: List[Dict[str, Any]], job: Dict[str, Any], title: str) -> str:
    lines = [
        f"# {title}",
        "",
        f"- **Start URL:** {job.get('url', '—')}",
        f"- **Mode:** {job.get('mode', 'fetcher')}",
        f"- **Pages processed:** {len(results)}",
    ]
    if job.get("ai_prompt"):
        lines.append(f"- **AI prompt:** {job['ai_prompt']}")
    if job.get("selector"):
        lines.append(f"- **Selector:** {job['selector']}")
    lines += ["", "---", ""]

    for i, r in enumerate(results, 1):
        lines.append(f"## {i}. {r['url']}")
        depth = r.get("depth")
        if depth is not None:
            lines.append(f"*Depth: {depth}*")
        lines.append("")
        if r["status"] == "ok":
            lines.append(r["content"])
        else:
            lines.append(f"**ERROR:** {r.get('error', 'unknown')}")
        lines += ["", "---", ""]

    return "\n".join(lines)


def _build_summary(results: List[Dict[str, Any]], total: int, errors: int) -> str:
    ok_count = sum(1 for r in results if r["status"] == "ok")
    lines = [f"Processed: {total} | OK: {ok_count} | Errors: {errors}", ""]
    for r in results[:20]:
        status_mark = "OK" if r["status"] == "ok" else "ERR"
        detail = f"{r.get('length', 0)} chars" if r["status"] == "ok" else r.get("error", "")[:80]
        lines.append(f"[{status_mark}] {r['url'][:80]} — {detail}")
    if len(results) > 20:
        lines.append(f"... and {len(results) - 20} more")
    return "\n".join(lines)


def build_result_file(job: Dict[str, Any], content: str, output_format: str) -> tuple[bytes, str, str]:
    """Returns (data_bytes, content_type, file_extension)."""
    has_template = bool(job.get("template_id"))

    if has_template:
        return content.encode("utf-8"), "text/csv", "csv"

    job_type = job.get("job_type", "single")
    if job_type in ("batch", "crawl"):
        return content.encode("utf-8"), "text/markdown", "md"

    if output_format == "html":
        return content.encode("utf-8"), "text/html", "html"
    elif output_format == "text":
        return content.encode("utf-8"), "text/plain", "txt"
    else:
        lines = [
            "# Scrapling Result", "",
            f"- **URL:** {job['url']}",
            f"- **Mode:** {job.get('mode')}",
            f"- **Selector:** {job.get('selector') or 'body (default)'}",
        ]
        if job.get("ai_prompt"):
            lines.append(f"- **AI prompt:** {job['ai_prompt']}")
        lines += ["", "---", "", content, ""]
        return "\n".join(lines).encode("utf-8"), "text/markdown", "md"


# ---------------------------------------------------------------------------
# Scenario execution engine
# ---------------------------------------------------------------------------

def _rand_delay(rng: List[int]) -> None:
    if rng and len(rng) == 2:
        ms = random.randint(rng[0], rng[1])
        time.sleep(ms / 1000.0)


def _human_type_text(page: Any, selector: str, text: str, speed_rng: List[int]) -> None:
    """Type text character-by-character with random delays and occasional typo."""
    el = page.query_selector(selector)
    if not el:
        raise RuntimeError(f"Element not found: {selector}")
    el.click()
    lo = speed_rng[0] if speed_rng else 30
    hi = speed_rng[1] if speed_rng else 120
    for i, ch in enumerate(text):
        if random.random() < 0.04 and i > 0 and len(text) > 4:
            wrong = chr(random.randint(97, 122))
            page.keyboard.press(wrong)
            time.sleep(random.randint(lo, hi) / 1000.0)
            page.keyboard.press("Backspace")
            time.sleep(random.randint(lo, hi) / 1000.0)
        page.keyboard.press(ch)
        time.sleep(random.randint(lo, hi) / 1000.0)


def _mouse_jitter(page: Any, selector: str) -> None:
    """Move mouse to element along a noisy bezier path."""
    box = page.query_selector(selector)
    if not box:
        return
    bb = box.bounding_box()
    if not bb:
        return
    tx = bb["x"] + bb["width"] * random.uniform(0.3, 0.7)
    ty = bb["y"] + bb["height"] * random.uniform(0.3, 0.7)
    sx = random.uniform(0, bb["x"])
    sy = random.uniform(0, bb["y"])
    steps = random.randint(5, 12)
    for s in range(1, steps + 1):
        t = s / steps
        cx = sx + (tx - sx) * t + random.uniform(-8, 8) * (1 - t)
        cy = sy + (ty - sy) * t + random.uniform(-8, 8) * (1 - t)
        page.mouse.move(cx, cy)
        time.sleep(random.uniform(0.005, 0.025))


def _scroll_noise(page: Any) -> None:
    amt = random.randint(30, 200) * random.choice([1, -1])
    page.evaluate(f"window.scrollBy(0, {amt})")
    time.sleep(random.uniform(0.1, 0.4))


class ScenarioExecutor:
    """Interprets a parsed YAML scenario step-by-step in a Playwright page."""

    def __init__(self, page: Any, randomize: Dict[str, Any]):
        self._page = page
        self._rnd = randomize
        self._delay_rng = randomize.get("delay", [500, 2000])
        self._speed_rng = randomize.get("typing_speed", [30, 120])
        self._jitter = randomize.get("mouse_jitter", False)
        self._scroll_noise = randomize.get("scroll_noise", False)
        self.logs: List[str] = []
        self.data: Dict[str, Any] = {}
        self.result_meta: Dict[str, Any] = {}

    def _auto_pause(self) -> None:
        _rand_delay(self._delay_rng)

    def _pre_click_noise(self, selector: str) -> None:
        if self._jitter:
            try:
                _mouse_jitter(self._page, selector)
            except Exception:
                pass
        if self._scroll_noise and random.random() < 0.3:
            _scroll_noise(self._page)

    def run(self, steps: List[Any]) -> None:
        for step in steps:
            self._exec_step(step)

    def _exec_step(self, step: Any) -> None:
        if isinstance(step, str):
            self.logs.append(step)
            return

        if not isinstance(step, dict):
            return

        for key, val in step.items():
            key_l = key.lower()

            if key_l == "navigate":
                self._auto_pause()
                self._page.goto(str(val), wait_until="domcontentloaded", timeout=60000)

            elif key_l == "click":
                sel = val if isinstance(val, str) else val.get("selector", "")
                self._pre_click_noise(sel)
                self._auto_pause()
                self._page.click(sel, timeout=15000)

            elif key_l == "fill":
                sel = val.get("selector", "")
                text = str(val.get("text", ""))
                self._auto_pause()
                if val.get("human_typing") and self._speed_rng:
                    _human_type_text(self._page, sel, text, self._speed_rng)
                else:
                    self._page.fill(sel, text)

            elif key_l == "type":
                sel = val.get("selector", "")
                text = str(val.get("text", ""))
                self._auto_pause()
                if val.get("human_typing") and self._speed_rng:
                    _human_type_text(self._page, sel, text, self._speed_rng)
                else:
                    self._page.type(sel, text)

            elif key_l == "select":
                sel = val.get("selector", "")
                value = str(val.get("value", ""))
                self._auto_pause()
                self._page.select_option(sel, value)

            elif key_l == "hover":
                sel = val if isinstance(val, str) else val.get("selector", "")
                self._pre_click_noise(sel)
                self._auto_pause()
                self._page.hover(sel)

            elif key_l == "wait":
                if isinstance(val, str):
                    if val in ("networkidle", "domcontentloaded", "load", "commit"):
                        self._page.wait_for_load_state(val, timeout=30000)
                    else:
                        self._page.wait_for_selector(val, timeout=30000)
                elif isinstance(val, dict):
                    sel = val.get("selector", "")
                    timeout = int(val.get("timeout", 30000))
                    if sel:
                        self._page.wait_for_selector(sel, timeout=timeout)

            elif key_l == "delay":
                if isinstance(val, list) and len(val) == 2:
                    _rand_delay(val)
                elif isinstance(val, (int, float)):
                    time.sleep(val / 1000.0)

            elif key_l == "extract":
                sel = val.get("selector", "")
                attr = val.get("attribute", "")
                save_as = val.get("save_as", "")
                try:
                    el = self._page.query_selector(sel)
                    if el:
                        if attr:
                            extracted = el.get_attribute(attr) or ""
                        else:
                            extracted = el.inner_text() or ""
                    else:
                        extracted = ""
                except Exception as e:
                    extracted = f"[error: {e}]"
                if save_as:
                    self.data[save_as] = extracted
                self.logs.append(f"extract {save_as}={extracted[:80]}")

            elif key_l == "screenshot":
                try:
                    img = self._page.screenshot(type="png")
                    self.data["_last_screenshot"] = len(img)
                    self.logs.append("screenshot taken")
                except Exception as e:
                    self.logs.append(f"screenshot error: {e}")

            elif key_l == "scroll":
                if isinstance(val, str) and val == "bottom":
                    self._page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                elif isinstance(val, str) and val == "top":
                    self._page.evaluate("window.scrollTo(0, 0)")
                elif isinstance(val, (int, float)):
                    self._page.evaluate(f"window.scrollBy(0, {val})")
                elif isinstance(val, dict):
                    sel = val.get("selector", "")
                    if sel:
                        self._page.query_selector(sel).scroll_into_view_if_needed()
                self._auto_pause()

            elif key_l == "evaluate":
                js_code = str(val)
                try:
                    result = self._page.evaluate(js_code)
                    self.logs.append(f"evaluate result: {str(result)[:100]}")
                except Exception as e:
                    self.logs.append(f"evaluate error: {e}")

            elif key_l == "keyboard":
                key_name = str(val)
                self._page.keyboard.press(key_name)
                self._auto_pause()

            elif key_l == "log":
                self.logs.append(str(val))

            elif key_l == "result":
                if isinstance(val, dict):
                    self.result_meta.update(val)

            elif key_l == "if":
                exists_sel = val.get("exists", "")
                not_exists_sel = val.get("not_exists", "")
                then_steps = val.get("then", [])
                else_steps = val.get("else", [])

                condition_met = False
                if exists_sel:
                    el = self._page.query_selector(exists_sel)
                    condition_met = el is not None
                elif not_exists_sel:
                    el = self._page.query_selector(not_exists_sel)
                    condition_met = el is None

                if condition_met:
                    self.run(then_steps)
                else:
                    self.run(else_steps)

            else:
                self.logs.append(f"unknown step: {key}")


def _execute_scenario_for_profile(
    token: str, profile_id: str, scenario_yaml: Dict[str, Any],
    gl_config: Dict[str, Any],
) -> Dict[str, Any]:
    """Run a parsed scenario in one GoLogin profile. Returns a result dict."""
    t0 = time.time()
    logs: List[str] = []
    data: Dict[str, Any] = {}
    try:
        proxy_type = gl_config.get("proxy_type", "residential")
        wait_until = gl_config.get("wait_until", "networkidle")
        wait_timeout_sec = gl_config.get("wait_timeout_sec", 60)
        country = gl_config.get("default_country", "")

        profiles_list = gl_config.get("profiles", [])
        custom_proxy = ""
        matched = [p for p in profiles_list if p.get("profile_id") == profile_id]
        if matched and matched[0].get("custom_proxy"):
            custom_proxy = matched[0]["custom_proxy"]

        gl = GoLoginBrowser(
            token=token,
            country="",
            custom_proxy=custom_proxy,
            proxy_type=proxy_type,
            wait_until=wait_until,
            wait_timeout_sec=wait_timeout_sec,
            profile_id=profile_id,
        )

        randomize = scenario_yaml.get("randomize", {})
        steps = scenario_yaml.get("steps", [])

        with gl:
            page = gl._browser.new_page()
            try:
                viewport_w = random.randint(1280, 1920)
                viewport_h = random.randint(720, 1080)
                page.set_viewport_size({"width": viewport_w, "height": viewport_h})

                executor = ScenarioExecutor(page, randomize)
                executor.run(steps)
                logs = executor.logs
                data = executor.data
                result_meta = executor.result_meta
            finally:
                page.close()

        duration_ms = int((time.time() - t0) * 1000)
        return {
            "status": result_meta.get("status", "ok"),
            "logs": logs,
            "data": data,
            "duration_ms": duration_ms,
            **{k: v for k, v in result_meta.items() if k != "status"},
        }
    except Exception as e:
        duration_ms = int((time.time() - t0) * 1000)
        return {
        "status": "error",
            "error": str(e)[:500],
            "logs": logs,
            "data": data,
            "duration_ms": duration_ms,
        }


def fetch_one_queued_scenario_run() -> Optional[Dict[str, Any]]:
    conn = pg_connect()
    conn.autocommit = False
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM public.scrapling_scenario_runs
                WHERE status = 'queued'
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            """)
            row = cur.fetchone()
            if not row:
                conn.commit()
                return None
            cur.execute(
                "UPDATE public.scrapling_scenario_runs SET status = 'running', started_at = now() WHERE id = %s",
                (row["id"],),
            )
            conn.commit()
            return dict(row)
    finally:
        conn.close()


def update_scenario_run(run_id: str, status: str, results: Dict[str, Any], error_msg: Optional[str] = None) -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE public.scrapling_scenario_runs
                   SET status = %s, results = %s, error_message = %s,
                       completed_at = CASE WHEN %s IN ('done','error') THEN now() ELSE completed_at END
                   WHERE id = %s""",
                (status, json.dumps(results), error_msg, status, run_id),
            )
        conn.commit()
    finally:
        conn.close()


def load_scenario(scenario_id: str) -> Optional[Dict[str, Any]]:
    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("SELECT * FROM public.scrapling_scenarios WHERE id = %s", (scenario_id,))
            row = cur.fetchone()
            return dict(row) if row else None
    finally:
        conn.close()


def process_scenario_run(run: Dict[str, Any]) -> None:
    run_id = str(run["id"])
    scenario_id = str(run["scenario_id"])
    profile_ids = run.get("profile_ids") or []
    if isinstance(profile_ids, str):
        profile_ids = json.loads(profile_ids)
    concurrency = max(1, int(run.get("concurrency", 1)))

    scenario = load_scenario(scenario_id)
    if not scenario:
        update_scenario_run(run_id, "error", {}, "Scenario not found")
        return

    yaml_text = scenario.get("yaml_content", "")
    try:
        parsed = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as e:
        update_scenario_run(run_id, "error", {}, f"YAML parse error: {e}")
        return

    gl_config = _load_gologin_config()
    token = _resolve_gologin_token()
    if not token:
        update_scenario_run(run_id, "error", {}, "GoLogin API token not configured")
        return

    if not profile_ids:
        cfg_profiles = gl_config.get("profiles", [])
        profile_ids = [p["profile_id"] for p in cfg_profiles if p.get("profile_id")]
    if not profile_ids:
        update_scenario_run(run_id, "error", {}, "No profiles selected or configured")
        return

    log(f"scenario run {run_id}: {len(profile_ids)} profiles, concurrency={concurrency}")
    all_results: Dict[str, Any] = {"profiles": {}}
    completed = 0

    def _run_one(pid: str) -> tuple:
        r = _execute_scenario_for_profile(token, pid, parsed, gl_config)
        return pid, r

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {pool.submit(_run_one, pid): pid for pid in profile_ids}
        for future in as_completed(futures):
            pid = futures[future]
            try:
                _, result = future.result()
            except Exception as e:
                result = {"status": "error", "error": str(e), "logs": [], "data": {}, "duration_ms": 0}
            all_results["profiles"][pid] = result
            completed += 1
            log(f"  profile {pid}: {result.get('status')} ({result.get('duration_ms',0)}ms)")
            try:
                update_scenario_run(run_id, "running", all_results)
            except Exception:
                pass

    ok_count = sum(1 for r in all_results["profiles"].values() if r.get("status") == "ok")
    total = len(all_results["profiles"])
    final_status = "done" if ok_count > 0 else "error"
    summary = f"{ok_count}/{total} profiles succeeded"
    all_results["summary"] = summary
    update_scenario_run(run_id, final_status, all_results, None if final_status == "done" else summary)
    log(f"scenario run {run_id} finished: {summary}")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main_loop():
    log("Starting scrapling-worker v6 (cascading keys + agent API)")
    gemini_ok = bool(_resolve_gemini_keys())
    gologin_ok = bool(_resolve_gologin_token())
    log(f"AI extraction: {'enabled' if gemini_ok else 'disabled (no Gemini key)'}")
    log(f"GoLogin: {'configured' if gologin_ok else 'not configured'}")

    while True:
        try:
            job = fetch_one_queued_job()
            if job:
            job_id = str(job["id"])
                job_type = job.get("job_type", "single")
                log(f"processing job {job_id} type={job_type} url={job.get('url','')}")
                try:
                    if job_type == "batch":
                        content, preview = process_batch(job)
                    elif job_type == "crawl":
                        content, preview = process_crawl(job)
                    else:
                        content, preview = process_single(job)
                    output_format = (job.get("output_format") or "markdown").lower()
                    data, content_type, ext = build_result_file(job, content, output_format)
                    object_path = f"{RESULT_PREFIX}/{job_id}.{ext}"
                    supabase_storage_upload(RESULT_BUCKET, object_path, data, content_type)
                update_job_success(job_id, object_path, preview)
                log(f"job {job_id} done -> {object_path}")
                except Exception as e:
                log(f"job {job_id} failed: {e}")
                update_job_error(job_id, str(e))
                continue

            scenario_run = fetch_one_queued_scenario_run()
            if scenario_run:
                try:
                    process_scenario_run(scenario_run)
                except Exception as e:
                    log(f"scenario run {scenario_run['id']} failed: {e}")
                    update_scenario_run(str(scenario_run["id"]), "error", {}, str(e)[:2000])
                continue

            time.sleep(POLL_INTERVAL_SEC)
        except Exception as e:
            log("loop error:", e)
            time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main_loop()
