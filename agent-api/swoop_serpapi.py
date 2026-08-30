"""SerpApi — multi-engine search for Swoop (agent-api).

Docs:
- https://serpapi.com/search-api
- https://serpapi.com/account-api
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SERPAPI_ORIGIN = "https://serpapi.com"
DEFAULT_ENGINE = "google"

SERPAPI_ENGINE_PRESETS: List[str] = [
    "google",
    "yandex",
    "bing",
    "duckduckgo",
    "google_maps",
    "google_trends",
    "youtube",
    "google_short_videos",
]

# Moscow / Russia defaults for SEO deliverables.
SERPAPI_GEO_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "google": {
        "google_domain": "google.ru",
        "gl": "ru",
        "hl": "ru",
        "location": "Moscow, Russia",
    },
    "yandex": {
        "yandex_domain": "yandex.ru",
        "lr": 213,
    },
    "bing": {
        "cc": "RU",
        "mkt": "ru-RU",
    },
    "duckduckgo": {
        "kl": "ru-ru",
    },
    "google_short_videos": {
        "google_domain": "google.ru",
        "gl": "ru",
        "hl": "ru",
        "location": "Moscow, Russia",
    },
}


def resolve_serpapi_engine(settings: Optional[Dict[str, Any]]) -> str:
    engine = str((settings or {}).get("serpapi_default_engine") or "").strip()
    return engine or DEFAULT_ENGINE


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


def fetch_serpapi_account(api_key: str) -> Tuple[bool, Dict[str, Any], str]:
    key = str(api_key or "").strip()
    if not key:
        return False, {}, "empty_key"
    q = urlencode({"api_key": key})
    code, body, raw = http_get_json(f"{SERPAPI_ORIGIN}/account.json?{q}", timeout=20)
    if code != 200 or not isinstance(body, dict):
        msg = (raw or "")[:400] if raw else f"http_{code}"
        return False, {}, msg
    payload = {
        "account_id": body.get("account_id"),
        "account_email": body.get("account_email"),
        "account_status": body.get("account_status"),
        "plan_id": body.get("plan_id"),
        "plan_name": body.get("plan_name"),
        "plan_monthly_price": body.get("plan_monthly_price"),
        "plan_renewal_date": body.get("plan_renewal_date"),
        "searches_per_month": body.get("searches_per_month"),
        "plan_searches_left": body.get("plan_searches_left"),
        "total_searches_left": body.get("total_searches_left"),
        "this_month_usage": body.get("this_month_usage"),
        "extra_credits": body.get("extra_credits"),
        "this_hour_searches": body.get("this_hour_searches"),
        "account_rate_limit_per_hour": body.get("account_rate_limit_per_hour"),
    }
    return True, payload, "ok"


def verify_serpapi_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    del settings  # account.json does not need engine
    key = str(api_key or "").strip()
    if not key:
        return False, 400, "empty_key"
    q = urlencode({"api_key": key})
    code, body, raw = http_get_json(f"{SERPAPI_ORIGIN}/account.json?{q}", timeout=20)
    if code == 200 and isinstance(body, dict):
        return True, 200, "ok"
    msg = (raw or "")[:400] if raw else f"http_{code}"
    text = msg.lower()
    if "1010" in text or "cloudflare" in text:
        return False, code or 403, f"proxy_blocked: {msg[:200]}"
    if code in {401, 403}:
        return False, code, msg
    if code == 429:
        return False, 429, msg
    return False, code if code > 0 else 401, msg


def _truncate_text(value: str, max_len: int) -> str:
    if len(value) <= max_len:
        return value
    return value[: max_len - 3] + "..."


def build_serpapi_search_params(
    query: str,
    limit: int,
    *,
    engine: str,
    api_key: str,
    geo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    eng = str(engine or DEFAULT_ENGINE).strip().lower() or DEFAULT_ENGINE
    cap = max(1, min(int(limit or 10), 20))
    params: Dict[str, Any] = {"engine": eng, "api_key": str(api_key or "").strip()}
    geo_defaults = dict(SERPAPI_GEO_DEFAULTS.get(eng) or {})
    if geo:
        geo_defaults.update(geo)
    params.update(geo_defaults)

    if eng == "yandex":
        params["text"] = str(query or "").strip()
    else:
        params["q"] = str(query or "").strip()
        if eng == "google":
            params["num"] = cap
        elif eng == "bing":
            params["count"] = cap
        elif eng in {"duckduckgo", "google_maps", "google_trends", "youtube"}:
            params["num"] = cap
        elif eng == "google_short_videos":
            params["device"] = "desktop"
    return params


def serpapi_search_raw(
    api_key: str,
    query: str,
    limit: int = 10,
    *,
    engine: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
    geo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full SerpApi response wrapper for dedicated SEO/SERP tooling."""
    key = str(api_key or "").strip()
    qtext = str(query or "").strip()
    eng = str(engine or "").strip() or resolve_serpapi_engine(settings)
    if not key or not qtext:
        return {
            "ok": False,
            "engine": eng,
            "query": qtext,
            "http_code": 400,
            "organic_results": [],
            "items": [],
            "error": "empty_key_or_query",
            "search_metadata": None,
        }

    params = build_serpapi_search_params(qtext, limit, engine=eng, api_key=key, geo=geo)
    encoded = urlencode(params)
    code, body, raw = http_get_json(f"{SERPAPI_ORIGIN}/search.json?{encoded}", timeout=45)
    if code < 200 or code >= 300 or not isinstance(body, dict):
        err = ""
        if isinstance(body, dict):
            err = str(body.get("error") or "")
        if not err:
            err = (raw or "")[:400] if raw else f"http_{code}"
        return {
            "ok": False,
            "engine": eng,
            "query": qtext,
            "http_code": code,
            "organic_results": [],
            "items": [],
            "error": err,
            "search_metadata": body.get("search_metadata") if isinstance(body, dict) else None,
        }

    rows = body.get("organic_results")
    organic: List[Dict[str, Any]] = []
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict):
                organic.append(row)

    short_videos: List[Dict[str, Any]] = []
    sv_rows = body.get("short_video_results")
    if isinstance(sv_rows, list):
        for row in sv_rows:
            if isinstance(row, dict):
                short_videos.append(row)

    if eng == "google_short_videos":
        items = _short_video_rows_to_items(short_videos, limit)
        has_results = bool(items or short_videos)
    else:
        items = _organic_rows_to_items(organic, eng, limit)
        has_results = bool(items or organic)

    return {
        "ok": has_results,
        "engine": eng,
        "query": qtext,
        "http_code": code,
        "organic_results": organic[: max(1, min(int(limit or 10), 20))],
        "short_video_results": short_videos[: max(1, min(int(limit or 10), 20))],
        "items": items,
        "error": None if has_results else "empty_results",
        "search_metadata": body.get("search_metadata"),
        "search_information": body.get("search_information"),
        "serpapi_id": body.get("search_metadata", {}).get("id") if isinstance(body.get("search_metadata"), dict) else None,
    }


