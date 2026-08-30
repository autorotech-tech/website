"""Google Custom Search JSON API for Swoop (agent-api).

Docs: https://developers.google.com/custom-search/v1/overview
Endpoint: GET https://www.googleapis.com/customsearch/v1?key=&cx=&q=

Needs an API key (Credentials → API key) plus a Programmable Search Engine `cx`.
This is not the OAuth web client used for Google Sign-In.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1"
DEFAULT_CX = ""


def resolve_google_cse_cx(settings: Optional[Dict[str, Any]] = None, override: str = "") -> str:
    if override and str(override).strip():
        return str(override).strip()
    return str((settings or {}).get("google_cse_cx") or "").strip()


def http_get_json(url: str, timeout: int = 25) -> Tuple[int, Optional[Any], str]:
    req = Request(url, headers={"Accept": "application/json"}, method="GET")
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


def _error_message(body: Optional[Any], raw: str, code: int) -> str:
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            msg = str(err.get("message") or "").strip()
            if msg:
                return msg[:400]
        msg = str(body.get("message") or "").strip()
        if msg:
            return msg[:400]
    return (raw or f"http_{code}")[:400]


def verify_google_cse_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    key = str(api_key or "").strip()
    if not key:
        return False, 400, "empty_key"
    cx = resolve_google_cse_cx(settings)
    if not cx:
        return False, 400, "google_cse_cx_not_configured"
    q = urlencode({"key": key, "cx": cx, "q": "autoro.tech", "num": 1})
    code, body, raw = http_get_json(f"{CSE_ENDPOINT}?{q}", timeout=20)
    if code == 200 and isinstance(body, dict):
        return True, 200, "ok"
    return False, code if code > 0 else 502, _error_message(body, raw, code)


def google_cse_search_raw(
    api_key: str,
    query: str,
    *,
    limit: int = 10,
    cx: str = "",
    settings: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    key = str(api_key or "").strip()
    engine = resolve_google_cse_cx(settings, cx)
    q = str(query or "").strip()
    num = max(1, min(int(limit or 10), 10))
    if not key:
        return {"ok": False, "http_code": 400, "error": "empty_key", "items": []}
    if not engine:
        return {"ok": False, "http_code": 400, "error": "google_cse_cx_not_configured", "items": []}
    if not q:
        return {"ok": False, "http_code": 400, "error": "empty_query", "items": []}

    params = urlencode({"key": key, "cx": engine, "q": q, "num": num})
    code, body, raw = http_get_json(f"{CSE_ENDPOINT}?{params}", timeout=25)
    if code != 200 or not isinstance(body, dict):
        return {
            "ok": False,
            "http_code": code if code > 0 else 502,
            "error": _error_message(body, raw, code),
            "items": [],
        }
    rows = body.get("items") if isinstance(body.get("items"), list) else []
    items: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        link = str(row.get("link") or "").strip()
        if not link:
            continue
        items.append(
            {
                "title": str(row.get("title") or "").strip(),
                "url": link,
                "snippet": str(row.get("snippet") or "").strip(),
                "displayLink": str(row.get("displayLink") or "").strip(),
                "sourceProvider": "google_cse",
            }
        )
    search_info = body.get("searchInformation") if isinstance(body.get("searchInformation"), dict) else {}
    return {
        "ok": True,
        "http_code": 200,
        "error": "",
        "cx": engine,
        "total_results": str(search_info.get("totalResults") or ""),
        "items": items,
    }


def google_cse_web_search(
    api_key: str,
    query: str,
    limit: int = 8,
    *,
    settings: Optional[Dict[str, Any]] = None,
    cx: str = "",
) -> List[Dict[str, Any]]:
    result = google_cse_search_raw(api_key, query, limit=limit, cx=cx, settings=settings)
    if not result.get("ok"):
        return []
    out: List[Dict[str, Any]] = []
    for item in result.get("items") or []:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": str(item.get("title") or url)[:300],
                "url": url,
                "summary": str(item.get("snippet") or "")[:400],
                "category": "external",
                "tags": ["external", "web-search", "google-cse"],
                "sourceProvider": "google_cse",
            }
        )
        if len(out) >= max(1, int(limit or 8)):
            break
    return out
