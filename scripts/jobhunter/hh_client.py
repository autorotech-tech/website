"""Jobhunter HH client helpers: search, enrich, offer, apply."""

from __future__ import annotations

import json
import os
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html import unescape
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

HOST_AREA = {"uz": 97, "kz": 40, "ru": 113}
HOST_SITE = {"uz": "https://hh.uz", "kz": "https://hh.kz", "ru": "https://hh.ru"}

DEFAULT_EXCLUDE = [
    "агентство",
    "кадровое",
    "рекрутинговое агентство",
    "ai recruiter",
    "только бот",
    "screening bot",
    "откликайтесь через бота",
]

EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
HR_HINTS = ("hr@", "job@", "jobs@", "career@", "careers@", "recruit@", "vacanc", "work@")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


@dataclass
class Filters:
    host: str = "uz"
    search_url: str = ""
    area_id: Optional[int] = None
    text: str = ""
    employment_form: str = "PROJECT"
    work_format: str = "REMOTE"
    exclude_keywords: List[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDE))
    agency_employer_types: List[str] = field(default_factory=lambda: ["agency"])
    min_score: int = 40
    daily_cap: int = 5
    auto_apply: bool = False
    auto_email: bool = False
    pause_on_block: bool = True
    apify_fallback: bool = True
    apify_actor_id: str = "easyapi/hh-ru-job-scraper"
    max_pages: int = 5
    per_page: int = 50

    @classmethod
    def from_mapping(cls, row: Dict[str, Any]) -> "Filters":
        def split_kw(v: Any) -> List[str]:
            if v is None or v == "":
                return list(DEFAULT_EXCLUDE)
            if isinstance(v, list):
                return [str(x).strip().lower() for x in v if str(x).strip()]
            return [p.strip().lower() for p in str(v).replace("|", ";").split(";") if p.strip()]

        host = str(row.get("host") or "uz").lower()
        area = row.get("area_id")
        area_id = int(area) if str(area).strip().isdigit() else HOST_AREA.get(host)
        return cls(
            host=host,
            search_url=str(row.get("search_url") or ""),
            area_id=area_id,
            text=str(row.get("text") or ""),
            employment_form=str(row.get("employment_form") or "PROJECT"),
            work_format=str(row.get("work_format") or "REMOTE"),
            exclude_keywords=split_kw(row.get("exclude_keywords")),
            agency_employer_types=split_kw(row.get("agency_employer_types") or "agency"),
            min_score=int(row.get("min_score") or 40),
            daily_cap=int(row.get("daily_cap") or 5),
            auto_apply=str(row.get("auto_apply", "FALSE")).upper() in {"1", "TRUE", "YES", "Y"},
            auto_email=str(row.get("auto_email", "FALSE")).upper() in {"1", "TRUE", "YES", "Y"},
            pause_on_block=str(row.get("pause_on_block", "TRUE")).upper() not in {"0", "FALSE", "NO", "N"},
            apify_fallback=str(row.get("apify_fallback", "TRUE")).upper() not in {"0", "FALSE", "NO", "N"},
            apify_actor_id=str(row.get("apify_actor_id") or "easyapi/hh-ru-job-scraper"),
            max_pages=int(row.get("max_pages") or 5),
            per_page=min(int(row.get("per_page") or 50), 100),
        )


@dataclass
class Profile:
    full_name: str = "Vladislav"
    roles: str = "Forward Deployed Engineer; AI Solutions Architect; Product Marketing; Automation"
    stack: str = "n8n, Playwright, OpenRouter, SEO/GEO"
    geo: str = "Remote / Relocate"
    languages: str = "ru, en"
    resume_url: str = "https://autoro.tech/resume/"
    resume_pdf_path: str = ""
    hh_resume_id_uz: str = ""
    hh_resume_id_kz: str = ""
    hh_resume_id_ru: str = ""
    offer_tone: str = "прямой, без AI-slop, фокус на результат"

    @classmethod
    def from_mapping(cls, row: Dict[str, Any]) -> "Profile":
        defaults = cls()
        return cls(
            **{
                k: str(row[k]) if k in row and row[k] is not None and str(row[k]) != "" else getattr(defaults, k)
                for k in cls.__dataclass_fields__
            }
        )

    def resume_id_for(self, host: str) -> str:
        return {
            "uz": self.hh_resume_id_uz,
            "kz": self.hh_resume_id_kz,
            "ru": self.hh_resume_id_ru,
        }.get(host, "") or self.hh_resume_id_uz


