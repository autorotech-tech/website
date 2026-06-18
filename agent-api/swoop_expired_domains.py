"""ExpiredDomains.net integration for Swoop — search, scoring, job history.

Member area: https://member.expireddomains.net (session auth).
Dev changelog: https://member.expireddomains.net/dev/
"""

from __future__ import annotations

import html as html_lib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin
from urllib.request import Request, urlopen

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("autoro-expired-domains")

MEMBER_BASE_DEFAULT = "https://member.expireddomains.net"
PUBLIC_BASE_DEFAULT = "https://www.expireddomains.net"

DOMAIN_LIST_CATALOG: List[Dict[str, str]] = [
    {"id": "expiredcom", "label": "Expired .com", "group": "deleted", "path": "/domains/expiredcom/"},
    {"id": "deletedcom", "label": "Deleted .com", "group": "deleted", "path": "/domains/deletedcom/"},
    {"id": "pendingdelete", "label": "Pending Delete", "group": "deleted", "path": "/domains/pendingdelete/"},
    {"id": "expirednet", "label": "Expired .net", "group": "deleted", "path": "/domains/expirednet/"},
    {"id": "expiredorg", "label": "Expired .org", "group": "deleted", "path": "/domains/expiredorg/"},
    {"id": "domainnamesearch", "label": "Global keyword search", "group": "search", "path": "/domain-name-search/"},
]

COLUMN_ALIASES: Dict[str, str] = {
    "domain": "domain",
    "bl": "backlinks",
    "dp": "domain_pop",
    "aby": "archive_birth_year",
    "wby": "wayback_year",
    "tf": "majestic_tf",
    "cf": "majestic_cf",
    "mip": "majestic_ref_ips",
    "creationdate": "whois_created",
    "enddate": "end_date",
    "price": "price",
    "dropped": "dropped",
    "statuscom": "status_com",
    "statusnet": "status_net",
    "statusorg": "status_org",
    "length": "length",
    "googleads": "google_ads_volume",
    "wiki": "wikipedia_links",
}

router = APIRouter(prefix="/api/v1/expired-domains", tags=["expired-domains"])

_pg_connect: Optional[Callable[[], Any]] = None
_load_agent_settings: Optional[Callable[[], Dict[str, Any]]] = None
_load_swoop_settings: Optional[Callable[[], Dict[str, Any]]] = None
_verify_agent_key: Optional[Callable[[Optional[str]], None]] = None


def configure_expired_domains(
    *,
    pg_connect: Callable[[], Any],
    load_agent_settings: Callable[[], Dict[str, Any]],
    load_swoop_settings: Callable[[], Dict[str, Any]],
    verify_agent_key: Callable[[Optional[str]], None],
) -> None:
    global _pg_connect, _load_agent_settings, _load_swoop_settings, _verify_agent_key
    _pg_connect = pg_connect
    _load_agent_settings = load_agent_settings
    _load_swoop_settings = load_swoop_settings
    _verify_agent_key = verify_agent_key


def _conn():
    if _pg_connect is None:
        raise HTTPException(status_code=503, detail="Expired domains module not configured")
    return _pg_connect()


def _require_key(x_api_key: Optional[str]) -> None:
    if _verify_agent_key is None:
        raise HTTPException(status_code=503, detail="Expired domains module not configured")
    _verify_agent_key(x_api_key)


