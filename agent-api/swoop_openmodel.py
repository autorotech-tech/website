"""OpenModel.ai — multi-model gateway for Swoop (agent-api).

Docs:
- https://docs.openmodel.ai/en/docs/getting-started/quickstart
- https://docs.openmodel.ai/en/docs/api-reference/models/listModels
- https://docs.openmodel.ai/en/docs/guides/billing (/web/v1/self — console ACCESS_TOKEN, not om- key)
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen

OPENMODEL_DEFAULT_ORIGIN = "https://api.openmodel.ai"
OPENMODEL_DEFAULT_MODEL = "deepseek-v4-flash"
MICRODOLLARS_PER_USD = 1_000_000


def openmodel_origin(settings: Dict[str, Any]) -> str:
    row = str(settings.get("openmodel_base_url") or "").strip()
    if row:
        return row.rstrip("/").removesuffix("/v1")
    env = os.environ.get("BOOKMARKS_OPENMODEL_API_BASE", "").strip()
    if env:
        return env.rstrip("/").removesuffix("/v1")
    return OPENMODEL_DEFAULT_ORIGIN


def resolve_openmodel_model(step_model: str, settings: Dict[str, Any]) -> str:
    m = (step_model or "").strip()
    if m:
        return m
    return str(settings.get("openmodel_default_model") or "").strip() or OPENMODEL_DEFAULT_MODEL


def microdollars_to_usd(value: Any) -> Optional[float]:
    try:
        micro = int(value)
    except (TypeError, ValueError):
        return None
    return round(micro / MICRODOLLARS_PER_USD, 4)


def http_get_json(url: str, headers: Dict[str, str], timeout: int = 25) -> Tuple[int, Optional[Any], str]:
    req = Request(url, headers=headers, method="GET")
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
        return -1, None, str(exc)


def _http_post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int) -> Tuple[int, Optional[Any], str]:
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers=headers, method="POST")
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
        return -1, None, str(exc)


def _auth_headers(api_key: str, *, anthropic: bool = False) -> Dict[str, str]:
    clean = str(api_key or "").strip()
    headers = {"Content-Type": "application/json"}
    if anthropic:
        headers["x-api-key"] = clean
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = f"Bearer {clean}"
    return headers


def fetch_openmodel_models(api_key: str, settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    key = str(api_key or "").strip()
    if not key:
        return []
    origin = openmodel_origin(settings or {})
    url = f"{origin}/v1/models"
    code, body, _raw = http_get_json(url, _auth_headers(key), timeout=30)
    if code != 200 or not isinstance(body, dict):
        return []
    out: List[Dict[str, Any]] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if not mid:
            continue
        apis = item.get("supported_apis")
        out.append(
            {
                "id": mid,
                "owned_by": str(item.get("owned_by") or "").strip(),
                "supported_apis": [str(x) for x in apis] if isinstance(apis, list) else [],
            }
        )
    out.sort(key=lambda m: (m.get("owned_by") or "", m.get("id") or ""))
    return out


def _parse_web_api_error(body: Any) -> Tuple[str, str]:
    if not isinstance(body, dict):
        return "", ""
    err = body.get("error")
    if isinstance(err, dict):
        return str(err.get("code") or "").strip(), str(err.get("msg") or "").strip()
    return "", ""


def _unwrap_web_api_data(body: Dict[str, Any]) -> Dict[str, Any]:
    if body.get("success") is True and isinstance(body.get("data"), dict):
        return body["data"]
    return body


def fetch_openmodel_balance(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, Dict[str, Any], str]:
    """Balance via GET /web/v1/self — requires console ACCESS_TOKEN (JWT), not om- API key."""
    key = str(api_key or "").strip()
    if not key:
        return False, {}, "empty_key"
    origin = openmodel_origin(settings or {})
    url = f"{origin}/web/v1/self"
    code, body, raw = http_get_json(url, _auth_headers(key), timeout=25)
    if not isinstance(body, dict):
        msg = (raw or "")[:400] if raw else f"http_{code}"
        return False, {}, msg

    err_code, err_msg = _parse_web_api_error(body)
    if err_code in ("INVALID_TOKEN", "TOKEN_EXPIRED", "UNAUTHORIZED"):
        return False, {
            "requires_console_token": True,
            "error_code": err_code or "UNAUTHORIZED",
        }, "console_access_token_required"

    if code != 200 or body.get("success") is False:
        msg = err_msg or (raw or "")[:400] if raw else f"http_{code}"
        return False, {}, msg

    data = _unwrap_web_api_data(body)
    balance_usd = microdollars_to_usd(data.get("balance"))
    frozen_usd = microdollars_to_usd(data.get("frozen_balance")) or 0.0
    available_usd = None
    if balance_usd is not None:
        available_usd = round(max(balance_usd - frozen_usd, 0.0), 4)
    payload = {
        "balance_usd": balance_usd,
        "frozen_usd": frozen_usd,
        "available_usd": available_usd,
        "currency": "USD",
        "raw_balance_microdollars": data.get("balance"),
        "raw_frozen_microdollars": data.get("frozen_balance"),
        "email": data.get("email"),
        "user_id": data.get("id") or data.get("user_id"),
    }
    return True, payload, "ok"


def _split_openai_messages(messages: List[Dict[str, Any]]) -> Tuple[str, List[Dict[str, Any]]]:
    system_parts: List[str] = []
    out: List[Dict[str, Any]] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "").strip().lower()
        content = msg.get("content")
        if role == "system":
            if isinstance(content, str) and content.strip():
                system_parts.append(content.strip())
            elif isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text = str(part.get("text") or "").strip()
                        if text:
                            system_parts.append(text)
            continue
        if role not in ("user", "assistant"):
            continue
        if isinstance(content, str):
            text = content
        elif isinstance(content, list):
            text = "".join(
                str(p.get("text") or "")
                for p in content
                if isinstance(p, dict) and (p.get("type") in (None, "text"))
            )
        else:
            text = str(content or "")
        if not text.strip() and role == "assistant":
            text = " "
        out.append({"role": role, "content": text})
    system = "\n\n".join(system_parts).strip()
    return system, out


def _assistant_text_from_message(body: Dict[str, Any]) -> str:
    parts = body.get("content")
    if not isinstance(parts, list):
        return ""
    chunks: List[str] = []
    for part in parts:
        if isinstance(part, dict) and part.get("type") == "text":
            chunks.append(str(part.get("text") or ""))
    return "".join(chunks).strip()


# Keep ≤ Job Responder primary slice so abandoned Threads die with FuturesTimeout
# (45s default previously starved uvicorn workers → nginx/CF HTTP 502).
OPENMODEL_CHAT_TIMEOUT_SEC = 20


def post_openmodel_messages_raw(
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    *,
    settings: Optional[Dict[str, Any]] = None,
    max_tokens: int = 1024,
    temperature: float = 0.35,
    timeout: int = OPENMODEL_CHAT_TIMEOUT_SEC,
) -> Tuple[Optional[Dict[str, Any]], int, str]:
    key = str(api_key or "").strip()
    m = str(model or "").strip() or OPENMODEL_DEFAULT_MODEL
    if not key:
        return None, 400, "empty_key"
    system, anthropic_messages = _split_openai_messages(messages)
    if not anthropic_messages:
        return None, 400, "empty_messages"
    origin = openmodel_origin(settings or {})
    url = f"{origin}/v1/messages"
    payload: Dict[str, Any] = {
        "model": m,
        "max_tokens": int(max_tokens),
        "messages": anthropic_messages,
        "temperature": temperature,
    }
    if system:
        payload["system"] = system
    http_timeout = max(5, int(timeout or OPENMODEL_CHAT_TIMEOUT_SEC))
    code, body, raw = _http_post_json(
        url, _auth_headers(key, anthropic=True), payload, timeout=http_timeout
    )
    if code == 200 and isinstance(body, dict):
        visible = _assistant_text_from_message(body)
        out = dict(body)
        if not visible:
            out["content"] = [{"type": "text", "text": ""}]
        out["finish_reason"] = body.get("stop_reason")
        return out, code, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    return None, code, msg


def post_openmodel_messages_text(
    api_key: str,
    model: str,
    messages: List[Dict[str, Any]],
    *,
    settings: Optional[Dict[str, Any]] = None,
    max_tokens: int = 1024,
    temperature: float = 0.35,
    timeout: int = OPENMODEL_CHAT_TIMEOUT_SEC,
) -> Tuple[Optional[str], int, str]:
    msg, code, status = post_openmodel_messages_raw(
        api_key,
        model,
        messages,
        settings=settings,
        max_tokens=max_tokens,
        temperature=temperature,
        timeout=timeout,
    )
    if msg is None:
        return None, code, status
    text = _assistant_text_from_message(msg)
    if text:
        return text, code, "ok"
    return " ", code, "ok"


def verify_openmodel_key(settings: Dict[str, Any], key: str, timeout: int = 25) -> Tuple[bool, int, str]:
    clean = str(key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    # Stable health-check model — do not use admin default (may be unavailable or paid-only).
    text, code, msg = post_openmodel_messages_text(
        clean,
        OPENMODEL_DEFAULT_MODEL,
        [{"role": "user", "content": "ping"}],
        settings=settings,
        max_tokens=8,
        temperature=0.1,
    )
    if text is not None and code == 200:
        return True, 200, "ok"
    return False, code, msg
