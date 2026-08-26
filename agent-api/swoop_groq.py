"""Groq API key verification for Swoop admin (agent-api)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def is_proxy_blocked(code: int, msg: str) -> bool:
    text = (msg or "").lower()
    if "1010" in text or "cloudflare" in text or "proxy_blocked" in text:
        return True
    if code == 403 and ("access denied" in text or "ray id" in text or "blocked" in text):
        return True
    return False


def groq_api_base(settings: Optional[Dict[str, Any]] = None) -> str:
    del settings
    return os.environ.get("BOOKMARKS_GROQ_BASE", "https://api.groq.com/openai/v1").strip().rstrip("/")


def _http_get_json(url: str, headers: Dict[str, str], timeout: int) -> Tuple[int, Optional[Any], str]:
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


def verify_groq_key(
    api_key: str,
    *,
    api_base: Optional[str] = None,
    model: str = "",
    timeout: int = 12,
) -> Tuple[bool, int, str]:
    """Verify Groq key via GET /models (lightweight), then optional chat ping."""
    clean = str(api_key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    base = (api_base or groq_api_base()).rstrip("/")
    headers = {"Authorization": f"Bearer {clean}", "Accept": "application/json"}

    code, body, raw = _http_get_json(base + "/models", headers, timeout=timeout)
    if code == 200 and isinstance(body, dict):
        data = body.get("data")
        if isinstance(data, list) and data:
            return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    if is_proxy_blocked(code, msg):
        return False, code or 403, f"proxy_blocked: {msg[:240]}"

    if code in {401, 403} and ("invalid" in msg.lower() or "unauthorized" in msg.lower()):
        return False, code, msg

    if model:
        url = base + "/chat/completions"
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": "ping"}],
            "temperature": 0.1,
            "max_tokens": 5,
        }
        code2, body2, raw2 = _http_post_json(url, headers, payload, timeout=timeout)
        if code2 == 200 and isinstance(body2, dict):
            return True, 200, "ok"
        msg2 = (raw2 or "")[:400] if raw2 else f"http_{code2}"
        if is_proxy_blocked(code2, msg2):
            return False, code2 or 403, f"proxy_blocked: {msg2[:240]}"
        return False, code2, msg2

    if code == 200:
        return True, 200, "ok"
    return False, code, msg