def ensure_expired_domains_schema() -> None:
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS public.expired_domains_jobs (
                    id uuid PRIMARY KEY,
                    created_at timestamptz NOT NULL DEFAULT now(),
                    updated_at timestamptz NOT NULL DEFAULT now(),
                    status text NOT NULL DEFAULT 'pending',
                    params jsonb NOT NULL DEFAULT '{}'::jsonb,
                    result_count integer NOT NULL DEFAULT 0,
                    results jsonb NOT NULL DEFAULT '[]'::jsonb,
                    error_message text NOT NULL DEFAULT '',
                    duration_ms integer NOT NULL DEFAULT 0
                )
                """
            )
            cur.execute(
                """
                ALTER TABLE public.service_settings
                ADD COLUMN IF NOT EXISTS expireddomains_username text NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE public.service_settings
                ADD COLUMN IF NOT EXISTS expireddomains_password text NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE public.service_settings
                ADD COLUMN IF NOT EXISTS expireddomains_session_cookie text NOT NULL DEFAULT ''
                """
            )
            cur.execute(
                """
                ALTER TABLE public.service_settings
                ADD COLUMN IF NOT EXISTS expireddomains_api_base text NOT NULL DEFAULT ''
                """
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        logger.warning("ensure_expired_domains_schema failed: %s", exc)
    finally:
        conn.close()


def _load_ed_credentials() -> Dict[str, str]:
    cfg: Dict[str, str] = {
        "username": (os_getenv("EXPIREDDOMAINS_USERNAME") or "").strip(),
        "password": (os_getenv("EXPIREDDOMAINS_PASSWORD") or "").strip(),
        "session_cookie": (os_getenv("EXPIREDDOMAINS_SESSION_COOKIE") or "").strip(),
        "api_base": (os_getenv("EXPIREDDOMAINS_API_BASE") or "").strip().rstrip("/"),
    }
    if _load_swoop_settings is None:
        return cfg
    try:
        row = _load_swoop_settings()
        if row.get("expireddomains_username"):
            cfg["username"] = str(row["expireddomains_username"]).strip()
        if row.get("expireddomains_password"):
            cfg["password"] = str(row["expireddomains_password"]).strip()
        if row.get("expireddomains_session_cookie"):
            cfg["session_cookie"] = str(row["expireddomains_session_cookie"]).strip()
        if row.get("expireddomains_api_base"):
            cfg["api_base"] = str(row["expireddomains_api_base"]).strip().rstrip("/")
    except Exception as exc:
        logger.warning("load expireddomains credentials: %s", exc)
    if not cfg["api_base"]:
        cfg["api_base"] = MEMBER_BASE_DEFAULT
    return cfg


def os_getenv(name: str) -> str:
    import os

    return os.environ.get(name, "") or ""


@dataclass
class ExpiredDomainsSession:
    base_url: str
    cookie_header: str = ""
    logged_in: bool = False

    def request(self, path: str, params: Optional[Dict[str, Any]] = None, timeout: int = 45) -> Tuple[int, str]:
        q = f"?{urlencode(params, doseq=True)}" if params else ""
        url = urljoin(self.base_url.rstrip("/") + "/", path.lstrip("/")) + q
        headers = {
            "User-Agent": "Autoro-Swoop-ExpiredDomains/1.0",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        }
        if self.cookie_header:
            headers["Cookie"] = self.cookie_header
        req = Request(url, headers=headers, method="GET")
        try:
            with urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode("utf-8", errors="replace")
                return int(resp.getcode() or 200), body
        except HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            return int(exc.code), raw
        except URLError as exc:
            return -1, str(exc.reason)


class _DomainTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_thead = False
        self.in_tbody = False
        self.in_tr = False
        self.in_th = False
        self.in_td = False
        self.headers: List[str] = []
        self._row_cells: List[str] = []
        self._cell_buf: List[str] = []
        self.rows: List[Dict[str, str]] = []
        self._current_row: Dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        attr_map = {k: (v or "") for k, v in attrs}
        cls = attr_map.get("class", "")
        if tag == "thead":
            self.in_thead = True
        elif tag == "tbody":
            self.in_tbody = True
        elif tag == "tr" and (self.in_thead or self.in_tbody):
            self.in_tr = True
            self._row_cells = []
            self._current_row = {}
        elif tag == "th" and self.in_tr and self.in_thead:
            self.in_th = True
            self._cell_buf = []
        elif tag == "td" and self.in_tr and self.in_tbody:
            self.in_td = True
            self._cell_buf = []
            for part in cls.split():
                if part.startswith("field_"):
                    self._current_row["_field_class"] = part.replace("field_", "")
        elif tag == "a" and self.in_td:
            href = attr_map.get("href", "")
            field_cls = self._current_row.get("_field_class", "")
            if "domain" in field_cls or "/domain/" in href or "goto" in href:
                self._current_row["_href"] = href
                m = re.search(r"([a-z0-9][a-z0-9.-]+\.[a-z]{2,})", href, flags=re.I)
                if m:
                    self._current_row["domain"] = m.group(1).lower()

    def handle_endtag(self, tag: str) -> None:
        if tag == "thead":
            self.in_thead = False
        elif tag == "tbody":
            self.in_tbody = False
        elif tag == "th" and self.in_th:
            self.in_th = False
            text = _clean_cell("".join(self._cell_buf))
            key = _normalize_header(text, len(self.headers))
            self.headers.append(key)
        elif tag == "td" and self.in_td:
            self.in_td = False
            text = _clean_cell("".join(self._cell_buf))
            field_key = self._current_row.pop("_field_class", f"col_{len(self._row_cells)}")
            norm = COLUMN_ALIASES.get(field_key, field_key)
            self._current_row[norm] = text
            self._row_cells.append(text)
        elif tag == "tr" and self.in_tr:
            self.in_tr = False
            if self.in_tbody and self._current_row.get("domain"):
                row = {k: v for k, v in self._current_row.items() if not k.startswith("_")}
                if row.get("domain"):
                    self.rows.append(row)
            self._current_row = {}

    def handle_data(self, data: str) -> None:
        if self.in_th or self.in_td:
            self._cell_buf.append(data)
            if self.in_td and self._current_row.get("_field_class") == "domain":
                chunk = _clean_cell(data)
                if chunk and "." in chunk and " " not in chunk:
                    self._current_row["domain"] = chunk.lower()


def _clean_cell(text: str) -> str:
    t = html_lib.unescape(text or "")
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _normalize_header(text: str, idx: int) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    if not key:
        key = f"col_{idx}"
    return COLUMN_ALIASES.get(key, key)


def _extract_domain_from_row(row: Dict[str, str]) -> str:
    domain = (row.get("domain") or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain)
    domain = domain.split("/")[0].strip()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def parse_domain_listing_html(html_text: str) -> List[Dict[str, Any]]:
    parser = _DomainTableParser()
    parser.feed(html_text)
    out: List[Dict[str, Any]] = []
    for raw in parser.rows:
        domain = _extract_domain_from_row(raw)
        if not domain or "." not in domain:
            continue
        metrics = _normalize_metrics(raw)
        out.append({"domain": domain, "metrics": metrics, "raw": raw})
    if out:
        return out
    return _parse_domain_links_fallback(html_text)


def _parse_domain_links_fallback(html_text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'<a[^>]+href="[^"]*/(?:domain|goto)[^"]*/([a-z0-9][a-z0-9.-]+\.[a-z]{2,})"[^>]*>([^<]+)</a>',
        html_text,
        flags=re.I,
    ):
        domain = m.group(1).strip().lower()
        if domain in seen:
            continue
        seen.add(domain)
        out.append({"domain": domain, "metrics": {}, "raw": {"domain": m.group(2).strip()}})
    return out


def _normalize_metrics(raw: Dict[str, str]) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for key, val in raw.items():
        if key == "domain":
            continue
        num = _parse_number(val)
        if num is not None:
            out[key] = num
        elif val:
            out[key] = val
    return out


def _parse_number(val: str) -> Optional[float]:
    s = (val or "").strip().replace(",", "")
    if not s or s in {"-", "—", "n/a", "N/A"}:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return None
    try:
        n = float(m.group(0))
        if n.is_integer():
            return int(n)
        return n
    except ValueError:
        return None


def login_member_area(username: str, password: str, base_url: str) -> ExpiredDomainsSession:
    sess = ExpiredDomainsSession(base_url=base_url or MEMBER_BASE_DEFAULT)
    if not username or not password:
        return sess
    login_url = urljoin(sess.base_url.rstrip("/") + "/", "login/")
    body = urlencode(
        {
            "login": username,
            "password": password,
            "rememberme": "1",
        }
    ).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Autoro-Swoop-ExpiredDomains/1.0",
        "Accept": "text/html,application/json",
    }
    req = Request(login_url, data=body, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=30) as resp:
            cookie_parts: List[str] = []
            for hdr in resp.headers.get_all("Set-Cookie") or []:
                piece = hdr.split(";", 1)[0].strip()
                if piece:
                    cookie_parts.append(piece)
            sess.cookie_header = "; ".join(cookie_parts)
            page = resp.read().decode("utf-8", errors="replace")
            sess.logged_in = "logout" in page.lower() or "member" in str(resp.geturl()).lower()
    except HTTPError as exc:
        logger.warning("expireddomains login HTTP %s", exc.code)
    except URLError as exc:
        logger.warning("expireddomains login failed: %s", exc.reason)
    return sess


def build_session(creds: Dict[str, str]) -> ExpiredDomainsSession:
    if creds.get("session_cookie"):
        return ExpiredDomainsSession(
            base_url=creds.get("api_base") or MEMBER_BASE_DEFAULT,
            cookie_header=creds["session_cookie"],
            logged_in=True,
        )
    sess = login_member_area(
        creds.get("username") or "",
        creds.get("password") or "",
        creds.get("api_base") or MEMBER_BASE_DEFAULT,
    )
    return sess


def build_search_params(req: "ExpiredDomainsSearchRequest") -> Dict[str, Any]:
    params: Dict[str, Any] = {
        "start": max(0, int(req.offset or 0)),
        "flimit": max(1, min(int(req.limit or 50), 200)),
    }
    if req.keywords:
        joined = " ".join(k.strip() for k in req.keywords if k.strip())
        if joined:
            params["fdomain"] = joined
    if req.min_backlinks is not None:
        params["fbl"] = int(req.min_backlinks)
    if req.min_majestic_tf is not None:
        params["fmseotf"] = int(req.min_majestic_tf)
    if req.min_majestic_cf is not None:
        params["fmseocf"] = int(req.min_majestic_cf)
    if req.min_domain_pop is not None:
        params["fdp"] = int(req.min_domain_pop)
    if req.max_length is not None:
        params["flength"] = int(req.max_length)
    if req.only_com:
        params["ftld"] = "com"
    if req.no_numbers:
        params["fnonumbers"] = "1"
    if req.last_hours is not None and req.last_hours > 0:
        if req.last_hours <= 24:
            params["flast24"] = "1"
        elif req.last_hours <= 48:
            params["flast48"] = "1"
        else:
            params["flast7d"] = "1"
    return params


def resolve_list_path(list_id: str) -> str:
    for item in DOMAIN_LIST_CATALOG:
        if item["id"] == list_id:
            return item["path"]
    if list_id.startswith("/"):
        return list_id
    return f"/domains/{list_id}/"


def fetch_domains(sess: ExpiredDomainsSession, list_id: str, params: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], str]:
    path = resolve_list_path(list_id)
    code, body = sess.request(path, params)
    if code == 401 or code == 403 or ("login" in body.lower()[:2000] and "password" in body.lower()[:2000]):
        raise HTTPException(status_code=401, detail="ExpiredDomains: требуется вход (логин/пароль или session cookie в Swoop Settings)")
    if code < 0:
        raise HTTPException(status_code=502, detail=f"ExpiredDomains upstream error: {body[:300]}")
    if code >= 400:
        raise HTTPException(status_code=502, detail=f"ExpiredDomains HTTP {code}")
    rows = parse_domain_listing_html(body)
    if not rows and list_id == "domainnamesearch" and params.get("fdomain"):
        params_q = {"q": params["fdomain"], "start": params.get("start", 0)}
        code2, body2 = sess.request("/domain-name-search/", params_q)
        if code2 == 200:
            rows = parse_domain_listing_html(body2)
    return rows, body[:500]


def keyword_relevance(domain: str, keywords: List[str]) -> float:
    if not keywords:
        return 50.0
    d = domain.lower().replace("-", "").replace(".", "")
    hits = 0
    for kw in keywords:
        k = kw.strip().lower().replace(" ", "")
        if not k:
            continue
        if k in d or k in domain.lower():
            hits += 1
    return min(100.0, (hits / max(len(keywords), 1)) * 100.0)


def theme_relevance(domain: str, business_theme: str, keywords: List[str]) -> float:
    theme = (business_theme or "").strip().lower()
    if not theme:
        return keyword_relevance(domain, keywords)
    tokens = [t for t in re.split(r"[^a-z0-9а-яё]+", theme) if len(t) >= 3]
    if not tokens:
        return keyword_relevance(domain, keywords)
    d = domain.lower()
    hits = sum(1 for t in tokens if t in d)
    base = keyword_relevance(domain, keywords)
    theme_part = (hits / len(tokens)) * 100.0
    return min(100.0, base * 0.55 + theme_part * 0.45)


def estimate_spam_score(metrics: Dict[str, Any]) -> float:
    tf = float(metrics.get("majestic_tf") or 0)
    cf = float(metrics.get("majestic_cf") or 0)
    bl = float(metrics.get("backlinks") or 0)
    if tf <= 0 and cf <= 0 and bl <= 0:
        return 35.0
    if cf <= 0:
        return 20.0
    ratio_gap = max(0.0, cf - tf) / max(cf, 1.0)
    spam = ratio_gap * 70.0
    if tf < 5 and cf >= 15:
        spam += 20.0
    if bl > 5000 and tf < 10:
        spam += 10.0
    return min(100.0, max(0.0, spam))


def authority_score(metrics: Dict[str, Any]) -> float:
    tf = float(metrics.get("majestic_tf") or 0)
    cf = float(metrics.get("majestic_cf") or 0)
    bl = float(metrics.get("backlinks") or 0)
    dp = float(metrics.get("domain_pop") or 0)
    wiki = float(metrics.get("wikipedia_links") or 0)
    parts = [
        min(100.0, tf * 4.0),
        min(100.0, cf * 2.5),
        min(100.0, (bl ** 0.35) * 8.0),
        min(100.0, (dp ** 0.4) * 6.0),
        min(100.0, wiki * 25.0),
    ]
    weights = [0.35, 0.2, 0.25, 0.1, 0.1]
    return sum(p * w for p, w in zip(parts, weights))


def seo_prospect_score(metrics: Dict[str, Any], theme_score: float, spam_score: float) -> float:
    auth = authority_score(metrics)
    ads = float(metrics.get("google_ads_volume") or 0)
    ads_part = min(100.0, (ads ** 0.3) * 5.0) if ads > 0 else 40.0
    clean = max(0.0, 100.0 - spam_score)
    return min(100.0, auth * 0.45 + theme_score * 0.25 + clean * 0.2 + ads_part * 0.1)


def score_domain(
    domain: str,
    metrics: Dict[str, Any],
    *,
    keywords: List[str],
    business_theme: str,
    max_spam_score: Optional[float] = None,
) -> Dict[str, Any]:
    kw = keyword_relevance(domain, keywords)
    theme = theme_relevance(domain, business_theme, keywords)
    spam = estimate_spam_score(metrics)
    auth = authority_score(metrics)
    seo = seo_prospect_score(metrics, theme, spam)
    business = min(
        100.0,
        kw * 0.22 + theme * 0.23 + auth * 0.3 + max(0.0, 100.0 - spam) * 0.15 + seo * 0.1,
    )
    passes_filters = True
    if max_spam_score is not None and spam > max_spam_score:
        passes_filters = False
    return {
        "keyword_score": round(kw, 1),
        "theme_score": round(theme, 1),
        "spam_score": round(spam, 1),
        "authority_score": round(auth, 1),
        "seo_prospect_score": round(seo, 1),
        "business_score": round(business, 1),
        "passes_filters": passes_filters,
    }


class ExpiredDomainsSearchRequest(BaseModel):
    keywords: List[str] = Field(default_factory=list, description="Ключевые слова в домене")
    business_theme: str = Field("", description="Тематика бизнеса для оценки релевантности")
    list_id: str = Field("expiredcom", description="ID списка expireddomains")
    limit: int = Field(50, ge=1, le=200)
    offset: int = Field(0, ge=0)
    min_backlinks: Optional[int] = Field(None, ge=0)
    min_majestic_tf: Optional[int] = Field(None, ge=0)
    min_majestic_cf: Optional[int] = Field(None, ge=0)
    min_domain_pop: Optional[int] = Field(None, ge=0)
    max_length: Optional[int] = Field(None, ge=1, le=63)
    max_spam_score: Optional[float] = Field(None, ge=0, le=100)
    min_business_score: Optional[float] = Field(None, ge=0, le=100)
    only_com: bool = False
    no_numbers: bool = False
    last_hours: Optional[int] = Field(None, ge=1, le=168)
    sort_by: str = Field("business_score", description="business_score|authority_score|seo_prospect_score|spam_score")


class VerifyCredentialsRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    session_cookie: Optional[str] = None
    api_base: Optional[str] = None


def _sort_results(rows: List[Dict[str, Any]], sort_by: str) -> List[Dict[str, Any]]:
    key = sort_by if sort_by in {"business_score", "authority_score", "seo_prospect_score", "spam_score", "keyword_score"} else "business_score"
    reverse = key != "spam_score"

    def _val(item: Dict[str, Any]) -> float:
        scores = item.get("scores") or {}
        return float(scores.get(key) or 0)

    return sorted(rows, key=_val, reverse=reverse)


def _persist_job(job_id: str, status: str, params: Dict[str, Any], results: List[Dict[str, Any]], error: str, duration_ms: int) -> None:
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO public.expired_domains_jobs
                    (id, status, params, result_count, results, error_message, duration_ms, updated_at)
                VALUES (%s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    params = EXCLUDED.params,
                    result_count = EXCLUDED.result_count,
                    results = EXCLUDED.results,
                    error_message = EXCLUDED.error_message,
                    duration_ms = EXCLUDED.duration_ms,
                    updated_at = now()
                """,
                (
                    job_id,
                    status,
                    json.dumps(params, ensure_ascii=False),
                    len(results),
                    json.dumps(results, ensure_ascii=False),
                    error,
                    duration_ms,
                ),
            )
        conn.commit()
    finally:
        conn.close()


