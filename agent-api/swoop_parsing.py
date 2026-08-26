"""Parsing/scraping provider key verification for Swoop admin (pquoc.com pipelines)."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from swoop_groq import is_proxy_blocked


def _http_get(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 20) -> Tuple[int, str]:
    req = Request(url, headers=headers or {}, method="GET")
    try:
        with urlopen(req, timeout=timeout) as resp:
            return int(resp.getcode() or 200), resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return -1, str(exc)


def _http_post_json(url: str, headers: Dict[str, str], payload: Dict[str, Any], timeout: int = 25) -> Tuple[int, str]:
    data = json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as resp:
            return int(resp.getcode() or 200), resp.read().decode("utf-8", errors="replace")
    except HTTPError as exc:
        return int(exc.code), exc.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return -1, str(exc)


def verify_apify_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    del settings
    clean = str(api_key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    q = urlencode({"token": clean})
    code, raw = _http_get(f"https://api.apify.com/v2/users/me?{q}", timeout=20)
    if code == 200:
        try:
            body = json.loads(raw)
            if isinstance(body, dict) and body.get("data"):
                return True, 200, "ok"
        except json.JSONDecodeError:
            pass
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    if is_proxy_blocked(code, msg):
        return False, code, f"proxy_blocked: {msg[:200]}"
    return False, code, msg


def verify_scrapingbee_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    del settings
    clean = str(api_key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    q = urlencode({"api_key": clean})
    code, raw = _http_get(f"https://app.scrapingbee.com/api/v1/usage?{q}", timeout=20)
    if code == 200:
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    if is_proxy_blocked(code, msg):
        return False, code, f"proxy_blocked: {msg[:200]}"
    return False, code, msg


def brightdata_api_base(settings: Optional[Dict[str, Any]]) -> str:
    row = str((settings or {}).get("brightdata_base_url") or "").strip()
    return (row or "https://api.brightdata.com").rstrip("/")


def brightdata_zone(settings: Optional[Dict[str, Any]]) -> str:
    return str((settings or {}).get("brightdata_zone") or "").strip()


def verify_brightdata_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    clean = str(api_key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    zone = brightdata_zone(settings)
    if not zone:
        return False, 400, "brightdata_zone_not_configured"
    base = brightdata_api_base(settings)
    headers = {"Authorization": f"Bearer {clean}", "Content-Type": "application/json"}
    payload = {"zone": zone, "url": "https://example.com/", "format": "raw"}
    code, raw = _http_post_json(f"{base}/request", headers, payload, timeout=30)
    if code in {200, 201}:
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    if code == 400 and "not found" in msg.lower():
        return False, 400, f"zone_invalid: {zone}"
    if is_proxy_blocked(code, msg):
        return False, code, f"proxy_blocked: {msg[:200]}"
    if code in {401, 403}:
        return False, code, msg
    if code == 429:
        return False, 429, msg
    return False, code, msg


def omkar_api_base(settings: Optional[Dict[str, Any]]) -> str:
    row = str((settings or {}).get("omkar_base_url") or "").strip()
    return (row or "https://tripadvisor-scraper-api.omkar.cloud/tripadvisor/hotels/list").strip()


def verify_omkar_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    clean = str(api_key or "").strip()
    if not clean:
        return False, 400, "empty_key"
    base = omkar_api_base(settings)
    q = urlencode({"query": "test", "page": "1"})
    url = f"{base}?{q}" if "?" not in base else f"{base}&{q}"
    headers = {"API-Key": clean, "Accept": "application/json"}
    code, raw = _http_get(url, headers=headers, timeout=25)
    if code == 200:
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    if code == 400 and "phone" in msg.lower():
        return False, 400, "omkar_phone_verification_required"
    if is_proxy_blocked(code, msg):
        return False, code, f"proxy_blocked: {msg[:200]}"
    return False, code, msg
