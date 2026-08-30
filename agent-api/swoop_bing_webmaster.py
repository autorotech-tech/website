"""Bing Webmaster Tools JSON API for Swoop (agent-api).

Docs: https://learn.microsoft.com/en-us/bingwebmaster/getting-access
JSON (supported): GET/POST https://ssl.bing.com/webmaster/api.svc/json/METHOD?apikey=

SOAP/POX retire 2026-08-31; JSON + API key stay. OAuth Bearer is optional later.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BING_JSON_BASE = "https://ssl.bing.com/webmaster/api.svc/json"
DEFAULT_SITE_URL = "https://autoro.tech"


def resolve_bing_site_url(settings: Optional[Dict[str, Any]] = None, override: str = "") -> str:
    raw = str(override or "").strip() or str((settings or {}).get("bing_webmaster_site_url") or "").strip()
    site = (raw or DEFAULT_SITE_URL).rstrip("/")
    return site or DEFAULT_SITE_URL


def _error_message(body: Optional[Any], raw: str, code: int) -> str:
    if isinstance(body, dict):
        err = body.get("ErrorCode") or body.get("error") or body.get("Message") or body.get("message")
        if err:
            return str(err)[:400]
        msg = body.get("MessageDetail") or body.get("ExceptionMessage")
        if msg:
            return str(msg)[:400]
    return (raw or f"http_{code}")[:400]


def _http_json(
    url: str,
    *,
    method: str = "GET",
    payload: Optional[Dict[str, Any]] = None,
    timeout: int = 25,
) -> Tuple[int, Optional[Any], str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=utf-8",
    }
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            code = int(resp.getcode() or 200)
            try:
                return code, json.loads(raw) if raw else {}, raw
            except json.JSONDecodeError:
                return code, None, raw
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw else None
        except json.JSONDecodeError:
            parsed = None
        return int(exc.code), parsed, raw
    except Exception as exc:
        return -1, None, str(exc)


def bing_webmaster_request(
    api_key: str,
    method_name: str,
    *,
    query: Optional[Dict[str, str]] = None,
    body: Optional[Dict[str, Any]] = None,
    http_method: str = "",
    timeout: int = 25,
) -> Dict[str, Any]:
    key = str(api_key or "").strip()
    if not key:
        return {"ok": False, "http_code": 400, "error": "empty_key", "data": None}
    params = dict(query or {})
    params["apikey"] = key
    qs = urlencode(params)
    url = f"{BING_JSON_BASE}/{method_name}?{qs}"
    verb = (http_method or ("POST" if body is not None else "GET")).upper()
    code, parsed, raw = _http_json(url, method=verb, payload=body, timeout=timeout)
    if code != 200:
        return {
            "ok": False,
            "http_code": code if code > 0 else 502,
            "error": _error_message(parsed, raw, code),
            "data": parsed,
        }
    return {"ok": True, "http_code": 200, "error": "", "data": parsed}


def _unwrap_d(data: Any) -> Any:
    if isinstance(data, dict) and "d" in data:
        return data.get("d")
    return data


def verify_bing_webmaster_key(api_key: str, settings: Optional[Dict[str, Any]] = None) -> Tuple[bool, int, str]:
    del settings
    key = str(api_key or "").strip()
    if not key:
        return False, 400, "empty_key"
    result = bing_webmaster_request(key, "GetUserSites", timeout=20)
    if result.get("ok"):
        return True, 200, "ok"
    return False, int(result.get("http_code") or 502), str(result.get("error") or "bing_webmaster_failed")


def get_user_sites(api_key: str) -> Dict[str, Any]:
    result = bing_webmaster_request(api_key, "GetUserSites")
    if not result.get("ok"):
        return result
    payload = _unwrap_d(result.get("data"))
    sites: List[Dict[str, Any]] = []
    rows = payload if isinstance(payload, list) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        sites.append(
            {
                "url": str(row.get("Url") or "").strip(),
                "is_verified": bool(row.get("IsVerified")),
                "authentication_code": str(row.get("AuthenticationCode") or "").strip(),
            }
        )
    return {"ok": True, "http_code": 200, "error": "", "sites": sites, "count": len(sites)}


def get_query_stats(api_key: str, site_url: str) -> Dict[str, Any]:
    result = bing_webmaster_request(
        api_key,
        "GetQueryStats",
        query={"siteUrl": site_url},
    )
    if not result.get("ok"):
        return result
    payload = _unwrap_d(result.get("data"))
    rows = payload if isinstance(payload, list) else []
    return {"ok": True, "http_code": 200, "error": "", "site_url": site_url, "stats": rows, "count": len(rows)}


def get_url_submission_quota(api_key: str, site_url: str) -> Dict[str, Any]:
    result = bing_webmaster_request(
        api_key,
        "GetUrlSubmissionQuota",
        query={"siteUrl": site_url},
    )
    if not result.get("ok"):
        return result
    payload = _unwrap_d(result.get("data"))
    return {"ok": True, "http_code": 200, "error": "", "site_url": site_url, "quota": payload}


def submit_url(api_key: str, site_url: str, url: str) -> Dict[str, Any]:
    target = str(url or "").strip()
    site = str(site_url or "").strip().rstrip("/")
    if not target:
        return {"ok": False, "http_code": 400, "error": "empty_url"}
    if not site:
        return {"ok": False, "http_code": 400, "error": "empty_site_url"}
    result = bing_webmaster_request(
        api_key,
        "SubmitUrl",
        body={"siteUrl": site, "url": target},
        http_method="POST",
    )
    if not result.get("ok"):
        return result
    return {
        "ok": True,
        "http_code": 200,
        "error": "",
        "site_url": site,
        "url": target,
        "data": _unwrap_d(result.get("data")),
    }