def _short_video_rows_to_items(rows: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        url = str(row.get("link") or "").strip()
        if not url:
            continue
        out.append(
            {
                "title": _truncate_text(str(row.get("title") or url), 200),
                "url": url,
                "summary": _truncate_text(
                    f"{row.get('source') or ''} · {row.get('channel') or ''} · {row.get('duration') or ''}".strip(" ·"),
                    400,
                ),
                "category": "external",
                "tags": ["external", "serpapi", "google_short_videos"],
                "sourceProvider": "serpapi",
                "position": row.get("position"),
                "source": row.get("source"),
                "channel": row.get("channel"),
                "duration": row.get("duration"),
            }
        )
        if len(out) >= limit:
            break
    return out


def _organic_rows_to_items(rows: List[Dict[str, Any]], engine: str, limit: int) -> List[Dict[str, Any]]:
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
                "summary": _truncate_text(str(row.get("snippet") or row.get("description") or ""), 400),
                "category": "external",
                "tags": ["external", "serpapi", engine],
                "sourceProvider": "serpapi",
                "position": row.get("position"),
            }
        )
        if len(out) >= limit:
            break
    return out


def serpapi_web_search(
    api_key: str,
    query: str,
    limit: int = 8,
    *,
    engine: Optional[str] = None,
    settings: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    raw = serpapi_search_raw(
        api_key,
        query,
        limit,
        engine=engine,
        settings=settings,
    )
    if not raw.get("ok"):
        return []
    return list(raw.get("items") or [])


def serpapi_engine_search(
    api_key: str,
    engine: str,
    params: Optional[Dict[str, Any]] = None,
    *,
    geo: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Full SerpApi call for arbitrary engine + params (google_maps_reviews, tripadvisor, …)."""
    key = str(api_key or "").strip()
    eng = str(engine or DEFAULT_ENGINE).strip().lower() or DEFAULT_ENGINE
    if not key:
        return {
            "ok": False,
            "engine": eng,
            "http_code": 400,
            "body": None,
            "error": "empty_key",
        }

    merged: Dict[str, Any] = {"engine": eng, "api_key": key}
    if isinstance(params, dict):
        for k, v in params.items():
            if k in {"engine", "api_key"}:
                continue
            if v is not None and v != "":
                merged[k] = v

    geo_defaults = dict(SERPAPI_GEO_DEFAULTS.get(eng) or {})
    if geo:
        geo_defaults.update(geo)
    for k, v in geo_defaults.items():
        if merged.get(k) is None and v is not None and v != "":
            merged[k] = v

    encoded = urlencode(merged)
    code, body, raw = http_get_json(f"{SERPAPI_ORIGIN}/search.json?{encoded}", timeout=45)
    if code < 200 or code >= 300 or not isinstance(body, dict):
        err = ""
        if isinstance(body, dict):
            err = str(body.get("error") or "")
        if not err:
            err = (raw or "")[:400] if raw else f"http_{code}"
        return {
            "ok": False,
            "engine": eng,
            "http_code": code,
            "body": body if isinstance(body, dict) else None,
            "error": err,
        }

    api_err = str(body.get("error") or "").strip()
    if api_err:
        return {
            "ok": False,
            "engine": eng,
            "http_code": code,
            "body": body,
            "error": api_err,
        }

    return {
        "ok": True,
        "engine": eng,
        "http_code": code,
        "body": body,
        "error": None,
    }