@router.get("/lists")
async def list_catalog(x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    return {"lists": DOMAIN_LIST_CATALOG}


@router.get("/jobs")
async def list_jobs(x_api_key: Optional[str] = Header(None, alias="X-API-Key"), limit: int = 20):
    _require_key(x_api_key)
    ensure_expired_domains_schema()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, updated_at, status, result_count, params, error_message, duration_ms
                FROM public.expired_domains_jobs
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (max(1, min(limit, 100)),),
            )
            cols = [d[0] for d in cur.description]
            rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        return {"jobs": rows}
    finally:
        conn.close()


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    ensure_expired_domains_schema()
    conn = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, created_at, updated_at, status, result_count, params, results, error_message, duration_ms
                FROM public.expired_domains_jobs
                WHERE id = %s
                LIMIT 1
                """,
                (job_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Job not found")
            cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))
    finally:
        conn.close()


@router.post("/verify-credentials")
async def verify_credentials(body: VerifyCredentialsRequest, x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    creds = _load_ed_credentials()
    if body.username:
        creds["username"] = body.username.strip()
    if body.password:
        creds["password"] = body.password
    if body.session_cookie:
        creds["session_cookie"] = body.session_cookie.strip()
    if body.api_base:
        creds["api_base"] = body.api_base.strip().rstrip("/")
    sess = build_session(creds)
    if creds.get("session_cookie"):
        code, html_page = sess.request("/domains/expiredcom/", {"flimit": 5})
        ok = code == 200 and "login" not in html_page.lower()[:1500]
        return {"ok": ok, "method": "session_cookie", "http_status": code}
    if not creds.get("username") or not creds.get("password"):
        raise HTTPException(status_code=400, detail="Укажите username/password или session cookie")
    if not sess.cookie_header and not sess.logged_in:
        sess = login_member_area(creds["username"], creds["password"], creds["api_base"])
    code, html_page = sess.request("/domains/expiredcom/", {"flimit": 5})
    ok = code == 200 and "login" not in html_page.lower()[:1500]
    return {"ok": ok, "method": "login", "http_status": code, "has_cookie": bool(sess.cookie_header)}


@router.post("/search")
async def search_domains(body: ExpiredDomainsSearchRequest, x_api_key: Optional[str] = Header(None, alias="X-API-Key")):
    _require_key(x_api_key)
    ensure_expired_domains_schema()
    job_id = str(uuid.uuid4())
    started = time.time()
    params_snapshot = body.model_dump()
    _persist_job(job_id, "running", params_snapshot, [], "", 0)

    try:
        creds = _load_ed_credentials()
        if not creds.get("session_cookie") and (not creds.get("username") or not creds.get("password")):
            raise HTTPException(
                status_code=400,
                detail="Настройте ExpiredDomains в Swoop → Settings (username/password или session cookie)",
            )
        sess = build_session(creds)
        query_params = build_search_params(body)
        raw_rows, _preview = fetch_domains(sess, body.list_id, query_params)

        keywords = [k.strip() for k in body.keywords if k.strip()]
        scored: List[Dict[str, Any]] = []
        for row in raw_rows:
            domain = row["domain"]
            metrics = row.get("metrics") or {}
            scores = score_domain(
                domain,
                metrics,
                keywords=keywords,
                business_theme=body.business_theme,
                max_spam_score=body.max_spam_score,
            )
            if body.min_business_score is not None and scores["business_score"] < body.min_business_score:
                scores["passes_filters"] = False
            if not scores["passes_filters"]:
                continue
            scored.append(
                {
                    "domain": domain,
                    "metrics": metrics,
                    "scores": scores,
                    "list_id": body.list_id,
                }
            )

        scored = _sort_results(scored, body.sort_by)
        duration_ms = int((time.time() - started) * 1000)
        _persist_job(job_id, "completed", params_snapshot, scored, "", duration_ms)
        return {
            "job_id": job_id,
            "status": "completed",
            "count": len(scored),
            "duration_ms": duration_ms,
            "results": scored,
            "query": query_params,
        }
    except HTTPException:
        duration_ms = int((time.time() - started) * 1000)
        _persist_job(job_id, "failed", params_snapshot, [], "HTTP error", duration_ms)
        raise
    except Exception as exc:
        duration_ms = int((time.time() - started) * 1000)
        _persist_job(job_id, "failed", params_snapshot, [], str(exc), duration_ms)
        logger.exception("expired domains search failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
