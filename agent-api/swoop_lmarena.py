"""LMArenaBridge — OpenAI-compatible upstream for Swoop (agent-api)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def lmarena_api_base(settings: Dict[str, Any]) -> str:
    row = str(settings.get("lmarena_base_url") or "").strip()
    if row:
        return row.rstrip("/")
    env = os.environ.get("BOOKMARKS_LMARENA_API_BASE", "").strip()
    if env:
        return env.rstrip("/")
    return "http://127.0.0.1:8000/api/v1"


def resolve_lmarena_model(step_model: str, settings: Dict[str, Any]) -> str:
    m = (step_model or "").strip()
    if m:
        return m
    return str(settings.get("lmarena_default_model") or "").strip() or "default"


def http_get_json(url: str, headers: Dict[str, str], timeout: int = 20) -> Tuple[int, Optional[Any], str]:
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


def fetch_models_catalog(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    keys = [str(k).strip() for k in (settings.get("lmarena_keys") or []) if str(k).strip()]
    if not keys:
        return []
    base = lmarena_api_base(settings)
    url = base.rstrip("/") + "/models"
    headers = {"Authorization": f"Bearer {keys[0]}", "Accept": "application/json"}
    code, body, _raw = http_get_json(url, headers, timeout=25)
    if code != 200 or not isinstance(body, dict):
        return []
    data = body.get("data")
    if not isinstance(data, list):
        return []
    out: List[Dict[str, Any]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if not mid:
            continue
        out.append(
            {
                "id": f"lmarena/{mid}",
                "object": "model",
                "created": int(item.get("created") or 1700000000),
                "owned_by": "lmarena",
            }
        )
    return out


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


def verify_lmarena_key(settings: Dict[str, Any], key: str, timeout: int = 25) -> Tuple[bool, int, str]:
    clean = str(key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    base = lmarena_api_base(settings)
    model = resolve_lmarena_model("", settings)
    url = base.rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {clean}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
        "temperature": 0.1,
        "max_tokens": 8,
    }
    code, body, raw = _http_post_json(url, headers, payload, timeout=timeout)
    if code == 200 and isinstance(body, dict):
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    return False, code, msg
