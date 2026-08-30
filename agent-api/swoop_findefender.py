"""FinDefender (bankruptcy bot) admin bridge for Swoop.

Stores settings in public.service_settings and proxies KB admin calls
to the FinDefender FastAPI service (X-API-Key = FinDefender SWOOP_API_KEY).
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Dict, Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

logger = logging.getLogger("autoro-findefender")

router = APIRouter(prefix="/api/v1/findefender", tags=["findefender"])

_pg_connect: Optional[Callable[[], Any]] = None
_load_swoop_settings: Optional[Callable[[], Dict[str, Any]]] = None
_verify_agent_key: Optional[Callable[[Optional[str]], None]] = None

SETTINGS_COLUMNS = (
    ("findefender_api_base", "text", "''"),
    ("findefender_admin_api_key", "text", "''"),
    ("findefender_telegram_bot_token", "text", "''"),
    ("findefender_telegram_hitl_group_id", "text", "''"),
    ("findefender_app_public_url", "text", "''"),
    ("findefender_bot_username", "text", "'@FinDefender_bot'"),
    ("findefender_group_username", "text", "'@findefender'"),
    ("findefender_notes", "text", "''"),
)


def configure_findefender(
    *,
    pg_connect: Callable[[], Any],
    load_swoop_settings: Callable[[], Dict[str, Any]],
    verify_agent_key: Callable[[Optional[str]], None],
) -> None:
    global _pg_connect, _load_swoop_settings, _verify_agent_key
    _pg_connect = pg_connect
    _load_swoop_settings = load_swoop_settings
    _verify_agent_key = verify_agent_key


def _conn():
    if _pg_connect is None:
        raise HTTPException(status_code=503, detail="FinDefender module not configured")
    return _pg_connect()


def _require_key(x_api_key: Optional[str]) -> None:
    if _verify_agent_key is None:
        raise HTTPException(status_code=503, detail="FinDefender module not configured")
    _verify_agent_key(x_api_key)


def ensure_findefender_schema() -> None:
    conn = _conn()
    try:
        with conn.cursor() as cur:
            for col, typ, default in SETTINGS_COLUMNS:
                cur.execute(
                    f"""
                    ALTER TABLE public.service_settings
                    ADD COLUMN IF NOT EXISTS {col} {typ} NOT NULL DEFAULT {default}
                    """
                )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("ensure_findefender_schema failed: %s", exc)
    finally:
        conn.close()


def _mask_secret(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    if len(raw) <= 8:
        return "********"
    return f"{'*' * max(4, len(raw) - 4)}{raw[-4:]}"


def _load_settings_row() -> Dict[str, Any]:
    if _load_swoop_settings is None:
        return {}
    try:
        return dict(_load_swoop_settings() or {})
    except Exception as exc:
        logger.warning("load findefender settings: %s", exc)
        return {}


def _public_settings(row: Dict[str, Any]) -> Dict[str, Any]:
    token = str(row.get("findefender_telegram_bot_token") or "")
    admin_key = str(row.get("findefender_admin_api_key") or "")
    return {
        "api_base": str(row.get("findefender_api_base") or "").strip().rstrip("/"),
        "admin_api_key_set": bool(admin_key.strip()),
        "admin_api_key_masked": _mask_secret(admin_key),
        "telegram_bot_token_set": bool(token.strip()),
        "telegram_bot_token_masked": _mask_secret(token),
        "telegram_hitl_group_id": str(row.get("findefender_telegram_hitl_group_id") or "").strip(),
        "app_public_url": str(row.get("findefender_app_public_url") or "").strip().rstrip("/"),
        "bot_username": str(row.get("findefender_bot_username") or "@FinDefender_bot").strip()
        or "@FinDefender_bot",
        "group_username": str(row.get("findefender_group_username") or "@findefender").strip()
        or "@findefender",
        "notes": str(row.get("findefender_notes") or ""),
        "webhook_url": _webhook_url(row),
    }


def _webhook_url(row: Dict[str, Any]) -> str:
    base = str(row.get("findefender_app_public_url") or "").strip().rstrip("/")
    if not base:
        return ""
    return f"{base}/webhook/telegram"


def _proxy_base_and_key(row: Dict[str, Any]) -> tuple[str, str]:
    base = str(row.get("findefender_api_base") or "").strip().rstrip("/")
    key = str(row.get("findefender_admin_api_key") or "").strip()
    if not base:
        raise HTTPException(
            status_code=400,
            detail="Задайте FinDefender API base URL в настройках (например http://localhost:8000)",
        )
    if not key:
        raise HTTPException(
            status_code=400,
            detail="Задайте FinDefender admin API key (тот же, что SWOOP_API_KEY на боте)",
        )
    return base, key


def _proxy_json(
    method: str,
    path: str,
    *,
    body: Optional[Dict[str, Any]] = None,
    timeout: int = 120,
) -> Dict[str, Any]:
    row = _load_settings_row()
    base, key = _proxy_base_and_key(row)
    url = f"{base}{path}"
    data = None
    headers = {
        "Accept": "application/json",
        "X-API-Key": key,
        "User-Agent": "Autoro-Swoop-FinDefender/1.0",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            detail = parsed.get("detail") or detail
        except Exception:
            pass
        raise HTTPException(status_code=int(exc.code), detail=detail or f"FinDefender HTTP {exc.code}") from exc
    except URLError as exc:
        raise HTTPException(status_code=502, detail=f"FinDefender unreachable: {exc.reason}") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail=f"Invalid JSON from FinDefender: {exc}") from exc


class FinDefenderSettingsUpdate(BaseModel):
    api_base: Optional[str] = None
    admin_api_key: Optional[str] = None
    telegram_bot_token: Optional[str] = None
    telegram_hitl_group_id: Optional[str] = None
    app_public_url: Optional[str] = None
    bot_username: Optional[str] = None
    group_username: Optional[str] = None
    notes: Optional[str] = None
    clear_telegram_bot_token: bool = False
    clear_admin_api_key: bool = False


class IngestTextBody(BaseModel):
    source: str = Field(..., min_length=1, max_length=180)
    text: str = Field(..., min_length=1, max_length=2_000_000)


@router.get("/settings")
def get_settings(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    ensure_findefender_schema()
    return _public_settings(_load_settings_row())


@router.put("/settings")
def put_settings(
    body: FinDefenderSettingsUpdate,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    _require_key(x_api_key)
    ensure_findefender_schema()
    updates: Dict[str, Any] = {}
    if body.api_base is not None:
        updates["findefender_api_base"] = body.api_base.strip().rstrip("/")
    if body.admin_api_key is not None and body.admin_api_key.strip():
        updates["findefender_admin_api_key"] = body.admin_api_key.strip()
    if body.clear_admin_api_key:
        updates["findefender_admin_api_key"] = ""
    if body.telegram_bot_token is not None and body.telegram_bot_token.strip():
        updates["findefender_telegram_bot_token"] = body.telegram_bot_token.strip()
    if body.clear_telegram_bot_token:
        updates["findefender_telegram_bot_token"] = ""
    if body.telegram_hitl_group_id is not None:
        updates["findefender_telegram_hitl_group_id"] = body.telegram_hitl_group_id.strip()
    if body.app_public_url is not None:
        updates["findefender_app_public_url"] = body.app_public_url.strip().rstrip("/")
    if body.bot_username is not None:
        updates["findefender_bot_username"] = body.bot_username.strip() or "@FinDefender_bot"
    if body.group_username is not None:
        updates["findefender_group_username"] = body.group_username.strip() or "@findefender"
    if body.notes is not None:
        updates["findefender_notes"] = body.notes

    if not updates:
        return _public_settings(_load_settings_row())

    conn = _conn()
    try:
        cols = list(updates.keys())
        sets = ", ".join(f"{c} = %s" for c in cols)
        values = [updates[c] for c in cols]
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE public.service_settings SET {sets}, updated_at = NOW() WHERE id = 1",
                values,
            )
            if cur.rowcount == 0:
                # insert minimal row if missing
                cur.execute(
                    """
                    INSERT INTO public.service_settings (id)
                    VALUES (1)
                    ON CONFLICT (id) DO NOTHING
                    """
                )
                cur.execute(
                    f"UPDATE public.service_settings SET {sets}, updated_at = NOW() WHERE id = 1",
                    values,
                )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save settings: {exc}") from exc
    finally:
        conn.close()
    return _public_settings(_load_settings_row())


@router.get("/health")
def health_proxy(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    row = _load_settings_row()
    base = str(row.get("findefender_api_base") or "").strip().rstrip("/")
    if not base:
        return {"ok": False, "reachable": False, "detail": "api_base not set"}
    try:
        req = Request(
            f"{base}/health",
            headers={"Accept": "application/json", "User-Agent": "Autoro-Swoop-FinDefender/1.0"},
            method="GET",
        )
        with urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw) if raw else {}
        return {"ok": True, "reachable": True, "health": data, "api_base": base}
    except Exception as exc:
        return {"ok": False, "reachable": False, "detail": str(exc), "api_base": base}


@router.get("/status")
def status_proxy(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    return _proxy_json("GET", "/admin/status")


@router.get("/kb/sources")
def kb_sources(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    return _proxy_json("GET", "/admin/kb/sources")


@router.post("/kb/ingest")
def kb_ingest(
    body: IngestTextBody,
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    _require_key(x_api_key)
    return _proxy_json("POST", "/admin/kb/ingest", body=body.model_dump())


@router.post("/kb/sync-files")
def kb_sync_files(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    return _proxy_json("POST", "/admin/kb/sync-files", body={}, timeout=300)


@router.post("/kb/upload")
async def kb_upload(
    file: UploadFile = File(...),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
):
    """Read upload in agent-api, then forward as JSON ingest (avoids multipart proxy complexity)."""
    _require_key(x_api_key)
    name = (file.filename or "upload.md").strip()
    lower = name.lower()
    if not (lower.endswith(".md") or lower.endswith(".txt") or lower.endswith(".markdown")):
        raise HTTPException(status_code=400, detail="Only .md / .txt files allowed")
    raw = await file.read()
    if len(raw) > 2_000_000:
        raise HTTPException(status_code=400, detail="File too large (max 2MB)")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
    if not text.strip():
        raise HTTPException(status_code=400, detail="Empty file")
    from pathlib import Path

    source = Path(name).name
    return _proxy_json("POST", "/admin/kb/ingest", body={"source": source, "text": text}, timeout=300)