class HhApiError(RuntimeError):
    def __init__(self, message: str, status: int = 0, body: str = "", error_code: str = "api_error"):
        super().__init__(message)
        self.status = status
        self.body = body
        self.error_code = error_code


class HhClient:
    def __init__(
        self,
        user_agent: Optional[str] = None,
        app_token: Optional[str] = None,
        user_token: Optional[str] = None,
        base_url: str = "https://api.hh.ru",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.user_agent = user_agent or env("HH_USER_AGENT", "AutoroJobhunter/0.1 (contact@autoro.tech)")
        self.app_token = app_token if app_token is not None else env("HH_APP_TOKEN")
        self.user_token = user_token if user_token is not None else env("HH_USER_TOKEN")

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[Dict[str, Any]] = None,
        data: Optional[bytes] = None,
        form: Optional[Dict[str, str]] = None,
        use_user: bool = False,
        timeout: int = 60,
    ) -> Any:
        url = f"{self.base_url}{path}"
        if query:
            clean = {k: v for k, v in query.items() if v is not None and v != ""}
            url += "?" + urllib.parse.urlencode(clean, doseq=True)
        headers = {
            "User-Agent": self.user_agent,
            "HH-User-Agent": self.user_agent,
            "Accept": "application/json",
        }
        token = self.user_token if use_user else self.app_token
        if token:
            headers["Authorization"] = f"Bearer {token}"
        body = data
        if form is not None:
            body = urllib.parse.urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                if not raw:
                    return {}
                return json.loads(raw)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", errors="replace")
            code = self._classify_http(e.code, raw)
            raise HhApiError(f"HH {method} {path} -> {e.code}", status=e.code, body=raw, error_code=code) from e
        except urllib.error.URLError as e:
            raise HhApiError(f"HH network error: {e}", error_code="api_error") from e

    @staticmethod
    def _classify_http(status: int, body: str) -> str:
        low = body.lower()
        if status == 429:
            return "rate_limit"
        if "captcha" in low:
            return "captcha"
        if status == 403 and any(x in low for x in ("block", "forbidden", "подозрит", "огранич")):
            return "blocked" if any(x in low for x in ("block", "подозрит", "огранич")) else "api_forbidden"
        if status == 403:
            return "api_forbidden"
        if "already" in low or "уже откликались" in low:
            return "already_applied"
        return "api_error"

    def search_vacancies(self, filters: Filters) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """Return normalized vacancy rows. Second value is error_code if soft-failed before items."""
        items: List[Dict[str, Any]] = []
        try:
            for page in range(filters.max_pages):
                payload = self._request(
                    "GET",
                    "/vacancies",
                    query={
                        "text": filters.text or None,
                        "area": filters.area_id or HOST_AREA.get(filters.host),
                        "employment_form": filters.employment_form or None,
                        "work_format": filters.work_format or None,
                        "page": page,
                        "per_page": filters.per_page,
                    },
                )
                batch = payload.get("items") or []
                for raw in batch:
                    items.append(normalize_vacancy(raw, filters.host))
                pages = int(payload.get("pages") or 0)
                if page + 1 >= pages or not batch:
                    break
                time.sleep(random.uniform(0.4, 1.0))
            return items, None
        except HhApiError as e:
            return items, e.error_code

    def vacancy(self, vacancy_id: str, use_user: bool = False) -> Dict[str, Any]:
        return self._request("GET", f"/vacancies/{vacancy_id}", use_user=use_user)

    def preferred_contact(self, vacancy_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/vacancies/{vacancy_id}/preferred_contact", use_user=True)

    def apply(self, vacancy_id: str, resume_id: str, message: str, dry_run: bool = True) -> Dict[str, Any]:
        if dry_run:
            return {
                "dry_run": True,
                "vacancy_id": vacancy_id,
                "resume_id": resume_id,
                "message_len": len(message or ""),
                "status": "awaiting_approve",
            }
        if not self.user_token:
            raise HhApiError("HH_USER_TOKEN required for apply", error_code="api_forbidden")
        if not resume_id:
            raise HhApiError("resume_id required", error_code="api_error")
        # HH accepts form body for negotiations in many clients
        return self._request(
            "POST",
            "/negotiations",
            form={
                "vacancy_id": str(vacancy_id),
                "resume_id": str(resume_id),
                "message": message or "",
            },
            use_user=True,
        )


def normalize_vacancy(raw: Dict[str, Any], host: str) -> Dict[str, Any]:
    employer = raw.get("employer") or {}
    salary = raw.get("salary") or raw.get("salary_range") or {}
    salary_text = ""
    if isinstance(salary, dict) and salary:
        parts = []
        if salary.get("from"):
            parts.append(f"from {salary['from']}")
        if salary.get("to"):
            parts.append(f"to {salary['to']}")
        if salary.get("currency"):
            parts.append(str(salary["currency"]))
        salary_text = " ".join(parts)
    elif isinstance(salary, str):
        salary_text = salary

    emp_form = raw.get("employment_form") or {}
    work_formats = raw.get("work_format") or []
    if isinstance(work_formats, list):
        wf = ",".join(
            [(x.get("id") if isinstance(x, dict) else str(x)) for x in work_formats if x]
        )
    else:
        wf = str(work_formats or "")

    snip = raw.get("snippet") or {}
    snippet = " ".join(
        [
            strip_html(snip.get("requirement") or ""),
            strip_html(snip.get("responsibility") or ""),
        ]
    ).strip()

    vid = str(raw.get("id") or "")
    url = raw.get("alternate_url") or f"{HOST_SITE.get(host, 'https://hh.ru')}/vacancy/{vid}"
    return {
        "vacancy_id": vid,
        "host": host,
        "url": url,
        "title": raw.get("name") or "",
        "company": employer.get("name") or "",
        "company_url": (employer.get("site_url") or employer.get("alternate_url") or ""),
        "published_at": raw.get("published_at") or "",
        "employment_form": (emp_form.get("id") if isinstance(emp_form, dict) else str(emp_form or "")),
        "work_format": wf,
        "salary": salary_text,
        "snippet": snippet,
        "description_html": "",
        "employer_type": (employer.get("type") or ""),
        "is_agency": False,
        "has_direct_path": False,
        "route": "",
        "score": 0,
        "status": "new",
        "error_code": "",
        "updated_at": utc_now(),
        "raw_employer_id": str(employer.get("id") or ""),
    }


def strip_html(text: str) -> str:
    text = unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def hh_format_text(text: str) -> str:
    """HH vacancy response formatting rules: ASCII quotes, short dash, -> + light no-ai-slop."""
    if not text:
        return ""
    t = text
    t = t.replace("—", "-").replace("–", "-")
    t = t.replace("→", "->").replace("⇒", "->")
    t = t.replace("«", '"').replace("»", '"')
    t = t.replace("“", '"').replace("”", '"').replace("„", '"')
    for bad in (
        "Я хотел бы выразить заинтересованность",
        "Пишу, чтобы выразить свой интерес",
        "В современном быстро меняющемся мире",
        "В сегодняшнем быстро меняющемся мире",
        "Как высокомотивированный профессионал",
        "I am writing to express my interest",
        "I'm writing to express my interest",
        "In today's fast-paced world",
        "As a highly motivated professional",
        "Let's dive in",
        "It's worth noting that",
    ):
        t = t.replace(bad, "")
    t = re.sub(
        r"(?i)\b(?:delve|leverage|utilize|cutting[- ]edge|game[- ]changer|paradigm\s+shift)\b",
        "",
        t,
    )
    t = re.sub(r"[ \t]{2,}", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def classify_and_score(row: Dict[str, Any], filters: Filters) -> Dict[str, Any]:
    out = dict(row)
    blob = " ".join(
        [
            str(out.get("title") or ""),
            str(out.get("company") or ""),
            str(out.get("snippet") or ""),
            str(out.get("description_html") or ""),
            strip_html(str(out.get("description_html") or "")),
        ]
    ).lower()

    emp_type = str(out.get("employer_type") or "").lower()
    is_agency = emp_type in {x.lower() for x in filters.agency_employer_types}
    hit_exclude = any(k in blob for k in filters.exclude_keywords if k)

    emails = []
    for key in ("contacts_email", "hr_emails_found", "preferred_contact"):
        val = out.get(key) or ""
        emails.extend(EMAIL_RE.findall(str(val)))
    emails = sorted(set(e.lower() for e in emails))
    has_direct = bool(emails) or bool(out.get("contacts_phone")) or bool(out.get("company_url"))

    if is_agency or hit_exclude:
        route = "agency_skip"
        status = "skipped"
        error_code = "agency_skip"
        score = 0
    elif emails or out.get("contacts_phone") or out.get("preferred_contact"):
        route = "direct"
        status = "enriched"
        error_code = ""
        score = 70
    else:
        route = "hh_only"
        status = "enriched"
        error_code = "no_contact" if not has_direct else ""
        score = 50

    # score boosts (not for agency_skip)
    if route != "agency_skip":
        if filters.work_format and filters.work_format.lower() in str(out.get("work_format") or "").lower():
            score += 10
        if filters.employment_form and filters.employment_form.lower() in str(out.get("employment_form") or "").lower():
            score += 10
        if out.get("company_url"):
            score += 5
        if any(any(h in e for h in HR_HINTS) for e in emails):
            score += 10
        score = max(0, min(100, score))
        if score < filters.min_score:
            status = "skipped"
            error_code = error_code or "low_score"

    out.update(
        {
            "is_agency": is_agency,
            "has_direct_path": bool(emails or out.get("contacts_phone")),
            "hr_emails_found": ";".join(emails) if emails else (out.get("hr_emails_found") or ""),
            "route": route,
            "score": score,
            "status": status,
            "error_code": error_code,
            "updated_at": utc_now(),
        }
    )
    return out


def extract_emails_from_html(html: str) -> List[str]:
    found = EMAIL_RE.findall(html or "")
    # drop image/pixel and noreply
    clean = []
    for e in found:
        el = e.lower()
        if any(x in el for x in ("noreply", "no-reply", "example.com", "sentry.io", "wixpress")):
            continue
        clean.append(el)
    # prefer HR-like first
    clean = sorted(set(clean), key=lambda x: (0 if any(h in x for h in HR_HINTS) else 1, x))
    return clean


def fetch_url(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": env("HH_USER_AGENT", "AutoroJobhunter/0.1 (contact@autoro.tech)")},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def enrich_company_site(row: Dict[str, Any], max_pages: int = 3) -> Dict[str, Any]:
    out = dict(row)
    base = (out.get("company_url") or "").strip()
    if not base or not base.startswith("http"):
        return out
    paths = ["", "/contact", "/contacts", "/about", "/career", "/careers", "/jobs", "/hr"]
    emails: List[str] = []
    tried = 0
    for path in paths:
        if tried >= max_pages:
            break
        url = urllib.parse.urljoin(base if base.endswith("/") else base + "/", path.lstrip("/"))
        if path == "":
            url = base
        try:
            html = fetch_url(url)
            emails.extend(extract_emails_from_html(html))
            tried += 1
            time.sleep(random.uniform(0.5, 1.2))
        except Exception:
            tried += 1
            continue
    if emails:
        existing = [e for e in str(out.get("hr_emails_found") or "").split(";") if e]
        merged = sorted(set(existing + emails))
        out["hr_emails_found"] = ";".join(merged)
        if not out.get("contacts_email"):
            out["contacts_email"] = merged[0]
    return out


def build_offers(row: Dict[str, Any], profile: Profile) -> Dict[str, Any]:
    title = row.get("title") or "роль"
    company = row.get("company") or "команда"
    resume = profile.resume_url
    base_a = (
        f"Здравствуйте.\n\n"
        f"По вакансии \"{title}\" в {company}: как Forward Deployed Engineer могу закрыть задачу под ключ - "
        f"встроиться в ваш контекст, автоматизация процессов, AI/агенты, n8n, доставка результата.\n\n"
        f"Стек: {profile.stack}.\n"
        f"Формат: {profile.geo}.\n"
        f"Резюме: {resume}\n\n"
        f"Если актуально - готов созвон на 15 минут или тестовый мини-кейс.\n\n"
        f"{profile.full_name}"
    )
    base_b = (
        f"Добрый день, {company}.\n\n"
        f"Ищу проектную/удалённую роль \"{title}\" (в т.ч. Forward Deployed Engineer). "
        f"Сильная сторона - продукт + маркетинг + автоматизация (процесс -> результат) у заказчика.\n\n"
        f"Релевантно: {profile.roles}.\n"
        f"Резюме и кейсы: {resume}\n\n"
        f"Могу прислать короткое предложение под ваш стек и KPI.\n\n"
        f"{profile.full_name}"
    )
    cover_a = hh_format_text(base_a)
    cover_b = hh_format_text(base_b)
    email_subject = hh_format_text(f"{title} - {profile.full_name}")
    email_body = cover_a
    to = row.get("contacts_email") or (str(row.get("hr_emails_found") or "").split(";")[0] if row.get("hr_emails_found") else "")
    out = dict(row)
    out.update(
        {
            "offer_variant": "A",
            "cover_letter": cover_a,
            "cover_letter_b": cover_b,
            "email_subject": email_subject,
            "email_body": email_body,
            "email_to": to,
            "status": "offer_ready" if out.get("status") not in {"skipped", "error"} else out.get("status"),
            "updated_at": utc_now(),
        }
    )
    if out.get("route") in {"direct", "hh_only"} and out.get("status") == "offer_ready":
        out["status"] = "awaiting_approve"
    return out


def dedupe_rows(rows: Sequence[Dict[str, Any]], existing_keys: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    seen = set(existing_keys or [])
    out: List[Dict[str, Any]] = []
    for r in rows:
        key = f"{r.get('host')}:{r.get('vacancy_id')}"
        if not r.get("vacancy_id") or key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def run_apify_fallback(filters: Filters) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    token = env("APIFY_TOKEN")
    if not token:
        return [], "apify_failed"
    actor = filters.apify_actor_id
    run_url = f"https://api.apify.com/v2/acts/{urllib.parse.quote(actor, safe='')}/runs?token={urllib.parse.quote(token)}&waitForFinish=120"
    search_urls = [filters.search_url] if filters.search_url else [
        f"{HOST_SITE.get(filters.host, 'https://hh.ru')}/search/vacancy?employment_form={filters.employment_form}&work_format={filters.work_format}"
    ]
    payload = json.dumps({"searchUrls": search_urls, "maxItems": filters.per_page * filters.max_pages}).encode("utf-8")
    req = urllib.request.Request(
        run_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            run = json.loads(resp.read().decode("utf-8"))
        dataset_id = ((run.get("data") or {}).get("defaultDatasetId")) or ""
        if not dataset_id:
            return [], "apify_failed"
        ds_url = f"https://api.apify.com/v2/datasets/{dataset_id}/items?token={urllib.parse.quote(token)}&format=json"
        with urllib.request.urlopen(ds_url, timeout=120) as resp:
            items = json.loads(resp.read().decode("utf-8"))
        normalized = []
        for it in items if isinstance(items, list) else []:
            raw = {
                "id": it.get("id") or it.get("vacancyId") or _id_from_url(it.get("url") or it.get("alternate_url") or ""),
                "name": it.get("name") or it.get("title"),
                "alternate_url": it.get("url") or it.get("alternate_url"),
                "employer": {"name": it.get("company") or it.get("employerName") or "", "site_url": it.get("companyUrl") or ""},
                "published_at": it.get("publishedAt") or it.get("published_at") or "",
                "snippet": {"requirement": it.get("description") or it.get("snippet") or ""},
                "employment_form": {"id": filters.employment_form},
                "work_format": [{"id": filters.work_format}],
                "salary": it.get("salary") or {},
            }
            normalized.append(normalize_vacancy(raw, filters.host))
        return normalized, None
    except Exception:
        return [], "apify_failed"


def _id_from_url(url: str) -> str:
    m = re.search(r"/vacancy/(\d+)", url or "")
    return m.group(1) if m else ""


def pipeline_ingest(filters: Filters, existing_keys: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    client = HhClient()
    items, err = client.search_vacancies(filters)
    source = "hh_api"
    if err and filters.apify_fallback:
        items2, err2 = run_apify_fallback(filters)
        if items2:
            items = items2
            source = "apify"
            err = None
        elif not items:
            err = err2 or err
    items = dedupe_rows(items, existing_keys)
    return {"source": source, "error_code": err or "", "items": items, "count": len(items)}


def pipeline_enrich(rows: Sequence[Dict[str, Any]], filters: Filters, fetch_sites: bool = True) -> List[Dict[str, Any]]:
    out = []
    for row in rows:
        r = dict(row)
        if fetch_sites and r.get("company_url"):
            r = enrich_company_site(r)
        out.append(classify_and_score(r, filters))
    return out


def pipeline_offers(rows: Sequence[Dict[str, Any]], profile: Profile) -> List[Dict[str, Any]]:
    return [build_offers(r, profile) for r in rows]


def rows_to_jsonl(rows: Sequence[Dict[str, Any]]) -> str:
    return "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
