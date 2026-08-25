"""Job Responder: Resume RAG slice + vacancy cover letter / question generation."""

from __future__ import annotations

import base64
import hashlib
import html as html_lib
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple
from urllib.error import HTTPError as UrlHTTPError
from urllib.error import URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import BackgroundTasks, Header, HTTPException, Request
from fastapi import File, Form, UploadFile
from pydantic import BaseModel, Field

import os

from kb_file_ingest import MAX_FILE_BYTES, sanitize_extracted_text

_LOG = logging.getLogger("job-responder")

RESUME_KINDS = ("job_resume", "job_experience", "job_skills")
RESUME_SOURCE = "job_responder"
RESUME_TAGS = ["job-responder", "hh"]
PRIMARY_CV_KIND = "job_resume"
JR_PROFILE_MARKER = "---jr_profile---"

HOST_LABELS = {"ru": "hh.ru", "kz": "hh.kz", "uz": "hh.uz", "web": "web"}

# Тестовый режим: без JWT/login. Выключить: JOB_RESPONDER_TEST_MODE=0
JOB_RESPONDER_TEST_MODE = str(os.environ.get("JOB_RESPONDER_TEST_MODE", "1")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
DEFAULT_TEST_WORKSPACE_ID = int(os.environ.get("JOB_RESPONDER_TEST_WORKSPACE_ID", "1") or "1")

# Stay under nginx/CF ~60–100s: never return HTTP 502 (Cloudflare replaces JSON with HTML).
FILE_CAPTURE_BUDGET_SEC = 28.0
# Wall-clock target ~25–35s so CF/nginx do not kill the request.
GENERATE_BUDGET_SEC = 34.0
# Soft caps: many sources are merged into ONE compact profile (not dumped as PDF bodies).
# First attempt is already aggressive - do not start at 6k and only shrink on retry.
SELECTED_SOURCES_MAX = 40
COMPACT_PROFILE_CHARS = 2800
COMPACT_PROFILE_CHARS_RETRY = 1600
COMPACT_PROFILE_KIND = "job_profile_compact"
GENERATE_VACANCY_CHARS = 1600
COVER_TEMPLATE_CHARS = 1200
COVER_TEMPLATE_CHARS_RETRY = 600
LINK_PREVIEW_TIMEOUT_SEC = 5.0
LINK_PREVIEW_MAX = 5
EMBED_REQUEST_TIMEOUT_SEC = 6.0
LLM_ATTEMPT_TIMEOUT_SEC = 11.0
# gemini-2.0-flash is retired (404). Prefer current catalog flash.
JR_GEMINI_MODEL = "gemini-3.5-flash"
_COVER_SNIPPET_RE = re.compile(
    r"сопровод|cover\s*letter|coverletter|cover_letter|motivation\s*letter|шаблон\s*отклик",
    re.I,
)

_SKILL_SPLIT = re.compile(r"[,;/|•·\n]+")
_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9+#.\-]{2,}")
# http(s) URLs in CV/portfolio/text (trim trailing punctuation separately)
_URL_RE = re.compile(r"https?://[^\s<>\"'`)\]]+", re.IGNORECASE)
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_META_DESC_RE = re.compile(
    r"<meta\b[^>]*?(?:name|property)\s*=\s*[\"'](?:description|og:description)[\"'][^>]*>",
    re.I | re.S,
)
_META_CONTENT_RE = re.compile(r"content\s*=\s*[\"'](.*?)[\"']", re.I | re.S)

_KNOWN_TOOLS = {
    "python",
    "javascript",
    "typescript",
    "react",
    "vue",
    "node",
    "nodejs",
    "n8n",
    "comfyui",
    "docker",
    "kubernetes",
    "aws",
    "gcp",
    "azure",
    "sql",
    "postgres",
    "postgresql",
    "mysql",
    "mongodb",
    "redis",
    "llm",
    "openai",
    "chatgpt",
    "gpt",
    "claude",
    "anthropic",
    "gemini",
    "langchain",
    "fastapi",
    "django",
    "flask",
    "nextjs",
    "tailwind",
    "figma",
    "photoshop",
    "premiere",
    "after effects",
    "midjourney",
    "stable diffusion",
    "runway",
    "kling",
    "elevenlabs",
    "selenium",
    "playwright",
    "git",
    "linux",
    "bash",
    "graphql",
    "rest",
    "api",
    "rag",
    "vector",
    "supabase",
    "firebase",
    "telegram",
    "whatsapp",
    "notion",
    "obsidian",
}

_ROLE_HINTS = (
    "engineer",
    "developer",
    "analyst",
    "manager",
    "designer",
    "marketer",
    "creator",
    "videomaker",
    "автоматизатор",
    "разработчик",
    "аналитик",
    "менеджер",
    "дизайнер",
    "маркетолог",
    "нейрокреатор",
)


def hh_format_text(text: str) -> str:
    if not text:
        return ""
    t = text
    t = t.replace("—", "-").replace("–", "-")
    t = t.replace("→", "->").replace("⇒", "->")
    t = t.replace("«", '"').replace("»", '"')
    t = t.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"')
    for bad in (
        "Я хотел бы выразить заинтересованность",
        "Пишу, чтобы выразить свой интерес",
        "В современном быстро меняющемся мире",
        "Как высокомотивированный профессионал",
    ):
        t = t.replace(bad, "")
    return re.sub(r"\n{3,}", "\n\n", t).strip()


_FORM_QUESTION_TYPE_MAP = {
    0: "short_text",
    1: "paragraph",
    2: "multiple_choice",
    3: "dropdown",
    4: "checkboxes",
    5: "linear_scale",
    7: "grid",
    9: "date",
    10: "time",
}


def normalize_questions(raw: Optional[List[Any]]) -> List[Dict[str, Any]]:
    """Normalize legacy string questions and structured Forms/table items."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for i, item in enumerate(raw or []):
        if isinstance(item, str):
            text = re.sub(r"\s+", " ", item).strip()
            qtype = "text"
            opts: List[str] = []
            qid = str(i + 1)
        elif isinstance(item, dict):
            text = re.sub(
                r"\s+",
                " ",
                str(item.get("text") or item.get("question") or item.get("q") or ""),
            ).strip()
            qtype = str(item.get("type") or "text").strip()[:64] or "text"
            raw_opts = item.get("options") or []
            opts = []
            if isinstance(raw_opts, list):
                for o in raw_opts:
                    s = re.sub(r"\s+", " ", str(o or "")).strip()
                    if s and s not in opts:
                        opts.append(s[:500])
            qid = str(item.get("id") or i + 1)[:128]
        else:
            continue
        if not text or len(text) < 2:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": qid,
                "text": text[:4000],
                "type": qtype,
                "options": opts[:40],
            }
        )
        if len(out) >= 40:
            break
    return out


def parse_answers_json(
    raw: str,
    *,
    expected_questions: Optional[List[Dict[str, Any]]] = None,
) -> Optional[List[Dict[str, str]]]:
    """Parse LLM Q&A JSON; tolerate markdown fences and leading prose.

    Backfill empty `question` fields from expected_questions by index so the
    side panel never shows blank «Q:».
    """
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    parsed = None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\[[\s\S]*\]", text)
        if not m:
            return None
        try:
            parsed = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    if not isinstance(parsed, list):
        return None
    expected = list(expected_questions or [])
    out: List[Dict[str, str]] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            continue
        q = str(item.get("question") or item.get("q") or item.get("text") or "").strip()
        a = hh_format_text(str(item.get("answer") or item.get("a") or "").strip())
        if not q and idx < len(expected):
            q = str(expected[idx].get("text") or expected[idx].get("question") or "").strip()
        if not q and not a:
            continue
        out.append({"question": q, "answer": a})
    # If LLM returned fewer answers than questions, pad with empty answers
    if expected and len(out) < len(expected):
        have = {str(x.get("question") or "").strip().lower() for x in out}
        for eq in expected:
            et = str(eq.get("text") or eq.get("question") or "").strip()
            if not et:
                continue
            if et.lower() in have:
                continue
            out.append({"question": et, "answer": ""})
            have.add(et.lower())
    return out or None


def require_job_responder_user_auth(auth_ctx: Dict[str, Any]) -> None:
    if JOB_RESPONDER_TEST_MODE:
        return
    mode = str(auth_ctx.get("auth_mode") or "")
    if mode in ("dev_bypass", "supabase_user", "bootstrap_token"):
        return
    raise HTTPException(
        status_code=403,
        detail="Job Responder requires user login (email/password JWT). Service API keys are not allowed.",
    )


def resolve_job_responder_auth(
    request: Request,
    x_api_key: Optional[str],
    authorization: Optional[str],
    verify_bookmarks_access: Callable[..., Dict[str, Any]],
) -> Dict[str, Any]:
    """In test mode skip auth entirely; otherwise require Keept JWT/bootstrap."""
    if JOB_RESPONDER_TEST_MODE:
        return {
            "client_ip": getattr(request.client, "host", None) if request.client else None,
            "auth_mode": "dev_bypass",
            "user_id": "job-responder-test",
            "test_mode": True,
            "default_workspace_id": DEFAULT_TEST_WORKSPACE_ID,
        }
    auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
    require_job_responder_user_auth(auth_ctx)
    return auth_ctx


class JobResponderVacancyStructured(BaseModel):
    salary: Optional[str] = Field(default=None, max_length=500)
    experience: Optional[str] = Field(default=None, max_length=500)
    employmentType: Optional[str] = Field(default=None, max_length=200)
    schedule: Optional[str] = Field(default=None, max_length=200)
    workingHours: Optional[str] = Field(default=None, max_length=300)
    workFormat: Optional[str] = Field(default=None, max_length=200)
    keySkills: List[str] = Field(default_factory=list)
    seniority: Optional[str] = Field(default=None, max_length=100)
    location: Optional[str] = Field(default=None, max_length=300)


class JobResponderQuestionItem(BaseModel):
    id: Optional[str] = Field(default=None, max_length=128)
    text: str = Field(..., min_length=1, max_length=4000)
    type: str = Field(default="text", max_length=64)
    options: List[str] = Field(default_factory=list)


class JobResponderVacancyPayload(BaseModel):
    url: Optional[str] = Field(default=None, max_length=4000)
    title: str = Field(..., min_length=1, max_length=1000)
    company: Optional[str] = Field(default=None, max_length=500)
    description: str = Field(..., min_length=1, max_length=50000)
    # str (legacy) or {id,text,type,options[]} for Google Forms / table Q&A
    questions: List[Any] = Field(default_factory=list)
    structured: Optional[JobResponderVacancyStructured] = None
    source: Optional[str] = Field(default=None, max_length=64)


class JobResponderGeneratePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    # "qa" is an alias for question_answers
    mode: Literal["cover_letter", "question_answers", "qa"] = "cover_letter"
    host: str = Field(default="web", max_length=32)
    vacancy: JobResponderVacancyPayload
    locale: str = Field(default="ru", max_length=16)
    selectedSourceIds: List[int] = Field(default_factory=list)
    # Optional top-level questions (Forms / table); merges into vacancy.questions
    questions: Optional[List[Any]] = None
    # User's own cover letter to adapt (not write from scratch). Alias: baseLetter.
    coverTemplate: Optional[str] = Field(default=None, max_length=20000)
    baseLetter: Optional[str] = Field(default=None, max_length=20000)
    # Extra generation instructions from side panel (contacts, links, tone, etc.)
    promptExtra: Optional[str] = Field(default=None, max_length=8000)
    customInstructions: Optional[str] = Field(default=None, max_length=8000)
    # Contact/profile overrides (Telegram, email, links) - win over conflicting RAG data
    profileOverrides: Optional[Dict[str, Any]] = None
    # Prefer Gemini File Search RAG when JOB_RESPONDER_GEMINI_RAG=1 and store ready
    useGeminiRag: Optional[bool] = None


class JobResponderGeminiRagSyncPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    poll: bool = True


class JobResponderResumeCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=1000)
    text: str = Field(..., min_length=20, max_length=200000)
    kind: str = Field(default="job_resume", max_length=64)
    category: str = Field(default="cv", max_length=128)


class JobResponderTextCapturePayload(BaseModel):
    """Paste free-form text into Resume RAG (source=job_responder)."""

    workspaceId: str = Field(..., min_length=1, max_length=64)
    text: str = Field(..., min_length=20, max_length=200000)
    title: Optional[str] = Field(default=None, max_length=1000)
    kind: str = Field(default="job_experience", max_length=64)
    category: str = Field(default="notes", max_length=128)


class JobResponderResumeSearchPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    query: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(default=12, ge=1, le=50)


class JobResponderResumeLinkCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    url: str = Field(..., min_length=8, max_length=4000)
    title: Optional[str] = Field(default=None, max_length=1000)
    kind: str = Field(default="job_experience", max_length=64)
    category: str = Field(default="experience", max_length=128)


class JobResponderRelevancePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    vacancy: JobResponderVacancyPayload
    selectedSourceIds: List[int] = Field(default_factory=list)


class JobResponderDriveImportPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    folderUrlOrId: str = Field(..., min_length=5, max_length=2000)
    accessToken: Optional[str] = Field(default=None, max_length=8000)
    kind: str = Field(default="job_experience", max_length=64)
    category: str = Field(default="drive", max_length=128)
    maxFiles: int = Field(default=25, ge=1, le=50)


class JobResponderDeleteSourcesPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    knowledgeItemIds: List[int] = Field(default_factory=list)
    titles: List[str] = Field(default_factory=list)


def _uniq_lower(items: List[str], limit: int = 40) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in items:
        s = re.sub(r"\s+", " ", str(raw or "").strip())
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s[:80])
        if len(out) >= limit:
            break
    return out


def extract_urls_from_text(text: str, limit: int = 20) -> List[str]:
    """Extract unique http(s) URLs from free text / OCR / CV content."""
    if not text:
        return []
    out: List[str] = []
    seen = set()
    for m in _URL_RE.finditer(text):
        raw = m.group(0).rstrip(".,;:!?)]}>\"'")
        if not raw or len(raw) < 8:
            continue
        key = raw.lower().rstrip("/")
        if key in seen:
            continue
        seen.add(key)
        out.append(raw)
        if len(out) >= limit:
            break
    return out


def resolve_cover_template(cover_template: Optional[str], base_letter: Optional[str], *, max_chars: int = COVER_TEMPLATE_CHARS) -> str:
    raw = (cover_template or base_letter or "").strip()
    return raw[: max(500, int(max_chars))] if raw else ""


def extract_resume_profile(text: str, *, title: str = "", category: str = "") -> Dict[str, Any]:
    """Heuristic structured params for RAG matching touchpoints."""
    blob = f"{title}\n{text}"
    lower = blob.lower()

    skills: List[str] = []
    for m in re.finditer(
        r"(?:skills|навыки|стек|stack|технологии|tools)[:\s]+(.{10,400})",
        blob,
        flags=re.I,
    ):
        skills.extend(p.strip() for p in _SKILL_SPLIT.split(m.group(1)) if len(p.strip()) >= 2)

    tools = [t for t in _KNOWN_TOOLS if t in lower]
    skills.extend(tools)

    roles: List[str] = []
    for hint in _ROLE_HINTS:
        if hint in lower:
            roles.append(hint)

    languages: List[str] = []
    for lang in ("english", "russian", "украинский", "английский", "русский", "deutsch", "french"):
        if lang in lower:
            languages.append(lang)

    employment_preferences: List[str] = []
    for pref, labels in (
        ("remote", ("remote", "удалён", "удален", "work from home")),
        ("hybrid", ("hybrid", "гибрид")),
        ("office", ("office", "офис")),
        ("part_time", ("part-time", "частичн", "part time")),
        ("full_time", ("full-time", "полная занятость", "full time")),
    ):
        if any(x in lower for x in labels):
            employment_preferences.append(pref)

    seniority = None
    for level, labels in (
        ("junior", ("junior", "джун")),
        ("middle", ("middle", "мидл", "mid-level")),
        ("senior", ("senior", "сеньор", "lead")),
    ):
        if any(x in lower for x in labels):
            seniority = level
            break

    domains: List[str] = []
    for dom in (
        "ai",
        "ml",
        "marketing",
        "seo",
        "automation",
        "fintech",
        "web3",
        "crypto",
        "saas",
        "ecommerce",
        "video",
        "content",
        "devrel",
    ):
        if re.search(rf"\b{re.escape(dom)}\b", lower):
            domains.append(dom)

    geo_remote = None
    if "remote" in lower or "удал" in lower:
        geo_remote = "remote"
    elif "hybrid" in lower or "гибрид" in lower:
        geo_remote = "hybrid"

    experience_bullets: List[str] = []
    for line in (text or "").splitlines():
        s = re.sub(r"\s+", " ", line).strip(" -•*\t")
        if 24 <= len(s) <= 220 and re.search(
            r"(опыт|проект|разработ|автоматиз|внедр|запуск|руковод|built|led|developed|automated)",
            s,
            flags=re.I,
        ):
            experience_bullets.append(s[:200])
        if len(experience_bullets) >= 12:
            break

    education: List[str] = []
    for m in re.finditer(
        r"(?:образование|education|университет|university|bachelor|master|магистр|бакалавр)[:\s]+(.{8,180})",
        blob,
        flags=re.I,
    ):
        education.append(m.group(0).strip()[:180])

    achievements: List[str] = []
    for m in re.finditer(
        r"(?:достижен|achievement|наград|award|сертификат|certificate)[:\s]+(.{8,180})",
        blob,
        flags=re.I,
    ):
        achievements.append(m.group(0).strip()[:180])

    link_urls = extract_urls_from_text(text, limit=12)
    links = [{"url": u, "title": "", "summary": ""} for u in link_urls]

    profile = {
        "skills": _uniq_lower(skills, 50),
        "roles": _uniq_lower(roles, 20),
        "domains": _uniq_lower(domains, 20),
        "tools": _uniq_lower(tools, 40),
        "languages": _uniq_lower(languages, 10),
        "employment_preferences": _uniq_lower(employment_preferences, 10),
        "seniority": seniority,
        "geo_remote": geo_remote,
        "category_hint": (category or "")[:64] or None,
        "experience_bullets": _uniq_lower(experience_bullets, 12),
        "education": _uniq_lower(education, 6),
        "achievements": _uniq_lower(achievements, 8),
        "links": links[:12],
    }
    return profile


def wrap_content_with_profile(text: str, profile: Dict[str, Any]) -> Tuple[str, str]:
    """Returns (content_text, ai_summary) with embedded JSON profile for retrieval."""
    body = (text or "").strip()
    profile_json = json.dumps(profile, ensure_ascii=False, separators=(",", ":"))
    content = f"{JR_PROFILE_MARKER}\n{profile_json}\n---\n{body}"
    bits = []
    if profile.get("skills"):
        bits.append("skills: " + ", ".join(profile["skills"][:12]))
    if profile.get("roles"):
        bits.append("roles: " + ", ".join(profile["roles"][:6]))
    if profile.get("tools"):
        bits.append("tools: " + ", ".join(profile["tools"][:10]))
    if profile.get("employment_preferences"):
        bits.append("prefs: " + ", ".join(profile["employment_preferences"]))
    if profile.get("seniority"):
        bits.append(f"seniority: {profile['seniority']}")
    if profile.get("geo_remote"):
        bits.append(f"format: {profile['geo_remote']}")
    if profile.get("experience_bullets"):
        bits.append("exp: " + " | ".join(profile["experience_bullets"][:4]))
    if profile.get("education"):
        bits.append("edu: " + "; ".join(profile["education"][:2]))
    if profile.get("achievements"):
        bits.append("ach: " + "; ".join(profile["achievements"][:2]))
    described_links = [
        x
        for x in (profile.get("links") or [])
        if isinstance(x, dict) and (x.get("title") or x.get("summary"))
    ]
    if described_links:
        bits.append(
            "links: "
            + "; ".join(
                f"{x.get('title') or x.get('url')}: {x.get('summary') or ''}".strip()[:160]
                for x in described_links[:5]
            )
        )
    summary = "; ".join(bits) if bits else body[:400].replace("\n", " ")
    return content, summary[:4000]


def parse_profile_from_content(text: str) -> Dict[str, Any]:
    raw = text or ""
    if JR_PROFILE_MARKER not in raw:
        return extract_resume_profile(raw)
    try:
        after = raw.split(JR_PROFILE_MARKER, 1)[1].lstrip()
        json_part = after.split("\n---", 1)[0].strip()
        data = json.loads(json_part)
        if isinstance(data, dict):
            return data
    except (json.JSONDecodeError, IndexError, TypeError):
        pass
    return extract_resume_profile(raw)


def strip_profile_wrapper(text: str) -> str:
    raw = text or ""
    if JR_PROFILE_MARKER not in raw:
        return raw
    parts = raw.split("\n---\n", 1)
    return parts[1] if len(parts) > 1 else raw


def normalize_for_dedupe(text: str) -> str:
    body = strip_profile_wrapper(text)
    return re.sub(r"\s+", " ", body or "").strip().lower()[:4000]


def near_duplicate_hash(text: str) -> str:
    return hashlib.sha256(normalize_for_dedupe(text).encode("utf-8")).hexdigest()


def _collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", html_lib.unescape(s or "")).strip()


def fetch_link_preview(url: str, timeout_sec: float = LINK_PREVIEW_TIMEOUT_SEC) -> Dict[str, str]:
    """Lightweight title + meta description. Hard timeout, no Jina."""
    out = {"url": url, "title": "", "summary": ""}
    if not url or not url.lower().startswith("http"):
        return out
    req = UrlRequest(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; JobResponder/0.5; +https://swoop.autoro.tech)",
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=max(1.0, float(timeout_sec))) as resp:
            raw = resp.read(80_000)
            ctype = (resp.headers.get("Content-Type") or "").lower()
    except (UrlHTTPError, URLError, TimeoutError, OSError, ValueError):
        return out
    if "html" not in ctype and not raw[:32].lstrip().lower().startswith((b"<!doctype", b"<html")):
        return out
    try:
        html = raw.decode("utf-8", errors="ignore")
    except Exception:
        html = raw.decode("latin-1", errors="ignore")
    tm = _TITLE_RE.search(html)
    if tm:
        out["title"] = _collapse_ws(re.sub(r"<[^>]+>", "", tm.group(1)))[:180]
    mm = _META_DESC_RE.search(html)
    if mm:
        cm = _META_CONTENT_RE.search(mm.group(0))
        if cm:
            out["summary"] = _collapse_ws(cm.group(1))[:400]
    if not out["summary"]:
        stripped = _collapse_ws(re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<[^>]+>", " ", html))
        out["summary"] = stripped[:280]
    return out


def call_with_timeout(fn, timeout_sec: float, *args, **kwargs):
    """Run fn with a hard timeout. Do not wait on shutdown if it fired - CF/nginx will 502 otherwise."""
    pool = ThreadPoolExecutor(max_workers=1)
    fut = pool.submit(fn, *args, **kwargs)
    try:
        result = fut.result(timeout=max(1.0, float(timeout_sec)))
    except FuturesTimeout:
        try:
            pool.shutdown(wait=False, cancel_futures=True)
        except TypeError:
            pool.shutdown(wait=False)
        raise
    pool.shutdown(wait=True)
    return result


def cap_rag_items(rows: List[Dict[str, Any]], *, max_n: int = SELECTED_SOURCES_MAX) -> Tuple[List[Dict[str, Any]], bool]:
    ranked = sorted(
        [dict(r) for r in rows],
        key=lambda r: (0 if str(r.get("kind") or "") == PRIMARY_CV_KIND else 1, str(r.get("updated_at") or "")),
    )
    # Skip cached compact profile rows if any slipped into the set.
    ranked = [r for r in ranked if str(r.get("kind") or "") != COMPACT_PROFILE_KIND]
    capped = ranked[: max(1, int(max_n))]
    return capped, len(ranked) > len(capped)


def _row_profile(row: Dict[str, Any]) -> Dict[str, Any]:
    body = str(row.get("content_text") or row.get("ai_summary") or "")
    title = str(row.get("title") or "")
    prof = parse_profile_from_content(body)
    if not prof.get("tools") or not prof.get("skills"):
        soft = extract_resume_profile(body, title=title, category=str(row.get("category") or ""))
        for k in ("skills", "tools", "roles", "domains", "employment_preferences", "languages", "education", "achievements"):
            if not prof.get(k) and soft.get(k):
                prof[k] = soft[k]
        if not prof.get("experience_bullets") and soft.get("experience_bullets"):
            prof["experience_bullets"] = soft["experience_bullets"]
        if not prof.get("geo_remote") and soft.get("geo_remote"):
            prof["geo_remote"] = soft["geo_remote"]
        if not prof.get("seniority") and soft.get("seniority"):
            prof["seniority"] = soft["seniority"]
        if not prof.get("links") and soft.get("links"):
            prof["links"] = soft["links"]
    return prof


def merge_profiles_from_rows(resume_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Merge many Resume RAG sources into one workspace-level compact profile."""
    skills: List[str] = []
    tools: List[str] = []
    roles: List[str] = []
    domains: List[str] = []
    languages: List[str] = []
    prefs: List[str] = []
    experience_bullets: List[str] = []
    education: List[str] = []
    achievements: List[str] = []
    links: List[Dict[str, str]] = []
    cover_snippets: List[str] = []
    source_titles: List[str] = []
    formats: List[str] = []
    seniority: Optional[str] = None
    text_bits: List[str] = []
    seen_link: set = set()
    seen_cover: set = set()

    for row in resume_rows:
        if str(row.get("kind") or "") == COMPACT_PROFILE_KIND:
            continue
        title = str(row.get("title") or "").strip()
        if title:
            source_titles.append(title[:120])
        body = str(row.get("content_text") or row.get("ai_summary") or "")
        plain = strip_profile_wrapper(body)
        text_bits.append(f"{title} {plain[:2500]}")
        prof = _row_profile(row)
        skills.extend(prof.get("skills") or [])
        tools.extend(prof.get("tools") or [])
        roles.extend(prof.get("roles") or [])
        domains.extend(prof.get("domains") or [])
        languages.extend(prof.get("languages") or [])
        prefs.extend(prof.get("employment_preferences") or [])
        experience_bullets.extend(prof.get("experience_bullets") or [])
        education.extend(prof.get("education") or [])
        achievements.extend(prof.get("achievements") or [])
        if prof.get("geo_remote"):
            formats.append(str(prof["geo_remote"]))
        if prof.get("seniority") and not seniority:
            seniority = str(prof["seniority"])
        for lk in prof.get("links") or []:
            if not isinstance(lk, dict):
                continue
            url = str(lk.get("url") or "").strip()
            key = url.lower().rstrip("/")
            if not key or key in seen_link:
                continue
            seen_link.add(key)
            links.append(
                {
                    "url": url[:400],
                    "title": str(lk.get("title") or "")[:120],
                    "summary": str(lk.get("summary") or "")[:220],
                }
            )
        hay = f"{title}\n{plain[:800]}"
        if _COVER_SNIPPET_RE.search(hay):
            snip = re.sub(r"\s+", " ", plain).strip()[:420]
            key = snip.lower()[:160]
            if snip and key not in seen_cover:
                seen_cover.add(key)
                cover_snippets.append(snip)

    blob = " ".join(text_bits).lower()
    tools = _uniq_lower([*tools, *[t for t in _KNOWN_TOOLS if t in blob]], 40)

    return {
        "skills": _uniq_lower(skills, 40),
        "tools": tools,
        "roles": _uniq_lower(roles, 16),
        "domains": _uniq_lower(domains, 16),
        "languages": _uniq_lower(languages, 10),
        "employment_preferences": _uniq_lower(prefs, 10),
        "seniority": seniority,
        "geo_remote": (formats[0] if formats else None),
        "experience_bullets": _uniq_lower(experience_bullets, 14),
        "education": _uniq_lower(education, 6),
        "achievements": _uniq_lower(achievements, 8),
        "links": links[:12],
        "cover_snippets": cover_snippets[:3],
        "source_titles": list(dict.fromkeys(source_titles))[:24],
        "source_count": len(resume_rows),
        "_text_blob": blob[:12000],
    }


def format_compact_profile(profile: Dict[str, Any], *, max_chars: int = COMPACT_PROFILE_CHARS) -> str:
    """Render merged profile as a single lean RESUME CONTEXT block."""
    max_chars = max(1200, int(max_chars))

    def render(
        *,
        skill_n: int,
        tool_n: int,
        bullet_n: int,
        link_n: int,
        title_n: int,
        with_snippets: bool,
        with_ach: bool,
    ) -> str:
        lines: List[str] = [
            "UNIFIED RESUME PROFILE (compact, deduped)",
            f"sources_merged: {int(profile.get('source_count') or 0)}",
        ]
        overrides = [str(x) for x in (profile.get("contact_overrides") or []) if str(x).strip()]
        if overrides:
            lines.append("PROFILE OVERRIDES (prefer over conflicting contacts/links below):")
            for bit in overrides[:16]:
                lines.append(f"- {bit[:200]}")
        if profile.get("telegram"):
            lines.append(f"telegram: {profile['telegram']}")
        if profile.get("email"):
            lines.append(f"email: {profile['email']}")
        if profile.get("phone"):
            lines.append(f"phone: {profile['phone']}")
        titles = list(profile.get("source_titles") or [])[:title_n]
        if titles:
            lines.append("source_titles: " + "; ".join(str(t)[:80] for t in titles))

        def add_csv(label: str, values: Any, n: int) -> None:
            items = [str(x) for x in (values or []) if str(x).strip()][:n]
            if items:
                lines.append(f"{label}: " + ", ".join(items))

        add_csv("skills", profile.get("skills"), skill_n)
        add_csv("tools", profile.get("tools"), tool_n)
        add_csv("roles", profile.get("roles"), 10)
        add_csv("domains", profile.get("domains"), 10)
        add_csv("languages", profile.get("languages"), 8)
        add_csv("employment", profile.get("employment_preferences"), 8)
        if profile.get("seniority"):
            lines.append(f"seniority: {profile['seniority']}")
        if profile.get("geo_remote"):
            lines.append(f"format: {profile['geo_remote']}")

        bullets = [str(x) for x in (profile.get("experience_bullets") or []) if str(x).strip()][:bullet_n]
        if bullets:
            lines.append("experience:")
            for b in bullets:
                lines.append(f"- {b[:180]}")

        edu = [str(x) for x in (profile.get("education") or []) if str(x).strip()][:4]
        if edu:
            lines.append("education: " + "; ".join(e[:140] for e in edu))
        if with_ach:
            ach = [str(x) for x in (profile.get("achievements") or []) if str(x).strip()][:4]
            if ach:
                lines.append("achievements: " + "; ".join(a[:140] for a in ach))

        link_lines = []
        for lk in list(profile.get("links") or [])[:link_n]:
            if not isinstance(lk, dict):
                continue
            desc = (lk.get("summary") or lk.get("title") or "").strip()
            bit = f"{lk.get('url')}"
            if desc:
                bit += f" - {desc[:140]}"
            link_lines.append(bit[:200])
        if link_lines:
            lines.append("links:")
            for bit in link_lines:
                lines.append(f"- {bit}")

        if with_snippets:
            snippets = [str(x) for x in (profile.get("cover_snippets") or []) if str(x).strip()][:2]
            if snippets:
                lines.append("cover_snippets:")
                for s in snippets:
                    lines.append(f"- {s[:280]}")

        return "\n".join(lines)

    tiers = (
        dict(skill_n=28, tool_n=24, bullet_n=10, link_n=8, title_n=12, with_snippets=True, with_ach=True),
        dict(skill_n=20, tool_n=16, bullet_n=6, link_n=4, title_n=6, with_snippets=False, with_ach=True),
        dict(skill_n=14, tool_n=12, bullet_n=4, link_n=2, title_n=4, with_snippets=False, with_ach=False),
    )
    text = ""
    for opts in tiers:
        text = render(**opts)
        if len(text) <= max_chars:
            return text
    return text[: max_chars - 20].rstrip() + "\n…(truncated)"


def profile_tags(profile: Dict[str, Any], extra: Optional[List[str]] = None) -> List[str]:
    tags = list(RESUME_TAGS)
    if extra:
        tags.extend(extra)
    for skill in (profile.get("skills") or [])[:8]:
        tags.append(f"skill:{str(skill).lower()[:40]}")
    for role in (profile.get("roles") or [])[:4]:
        tags.append(f"role:{str(role).lower()[:40]}")
    for dom in (profile.get("domains") or [])[:4]:
        tags.append(f"domain:{str(dom).lower()[:40]}")
    if profile.get("seniority"):
        tags.append(f"seniority:{profile['seniority']}")
    if profile.get("geo_remote"):
        tags.append(f"format:{profile['geo_remote']}")
    return list(dict.fromkeys(tags))[:24]


def vacancy_to_match_blob(vacancy: JobResponderVacancyPayload) -> Dict[str, Any]:
    st = vacancy.structured
    skills = list(st.keySkills) if st and st.keySkills else []
    blob = " ".join(
        p
        for p in (
            vacancy.title,
            vacancy.company or "",
            vacancy.description[:3000],
            (st.salary if st else None) or "",
            (st.experience if st else None) or "",
            (st.employmentType if st else None) or "",
            (st.schedule if st else None) or "",
            (st.workingHours if st else None) or "",
            (st.workFormat if st else None) or "",
            " ".join(skills),
        )
        if p
    )
    profile = extract_resume_profile(blob, title=vacancy.title)
    if skills:
        profile["skills"] = _uniq_lower([*skills, *profile.get("skills", [])], 50)
    if st:
        if st.workFormat:
            wf = st.workFormat.lower()
            if "удал" in wf or "remote" in wf:
                profile["geo_remote"] = "remote"
            elif "гибрид" in wf or "hybrid" in wf:
                profile["geo_remote"] = "hybrid"
            elif "офис" in wf or "office" in wf:
                profile["geo_remote"] = "office"
        if st.employmentType:
            et = st.employmentType.lower()
            prefs = list(profile.get("employment_preferences") or [])
            if "частич" in et or "part" in et:
                prefs.append("part_time")
            if "полн" in et or "full" in et:
                prefs.append("full_time")
            profile["employment_preferences"] = _uniq_lower(prefs, 10)
        if st.experience:
            profile["experience_raw"] = st.experience[:200]
        if st.seniority:
            profile["seniority"] = st.seniority
    return profile


def _parse_experience_years(text: str) -> Optional[float]:
    raw = (text or "").lower()
    if not raw:
        return None
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*\+?\s*(?:лет|года|год|years?|yrs?)", raw)
    if m:
        try:
            return float(m.group(1).replace(",", "."))
        except ValueError:
            return None
    if "без опыта" in raw or "no experience" in raw:
        return 0.0
    return None


def score_resume_vs_vacancy(
    vacancy: JobResponderVacancyPayload,
    resume_rows: List[Dict[str, Any]],
    *,
    merged_profile: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Deterministic 0–100 score with explainable matched/missing bullets."""
    vac_profile = vacancy_to_match_blob(vacancy)
    vac_skills = {s.lower() for s in (vac_profile.get("skills") or [])}
    vac_tools = {s.lower() for s in (vac_profile.get("tools") or [])}
    vac_roles = {s.lower() for s in (vac_profile.get("roles") or [])}
    vac_domains = {s.lower() for s in (vac_profile.get("domains") or [])}
    vac_prefs = {s.lower() for s in (vac_profile.get("employment_preferences") or [])}
    vac_format = (vac_profile.get("geo_remote") or "").lower()
    vac_seniority = str(vac_profile.get("seniority") or "").lower() or None
    vac_exp_years = _parse_experience_years(str(vac_profile.get("experience_raw") or ""))

    # Tools mentioned in vacancy title/description even if not in structured skills
    vac_blob = " ".join(
        p
        for p in (
            vacancy.title,
            vacancy.company or "",
            vacancy.description[:4000],
            " ".join(vac_skills),
        )
        if p
    ).lower()
    vac_tools |= {t for t in _KNOWN_TOOLS if t in vac_blob}

    profile = merged_profile or merge_profiles_from_rows(resume_rows)
    merged_skills = {s.lower() for s in (profile.get("skills") or [])}
    merged_tools = {s.lower() for s in (profile.get("tools") or [])}
    merged_roles = {s.lower() for s in (profile.get("roles") or [])}
    merged_domains = {s.lower() for s in (profile.get("domains") or [])}
    merged_prefs = {s.lower() for s in (profile.get("employment_preferences") or [])}
    resume_formats = {str(profile.get("geo_remote") or "").lower()} - {""}
    resume_seniority = str(profile.get("seniority") or "").lower() or None
    resume_titles = [str(t).lower() for t in (profile.get("source_titles") or [])]
    resume_text_blob = str(profile.get("_text_blob") or "")
    if not resume_text_blob:
        resume_text_blob = " ".join(
            [
                " ".join(profile.get("skills") or []),
                " ".join(profile.get("tools") or []),
                " ".join(profile.get("experience_bullets") or []),
                " ".join(resume_titles),
            ]
        ).lower()
    resume_exp_years: List[float] = []
    for bit in list(profile.get("experience_bullets") or [])[:8]:
        ey = _parse_experience_years(str(bit))
        if ey is not None:
            resume_exp_years.append(ey)
    for row in resume_rows[:6]:
        ey = _parse_experience_years(strip_profile_wrapper(str(row.get("content_text") or ""))[:1500])
        if ey is not None:
            resume_exp_years.append(ey)

    merged_tools |= {t for t in _KNOWN_TOOLS if t in resume_text_blob}

    if not resume_rows and not (merged_skills or merged_tools):
        return {
            "score": 0,
            "rationale": ["Нет выбранных/найденных источников Resume RAG"],
            "matched": [],
            "missing": ["Загрузите CV / portfolio в Resume RAG"],
            "vacancyProfile": vac_profile,
            "matchedSkills": [],
            "matchedTools": [],
            "missingSkills": sorted(vac_skills)[:12],
            "missingTools": sorted(vac_tools)[:12],
            "compactProfile": {
                "sourceCount": int(profile.get("source_count") or 0),
                "skills": list(profile.get("skills") or [])[:12],
                "tools": list(profile.get("tools") or [])[:12],
            },
        }

    score = 0
    rationale: List[str] = []
    matched: List[str] = []
    missing: List[str] = []
    skill_hits: List[str] = []
    skill_miss: List[str] = []
    tool_hits: List[str] = []
    tool_miss: List[str] = []

    # --- Tools (0–28) ---
    tool_hits = sorted(vac_tools & merged_tools)
    tool_miss = sorted(vac_tools - merged_tools)
    if vac_tools:
        ratio = len(tool_hits) / max(len(vac_tools), 1)
        pts = int(28 * min(1.0, ratio))
        score += pts
        if tool_hits:
            matched.append(f"Инструменты: {', '.join(tool_hits[:10])}")
            rationale.append(f"Инструменты +{pts}: {', '.join(tool_hits[:8])}")
        if tool_miss:
            missing.append(f"Инструменты: {', '.join(tool_miss[:8])}")
    else:
        score += 6
        rationale.append("В вакансии мало явных tool-keywords - мягкий бонус")

    # --- Skills (0–30), excluding pure tools already counted ---
    skill_pool = vac_skills - vac_tools
    resume_skill_pool = merged_skills | merged_tools
    skill_hits = sorted(skill_pool & resume_skill_pool) if skill_pool else sorted(vac_skills & resume_skill_pool)
    skill_miss = sorted(skill_pool - resume_skill_pool) if skill_pool else sorted(vac_skills - resume_skill_pool)
    if vac_skills or skill_pool:
        denom = max(len(skill_pool or vac_skills), 1)
        ratio = len(skill_hits) / denom
        pts = int(30 * min(1.0, ratio))
        score += pts
        if skill_hits:
            matched.append(f"Навыки: {', '.join(skill_hits[:10])}")
            rationale.append(f"Навыки +{pts}: {', '.join(skill_hits[:8])}")
        else:
            rationale.append("Прямых совпадений навыков мало")
            score = max(0, score - 4)
        if skill_miss:
            missing.append(f"Навыки: {', '.join(skill_miss[:8])}")
    else:
        # soft title token overlap
        title_tokens = {
            t.lower()
            for t in _TOKEN_RE.findall(vacancy.title or "")
            if len(t) > 2 and t.lower() not in {"для", "and", "the", "with"}
        }
        soft = sorted(title_tokens & (merged_skills | merged_tools | merged_roles | merged_domains))
        if soft:
            pts = min(18, 4 * len(soft))
            score += pts
            matched.append(f"По заголовку: {', '.join(soft[:6])}")
            rationale.append(f"Совпадения по заголовку +{pts}: {', '.join(soft[:6])}")
        else:
            rationale.append("Мало пересечений по навыкам/заголовку")

    # --- Role / title (0–18) ---
    role_hits = sorted(vac_roles & merged_roles)
    title_l = (vacancy.title or "").lower()
    resume_lower = resume_text_blob
    title_in_resume = any(
        len(tok) > 3 and tok in resume_lower
        for tok in _TOKEN_RE.findall(title_l)
    ) or any(any(tok in rt for tok in title_l.split() if len(tok) > 3) for rt in resume_titles)
    role_pts = 0
    if role_hits:
        role_pts += 10
        matched.append(f"Роли: {', '.join(role_hits[:4])}")
    if title_in_resume:
        role_pts += 8
        matched.append("Заголовок вакансии отражён в compact profile")
    elif vac_roles and not role_hits:
        missing.append(f"Роли: {', '.join(sorted(vac_roles)[:4])}")
    score += min(18, role_pts)
    if role_pts:
        rationale.append(f"Роль/title +{min(18, role_pts)}")

    # --- Domains (0–8) ---
    domain_hits = sorted(vac_domains & merged_domains)
    if domain_hits:
        score += min(8, 4 * len(domain_hits))
        matched.append(f"Домены: {', '.join(domain_hits[:4])}")
        rationale.append(f"Домены: {', '.join(domain_hits[:4])}")
    elif vac_domains:
        missing.append(f"Домены: {', '.join(sorted(vac_domains)[:4])}")

    # --- Work format (0–10) ---
    if vac_format:
        if vac_format in resume_formats or (vac_format == "remote" and "remote" in merged_prefs):
            score += 10
            matched.append(f"Формат: {vac_format}")
            rationale.append(f"Формат работы совпадает: {vac_format}")
        else:
            score -= 4
            missing.append(f"Формат вакансии: {vac_format}")
            rationale.append(f"Формат ({vac_format}) не подтверждён в Resume RAG")

    # --- Employment prefs (0–5) ---
    pref_hits = sorted(vac_prefs & merged_prefs)
    if pref_hits:
        score += 5
        matched.append(f"Занятость: {', '.join(pref_hits)}")
        rationale.append(f"Занятость: {', '.join(pref_hits)}")

    # --- Experience / seniority (0–12) ---
    exp_pts = 0
    if vac_seniority and resume_seniority:
        if vac_seniority == resume_seniority:
            exp_pts += 6
            matched.append(f"Seniority: {resume_seniority}")
        elif {vac_seniority, resume_seniority} <= {"middle", "senior"}:
            exp_pts += 3
            matched.append(f"Seniority близко: resume={resume_seniority}, vacancy={vac_seniority}")
        else:
            missing.append(f"Seniority: нужно {vac_seniority}, в RAG {resume_seniority}")
    elif vac_profile.get("experience_raw"):
        rationale.append(f"Требуемый опыт: {vac_profile['experience_raw']}")
    if vac_exp_years is not None and resume_exp_years:
        best = max(resume_exp_years)
        if best + 0.5 >= vac_exp_years:
            exp_pts += 6
            matched.append(f"Опыт: ~{best:g}+ лет (нужно {vac_exp_years:g})")
        else:
            missing.append(f"Опыт: в RAG ~{best:g} лет, нужно {vac_exp_years:g}+")
    score += min(12, exp_pts)
    if exp_pts:
        rationale.append(f"Опыт/seniority +{min(12, exp_pts)}")

    score = max(0, min(100, int(score)))
    if not rationale:
        rationale.append("Оценка по пересечению compact profile и вакансии")

    return {
        "score": score,
        "rationale": rationale[:10],
        "matched": matched[:12],
        "missing": missing[:12],
        "vacancyProfile": vac_profile,
        "matchedSkills": skill_hits[:12],
        "matchedTools": tool_hits[:12],
        "missingSkills": skill_miss[:12],
        "missingTools": tool_miss[:12],
        "compactProfile": {
            "sourceCount": int(profile.get("source_count") or 0),
            "skills": list(profile.get("skills") or [])[:16],
            "tools": list(profile.get("tools") or [])[:16],
            "roles": list(profile.get("roles") or [])[:8],
        },
    }


def parse_drive_folder_id(folder_url_or_id: str) -> str:
    raw = (folder_url_or_id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="folderUrlOrId is required")
    if re.fullmatch(r"[a-zA-Z0-9_-]{10,}", raw) and "://" not in raw:
        return raw
    parsed = urlparse(raw)
    if "drive.google.com" in (parsed.netloc or ""):
        m = re.search(r"/folders/([a-zA-Z0-9_-]+)", parsed.path or "")
        if m:
            return m.group(1)
        qs = parse_qs(parsed.query or "")
        if qs.get("id"):
            return qs["id"][0]
    raise HTTPException(
        status_code=400,
        detail="Не удалось извлечь folder id. Вставьте URL вида https://drive.google.com/drive/folders/FOLDER_ID",
    )


def build_resume_search_query(vacancy: JobResponderVacancyPayload) -> str:
    parts = [vacancy.title.strip()]
    if vacancy.company:
        parts.append(vacancy.company.strip())
    st = vacancy.structured
    if st:
        if st.keySkills:
            parts.append(" ".join(st.keySkills[:20]))
        if st.workFormat:
            parts.append(st.workFormat)
        if st.experience:
            parts.append(st.experience)
    desc = re.sub(r"\s+", " ", vacancy.description or "").strip()
    if desc:
        parts.append(desc[:1200])
    return " | ".join(p for p in parts if p)


CONTACTS_LINKS_RULE = (
    "Всегда включай в текст отклика / ответов контакты и релевантные ссылки "
    "из профиля / RESUME CONTEXT / File Search (email, Telegram, телефон, портфолио, "
    "GitHub, LinkedIn, сайт и др.), если они есть. Не выдумывай контакты и URL."
)


def resolve_prompt_extra(prompt_extra: Optional[str], custom_instructions: Optional[str], *, max_chars: int = 4000) -> str:
    raw = (prompt_extra or custom_instructions or "").strip()
    if not raw:
        return ""
    return raw[: max(200, int(max_chars))]


def normalize_profile_overrides(raw: Optional[Any]) -> Dict[str, str]:
    """Normalize client profileOverrides into a flat key->value map."""
    if not raw:
        return {}
    out: Dict[str, str] = {}
    if isinstance(raw, str):
        for chunk in re.split(r"[|\n]+", raw):
            m = re.match(r"^\s*([^:]{1,40})\s*:\s*(.+?)\s*$", chunk)
            if not m:
                continue
            key = m.group(1).strip().lower()
            val = m.group(2).strip()
            if key and val and len(key) <= 32 and len(val) <= 500:
                out[key] = val
        return out
    if isinstance(raw, dict):
        for k, v in raw.items():
            key = str(k or "").strip().lower()
            if not key or key.startswith("_"):
                continue
            if isinstance(v, (list, tuple)):
                val = ", ".join(str(x).strip() for x in v if str(x).strip())
            else:
                val = str(v or "").strip()
            if key and val and len(key) <= 40 and len(val) <= 500:
                out[key[:40]] = val[:500]
        return out
    return {}


def format_profile_overrides_block(overrides: Dict[str, str]) -> str:
    if not overrides:
        return ""
    lines = [f"{k}: {v}" for k, v in overrides.items()]
    return (
        "Use these contact/profile overrides instead of conflicting RAG data:\n"
        + "\n".join(lines)
    )


_TG_OVERRIDE_KEYS = ("telegram", "tg", "телеграм", "тг")
_EMAIL_OVERRIDE_KEYS = ("email", "e-mail", "mail", "почта")
_PHONE_OVERRIDE_KEYS = ("phone", "tel", "телефон", "мобильный")
_LINK_OVERRIDE_KEYS = (
    "ссылка",
    "link",
    "url",
    "portfolio",
    "портфолио",
    "github",
    "linkedin",
    "сайт",
    "website",
    "site",
)


def apply_profile_overrides(merged: Dict[str, Any], overrides: Dict[str, str]) -> Dict[str, Any]:
    """Merge contact/profile overrides into compact profile (overrides win)."""
    if not overrides:
        return merged
    profile = dict(merged or {})
    contacts: List[str] = list(profile.get("contact_overrides") or [])
    links: List[Dict[str, str]] = [
        dict(lk) for lk in (profile.get("links") or []) if isinstance(lk, dict)
    ]

    def _upsert_link(url: str, title: str) -> None:
        url_l = url.lower().rstrip("/")
        for lk in links:
            existing = str(lk.get("url") or "").lower().rstrip("/")
            title_l = str(lk.get("title") or "").lower()
            if existing == url_l or (title and title.lower() in title_l):
                lk["url"] = url[:400]
                if title:
                    lk["title"] = title[:120]
                return
        # Also replace by channel name in title/url for telegram/email
        links.insert(0, {"url": url[:400], "title": title[:120], "summary": "profile override"})

    for key, val in overrides.items():
        contacts.append(f"{key}: {val}")
        if key in _TG_OVERRIDE_KEYS:
            handle = val if val.startswith("@") or val.startswith("http") else f"@{val.lstrip('@')}"
            url = handle if handle.startswith("http") else f"https://t.me/{handle.lstrip('@')}"
            # Drop conflicting telegram links from RAG
            links = [
                lk
                for lk in links
                if "t.me/" not in str(lk.get("url") or "").lower()
                and "telegram" not in str(lk.get("title") or "").lower()
            ]
            _upsert_link(url, "Telegram")
            profile["telegram"] = handle
        elif key in _EMAIL_OVERRIDE_KEYS:
            email = val.replace("mailto:", "").strip()
            links = [
                lk
                for lk in links
                if "mailto:" not in str(lk.get("url") or "").lower()
                and "@" not in str(lk.get("url") or "")
            ]
            _upsert_link(f"mailto:{email}", "email")
            profile["email"] = email
        elif key in _PHONE_OVERRIDE_KEYS:
            profile["phone"] = val
        elif key in _LINK_OVERRIDE_KEYS or val.startswith("http://") or val.startswith("https://"):
            title = key if key not in _LINK_OVERRIDE_KEYS else key
            if val.startswith("http://") or val.startswith("https://"):
                _upsert_link(val, title)
            else:
                contacts.append(f"{key}: {val}")

    profile["contact_overrides"] = list(dict.fromkeys(contacts))[:24]
    profile["links"] = links[:14]
    return profile


def inject_overrides_into_prompt_extra(prompt_extra: str, overrides: Dict[str, str]) -> str:
    block = format_profile_overrides_block(overrides)
    if not block:
        return prompt_extra
    extra = (prompt_extra or "").strip()
    if block in extra:
        return extra
    if extra:
        return f"{extra}\n\n{block}"
    return block


def build_system_prompt(
    mode: str,
    *,
    has_cover_template: bool = False,
    prompt_extra: str = "",
) -> str:
    base = f"""Ты помощник кандидата при отклике на вакансии.

Правила:
- Пиши от первого лица кандидата.
- Используй ТОЛЬКО факты из блока RESUME CONTEXT (или File Search документов). Если факта нет - не выдумывай.
- Без AI-slop: без "страстно увлечен", "синергия", "динамичная команда", "уникальная возможность".
- Формат HH: короткое тире "-", стрелки "->", кавычки ASCII ".
- Язык: русский (если вакансия явно на другом языке - можно на языке вакансии).
- Не используй markdown-заголовки и списки с буллетами - plain text для поля HH.
- Учитывай STRUCTURED VACANCY (формат, занятость, навыки) если они есть.
- {CONTACTS_LINKS_RULE}
"""
    extra = (prompt_extra or "").strip()
    if extra:
        base += f"\nДОП. ИНСТРУКЦИЯ ОТ КАНДИДАТА:\n{extra}\n"

    if mode == "question_answers":
        return (
            base
            + """
Режим: ответы на вопросы работодателя / Google Form / таблица Q&A.
Верни ТОЛЬКО валидный JSON-массив:
[{"question":"...","answer":"..."}]
По одному объекту на каждый вопрос из списка QUESTIONS.
Поле "question" ОБЯЗАТЕЛЬНО: скопируй текст вопроса из QUESTIONS ДОСЛОВНО (не оставляй пустым).
Если у вопроса есть options - выбери подходящий вариант или кратко обоснуй выбор.
Ответы 1-4 предложения, конкретно по RESUME CONTEXT.
В ответах при уместности укажи контакты / ссылки из профиля."""
        )
    if has_cover_template:
        return (
            base
            + """
Режим: адаптация сопроводительного письма под вакансию.
Дан блок COVER TEMPLATE - это письмо кандидата. НЕ пиши письмо с нуля.
Задача: адаптировать шаблон под конкретную вакансию и unified compact profile:
- сохрани голос, тон и структуру автора;
- подставь/уточни факты под требования вакансии (только из RESUME CONTEXT);
- убери нерелевантное, усили совпадения с вакансией;
- добавь контакты и релевантные ссылки из профиля, если их ещё нет в шаблоне;
- длина ориентировочно как у шаблона (или 800-1400 символов).
Верни ТОЛЬКО текст письма, без пояснений."""
        )
    return (
        base
        + """
Режим: сопроводительное письмо (cover letter).
Длина: 800-1400 символов.
Структура: приветствие -> 1-2 релевантных кейса под требования -> стек/формат -> контакты/ссылки (если есть в профиле) -> CTA -> имя (если есть в RESUME CONTEXT).
Верни ТОЛЬКО текст письма, без пояснений."""
    )


def build_user_prompt(
    vacancy: JobResponderVacancyPayload,
    compact_profile_text: str,
    mode: str,
    host: str,
    questions: Optional[List[Any]] = None,
    cover_template: str = "",
    prompt_extra: str = "",
) -> str:
    host_label = HOST_LABELS.get(host, host or "web")
    resume_context = (compact_profile_text or "").strip() or "(empty - do not invent facts)"

    structured = vacancy.structured.model_dump(exclude_none=True) if vacancy.structured else None
    vacancy_block = json.dumps(
        {
            "host": host_label,
            "url": vacancy.url,
            "title": vacancy.title,
            "company": vacancy.company,
            "source": vacancy.source,
            "description": vacancy.description[:GENERATE_VACANCY_CHARS],
            "structured": structured,
        },
        ensure_ascii=False,
        indent=2,
    )

    parts = [
        f"SITE: {host_label}",
        f"VACANCY:\n{vacancy_block}",
        f"RESUME CONTEXT:\n{resume_context}",
    ]
    if mode == "cover_letter" and cover_template:
        parts.append(f"COVER TEMPLATE (adapt, do not rewrite from scratch):\n{cover_template}")
    if mode == "question_answers":
        qlist = normalize_questions(questions if questions is not None else vacancy.questions)
        parts.append("QUESTIONS:\n" + json.dumps(qlist, ensure_ascii=False, indent=2))
    extra = (prompt_extra or "").strip()
    if extra:
        parts.append(f"CUSTOM INSTRUCTIONS:\n{extra}")
    return "\n\n".join(parts)


def register_job_responder_routes(app, deps: Dict[str, Any]) -> None:
    import job_responder_gemini_rag as jr_gemini_rag

    jr_gemini_rag.ensure_schema(deps["pg_connect"])

    verify_bookmarks_access = deps["verify_bookmarks_access"]
    verify_workspace_membership = deps["verify_workspace_membership"]
    pg_connect = deps["pg_connect"]
    extract_text_from_bytes = deps["extract_text_from_bytes"]
    get_openai_embedding = deps["get_openai_embedding"]
    build_vector_literal = deps["build_vector_literal"]
    bookmarks_vector_dim = deps["bookmarks_vector_dim"]
    has_any_bookmark_llm_keys = deps["has_any_bookmark_llm_keys"]
    openai_chat_completions_generic = deps["openai_chat_completions_generic"]
    build_knowledge_content_hash = deps["build_knowledge_content_hash"]
    resolve_knowledge_obsidian_note_path = deps["resolve_knowledge_obsidian_note_path"]
    normalize_kind = deps["normalize_kind"]
    truncate_text = deps["truncate_text"]
    normalize_url = deps["normalize_url"]
    psycopg2 = deps["psycopg2"]
    fetch_content_via_jina = deps["fetch_content_via_jina"]

    def _parse_workspace_id(raw: str) -> int:
        try:
            return int(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="workspaceId must be numeric") from exc

    def _auth(request: Request, x_api_key: Optional[str], authorization: Optional[str]) -> Dict[str, Any]:
        return resolve_job_responder_auth(request, x_api_key, authorization, verify_bookmarks_access)

    def _guard_workspace(auth_ctx: Dict[str, Any], workspace_id: int) -> None:
        if JOB_RESPONDER_TEST_MODE or auth_ctx.get("auth_mode") == "dev_bypass":
            return
        verify_workspace_membership(auth_ctx, workspace_id)

    def _resume_kind_norm(kind: str) -> str:
        raw = str(kind or PRIMARY_CV_KIND).strip().lower()
        if raw in RESUME_KINDS:
            return raw
        return normalize_kind(raw, default=PRIMARY_CV_KIND)

    def _extract_text_with_vision(
        safe_name: str,
        raw: bytes,
        mime_type: str,
        *,
        allow_vision: bool,
        category_hint: str,
    ) -> Tuple[str, Dict[str, Any], str]:
        """Returns (text, meta, category_norm_override_or_empty)."""
        extracted_text, meta = extract_text_from_bytes(safe_name, raw, mime_type)
        extracted_text = (extracted_text or "").strip()
        category_override = ""

        if meta.get("needsVision"):
            if not allow_vision:
                meta["visionDeferred"] = True
                return extracted_text, meta, category_override
            try:
                from hermes_media import vision_analyze_from_settings
            except Exception as exc:  # pragma: no cover
                meta["vision"] = {"ok": False, "error": str(exc)}
                return extracted_text, meta, category_override

            b64 = base64.b64encode(raw).decode("ascii")
            try:
                vision = call_with_timeout(
                    vision_analyze_from_settings,
                    10.0,
                    "Извлеки весь читаемый текст со скриншота/изображения портфолио для Resume RAG. "
                    "Верни только текст (заголовки, описания проектов, стек). Без комментариев.",
                    image_base64=b64,
                )
            except (FuturesTimeout, Exception) as exc:
                meta["vision"] = {"ok": False, "error": f"timeout:{exc}"}
                meta["visionDeferred"] = True
                return extracted_text, meta, category_override
            meta["vision"] = {"ok": bool(vision.get("ok")), "error": vision.get("error")}
            if not vision.get("ok"):
                meta["visionDeferred"] = True
                return extracted_text, meta, category_override
            extracted_text = str(vision.get("text") or vision.get("content") or "").strip()
            meta["method"] = "vision"
            if category_hint in ("experience", "portfolio", "drive", "cv", ""):
                category_override = "screenshot"

        return extracted_text, meta, category_override

    def _resume_search_rows(cur, workspace_id: int, query: str, limit: int) -> Tuple[str, List[Dict[str, Any]]]:
        emb = None
        try:
            emb = call_with_timeout(get_openai_embedding, EMBED_REQUEST_TIMEOUT_SEC, query)
        except (FuturesTimeout, Exception):
            emb = None
        if emb and len(emb) == bookmarks_vector_dim:
            vec = build_vector_literal(emb)
            cur.execute(
                """
                select
                  k.id,
                  k.source,
                  k.title,
                  k.url,
                  k.ai_summary,
                  k.category,
                  k.tags,
                  k.status,
                  k.note_path,
                  k.kind,
                  k.content_text,
                  (v.embedding <-> %s::vector) as distance
                from public.knowledge_items k
                join public.knowledge_vectors v on v.knowledge_item_id = k.id
                where k.workspace_id = %s
                  and k.source = %s
                  and k.kind = any(%s)
                order by v.embedding <-> %s::vector asc
                limit %s
                """,
                (vec, workspace_id, RESUME_SOURCE, list(RESUME_KINDS), vec, limit),
            )
            rows = cur.fetchall()
            if rows:
                return "semantic", rows

        like = f"%{query.strip().lower()}%"
        cur.execute(
            """
            select
              k.id,
              k.source,
              k.title,
              k.url,
              k.ai_summary,
              k.category,
              k.tags,
              k.status,
              k.note_path,
              k.kind,
              k.content_text,
              null::float8 as distance
            from public.knowledge_items k
            where k.workspace_id = %s
              and k.source = %s
              and k.kind = any(%s)
              and (
                lower(coalesce(k.title, '')) like %s
                or lower(coalesce(k.content_text, '')) like %s
                or lower(coalesce(k.ai_summary, '')) like %s
              )
            order by k.updated_at desc
            limit %s
            """,
            (workspace_id, RESUME_SOURCE, list(RESUME_KINDS), like, like, like, limit),
        )
        return "keyword", cur.fetchall()

    def _resume_selected_rows(cur, workspace_id: int, selected_ids: List[int]) -> List[Dict[str, Any]]:
        ids = [int(x) for x in selected_ids if int(x) > 0]
        if not ids:
            return []
        cur.execute(
            """
            select
              k.id,
              k.source,
              k.title,
              k.url,
              k.ai_summary,
              k.category,
              k.tags,
              k.status,
              k.note_path,
              k.kind,
              k.content_text,
              null::float8 as distance,
              k.updated_at
            from public.knowledge_items k
            where k.workspace_id = %s
              and k.source = %s
              and k.kind = any(%s)
              and k.id = any(%s)
            order by
              case when k.kind = %s then 0 else 1 end,
              k.updated_at desc
            limit %s
            """,
            (
                workspace_id,
                RESUME_SOURCE,
                list(RESUME_KINDS),
                ids,
                PRIMARY_CV_KIND,
                SELECTED_SOURCES_MAX,
            ),
        )
        return cur.fetchall()

    def _resume_workspace_rows(cur, workspace_id: int, limit: int = SELECTED_SOURCES_MAX) -> List[Dict[str, Any]]:
        cur.execute(
            """
            select
              k.id,
              k.source,
              k.title,
              k.url,
              k.ai_summary,
              k.category,
              k.tags,
              k.status,
              k.note_path,
              k.kind,
              k.content_text,
              null::float8 as distance,
              k.updated_at
            from public.knowledge_items k
            where k.workspace_id = %s
              and k.source = %s
              and k.kind = any(%s)
            order by
              case when k.kind = %s then 0 else 1 end,
              k.updated_at desc
            limit %s
            """,
            (workspace_id, RESUME_SOURCE, list(RESUME_KINDS), PRIMARY_CV_KIND, max(1, int(limit))),
        )
        return cur.fetchall()

    def _embed_resume_item(cur, kid: int, title: str, ai_summary: str, text: str) -> bool:
        if kid <= 0:
            return False
        embed_source = "\n".join(p for p in (title, ai_summary, text[:3500]) if p)[:8000]
        try:
            vec = call_with_timeout(get_openai_embedding, EMBED_REQUEST_TIMEOUT_SEC, embed_source)
        except (FuturesTimeout, Exception):
            _LOG.warning("embed skipped/timeout kid=%s", kid)
            return False
        if not vec or len(vec) != bookmarks_vector_dim:
            return False
        cur.execute(
            """
            insert into public.knowledge_vectors (knowledge_item_id, embedding, embedding_model, embedded_at, updated_at)
            values (%s, %s::vector, %s, now(), now())
            on conflict (knowledge_item_id)
            do update set
              embedding = excluded.embedding,
              embedding_model = excluded.embedding_model,
              embedded_at = now(),
              updated_at = now()
            """,
            (kid, build_vector_literal(vec), "job-responder-embed"),
        )
        return True

    def _find_near_duplicate_id(cur, workspace_id: int, text: str) -> Optional[int]:
        target = near_duplicate_hash(text)
        if not target:
            return None
        cur.execute(
            """
            select id, content_text
            from public.knowledge_items
            where workspace_id = %s and source = %s
            order by updated_at desc
            limit 80
            """,
            (workspace_id, RESUME_SOURCE),
        )
        for row in cur.fetchall() or []:
            body = str(row.get("content_text") or "")
            if near_duplicate_hash(body) == target:
                return int(row["id"]) if row.get("id") is not None else None
        return None

    def _upsert_resume_item_text(
        cur,
        workspace_id: int,
        *,
        title: str,
        text: str,
        kind_norm: str,
        category: str,
        url: Optional[str],
        extra_tags: Optional[List[str]] = None,
        embed: bool = False,
        link_preview: Optional[Dict[str, str]] = None,
    ) -> Tuple[int, bool, str, Dict[str, Any]]:
        title = sanitize_extracted_text(title or "")
        text = sanitize_extracted_text(text or "")
        profile = extract_resume_profile(text, title=title, category=category)
        if link_preview:
            prev_url = str(link_preview.get("url") or url or "")
            prev_title = str(link_preview.get("title") or "")[:180]
            prev_sum = str(link_preview.get("summary") or "")[:400]
            links = list(profile.get("links") or [])
            replaced = False
            for item in links:
                if isinstance(item, dict) and str(item.get("url") or "") == prev_url:
                    if prev_title:
                        item["title"] = prev_title
                    if prev_sum:
                        item["summary"] = prev_sum
                    replaced = True
            if not replaced and prev_url:
                links.insert(0, {"url": prev_url, "title": prev_title, "summary": prev_sum})
            profile["links"] = links[:12]
            if prev_title and (not title or title.startswith("http")):
                title = truncate_text(prev_title, 1000)
            if prev_sum and len(text) < 80:
                text = f"{prev_title}\n{prev_url}\n{prev_sum}".strip()
        content_text, ai_summary = wrap_content_with_profile(text, profile)
        tags = profile_tags(profile, [category, *(extra_tags or [])])

        canonical_url = normalize_url(url) if url else ""
        content_hash = build_knowledge_content_hash(RESUME_SOURCE, canonical_url, content_text)
        note_path = truncate_text(
            resolve_knowledge_obsidian_note_path(
                workspace_id,
                content_hash,
                None,
                kind=kind_norm,
            ),
            4000,
        )

        merge_id = None
        merge_reason = ""
        if canonical_url or url:
            merge_id = _find_resume_item_by_url(cur, workspace_id, canonical_url or url or "")
            if merge_id:
                merge_reason = "url"
        if merge_id is None:
            merge_id = _find_near_duplicate_id(cur, workspace_id, text)
            if merge_id:
                merge_reason = "text"

        if merge_id:
            if "merged" not in tags:
                tags.append("merged")
            cur.execute(
                """
                update public.knowledge_items set
                  updated_at = now(),
                  last_seen_at = now(),
                  seen_count = coalesce(seen_count, 0) + 1,
                  title = case
                    when %s <> '' and (title is null or title = '' or title like 'http%%')
                    then %s else title end,
                  url = coalesce(%s, url),
                  canonical_url = coalesce(%s, canonical_url),
                  content_text = case
                    when length(%s) > length(coalesce(content_text, '')) then %s
                    else content_text end,
                  ai_summary = coalesce(%s, ai_summary),
                  category = %s,
                  tags = %s,
                  kind = %s
                where id = %s and workspace_id = %s and source = %s
                returning id
                """,
                (
                    title,
                    title,
                    url or None,
                    canonical_url or None,
                    content_text,
                    content_text,
                    ai_summary,
                    category,
                    psycopg2.extras.Json(tags),
                    kind_norm,
                    merge_id,
                    workspace_id,
                    RESUME_SOURCE,
                ),
            )
            row = cur.fetchone() or {}
            kid = int(row["id"]) if row.get("id") is not None else merge_id
            profile["_ingest"] = {"merged": True, "reason": merge_reason}
        else:
            cur.execute(
                """
                insert into public.knowledge_items (
                  workspace_id, source, title, url, canonical_url,
                  content_text, ai_summary, category, tags, content_hash, status, note_path, kind
                ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'to_process', %s, %s)
                on conflict (workspace_id, content_hash)
                do update set
                  updated_at = now(),
                  last_seen_at = now(),
                  seen_count = public.knowledge_items.seen_count + 1,
                  title = excluded.title,
                  url = excluded.url,
                  canonical_url = excluded.canonical_url,
                  content_text = case
                    when length(coalesce(excluded.content_text, '')) > length(coalesce(public.knowledge_items.content_text, ''))
                    then excluded.content_text
                    else public.knowledge_items.content_text
                  end,
                  ai_summary = coalesce(excluded.ai_summary, public.knowledge_items.ai_summary),
                  category = excluded.category,
                  tags = excluded.tags,
                  note_path = coalesce(excluded.note_path, public.knowledge_items.note_path),
                  kind = excluded.kind
                returning id
                """,
                (
                    workspace_id,
                    RESUME_SOURCE,
                    title,
                    url or None,
                    canonical_url or None,
                    content_text,
                    ai_summary,
                    category,
                    psycopg2.extras.Json(tags),
                    content_hash,
                    note_path,
                    kind_norm,
                ),
            )
            row = cur.fetchone() or {}
            kid = int(row["id"]) if row.get("id") is not None else -1
            profile["_ingest"] = {"merged": False, "reason": ""}

        embedded = False
        if embed:
            embedded = _embed_resume_item(cur, kid, title, ai_summary, text)
        return kid, embedded, content_hash, profile

    def _find_resume_item_by_url(cur, workspace_id: int, url: str) -> Optional[int]:
        canonical = normalize_url(url) if url else ""
        if not canonical:
            return None
        cur.execute(
            """
            select id
            from public.knowledge_items
            where workspace_id = %s
              and source = %s
              and (
                canonical_url = %s
                or url = %s
                or canonical_url = %s
                or url = %s
              )
            order by updated_at desc
            limit 1
            """,
            (workspace_id, RESUME_SOURCE, canonical, canonical, url, url),
        )
        row = cur.fetchone()
        if not row or row.get("id") is None:
            return None
        return int(row["id"])

    def _index_extracted_links(
        cur,
        workspace_id: int,
        text: str,
        *,
        parent_title: str = "",
        parent_id: Optional[int] = None,
        max_links: int = LINK_PREVIEW_MAX,
        fetch_preview: bool = True,
    ) -> List[Dict[str, Any]]:
        """Extract http(s) URLs and upsert link sources with title+short summary.

        Never uses Jina on this path. Preview fetch is capped (5s/link, max N).
        """
        urls = extract_urls_from_text(text, limit=max_links)
        linked: List[Dict[str, Any]] = []
        for idx, url in enumerate(urls):
            existing = _find_resume_item_by_url(cur, workspace_id, url)
            preview = {"url": url, "title": "", "summary": ""}
            if fetch_preview and idx < LINK_PREVIEW_MAX:
                preview = fetch_link_preview(url, timeout_sec=LINK_PREVIEW_TIMEOUT_SEC)

            title_guess = preview.get("title") or url
            desc = preview.get("summary") or ""
            parent_bit = f" (from {parent_title})" if parent_title else ""
            if desc:
                link_text = (
                    f"{title_guess}\nURL: {url}\n{desc}\n"
                    f"Extracted from Job Responder source{parent_bit}."
                )
            else:
                link_text = (
                    f"Link extracted from Job Responder source{parent_bit}.\n"
                    f"URL: {url}\n"
                    f"Файл/контекст: {parent_title or 'source'}."
                )

            extra = ["link", "extracted-url"]
            if existing is not None:
                extra.append("merged")
            kid, embedded, content_hash, profile = _upsert_resume_item_text(
                cur,
                workspace_id,
                title=truncate_text(title_guess, 1000),
                text=link_text,
                kind_norm="job_experience",
                category="link",
                url=normalize_url(url) or url,
                extra_tags=extra,
                embed=False,
                link_preview=preview,
            )
            ingest_meta = profile.pop("_ingest", {}) if isinstance(profile, dict) else {}
            linked.append(
                {
                    "knowledgeItemId": kid,
                    "url": url,
                    "deduped": bool(existing is not None or ingest_meta.get("merged")),
                    "merged": bool(ingest_meta.get("merged")),
                    "embedded": embedded,
                    "contentHash": content_hash,
                    "title": title_guess,
                    "description": desc[:280],
                    "profile": profile,
                }
            )
        return linked

    def _queue_extracted_link_index(
        background_tasks: Optional[BackgroundTasks],
        workspace_id: int,
        text: str,
        *,
        parent_title: str = "",
        parent_id: Optional[int] = None,
        raw_bytes: int = 0,
    ) -> None:
        """Best-effort: index URLs after the HTTP response. Skip on large PDFs."""
        if background_tasks is None:
            return
        if raw_bytes > 2 * 1024 * 1024:
            return
        urls = extract_urls_from_text(text, limit=LINK_PREVIEW_MAX)
        if not urls:
            return
        snapshot = text

        def _job() -> None:
            conn = pg_connect()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    _index_extracted_links(
                        cur,
                        workspace_id,
                        snapshot,
                        parent_title=parent_title,
                        parent_id=parent_id,
                        max_links=LINK_PREVIEW_MAX,
                        fetch_preview=True,
                    )
                conn.commit()
            except Exception:
                _LOG.exception("async link index failed parent_id=%s", parent_id)
                try:
                    conn.rollback()
                except Exception:
                    pass
            finally:
                conn.close()

        background_tasks.add_task(_job)

    def _queue_gemini_rag_sync(
        background_tasks: Optional[BackgroundTasks],
        workspace_id: int,
        knowledge_item_id: int,
    ) -> None:
        if background_tasks is None or knowledge_item_id <= 0 or not jr_gemini_rag.is_enabled():
            return

        def _job() -> None:
            try:
                res = jr_gemini_rag.sync_knowledge_item(
                    pg_connect,
                    workspace_id,
                    knowledge_item_id,
                    poll=False,
                )
                if not res.get("ok") and not res.get("skipped"):
                    _LOG.warning(
                        "gemini rag sync failed ws=%s kid=%s err=%s",
                        workspace_id,
                        knowledge_item_id,
                        res.get("error"),
                    )
            except Exception:
                _LOG.exception("gemini rag sync job failed kid=%s", knowledge_item_id)

        background_tasks.add_task(_job)

    def _queue_embed(
        background_tasks: Optional[BackgroundTasks],
        kid: int,
        title: str,
        text: str,
        ai_summary: str = "",
    ) -> None:
        if background_tasks is None or kid <= 0:
            return

        def _job() -> None:
            conn = pg_connect()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    _embed_resume_item(cur, kid, title, ai_summary, text)
                conn.commit()
            except Exception:
                _LOG.exception("async embed failed kid=%s", kid)
                try:
                    conn.rollback()
                except Exception:
                    pass
            finally:
                conn.close()

        background_tasks.add_task(_job)

    def _delete_resume_sources(
        cur,
        workspace_id: int,
        *,
        knowledge_item_ids: Optional[List[int]] = None,
        titles: Optional[List[str]] = None,
    ) -> List[int]:
        ids = [int(x) for x in (knowledge_item_ids or []) if int(x) > 0]
        title_list = [str(t).strip() for t in (titles or []) if str(t).strip()]
        if not ids and not title_list:
            return []
        if title_list:
            cur.execute(
                """
                select id
                from public.knowledge_items
                where workspace_id = %s
                  and source = %s
                  and lower(title) = any(%s)
                """,
                (workspace_id, RESUME_SOURCE, [t.lower() for t in title_list]),
            )
            ids.extend(int(r["id"]) for r in cur.fetchall() if r.get("id") is not None)
        uniq = sorted(set(ids))
        if not uniq:
            return []
        cur.execute(
            """
            delete from public.knowledge_items
            where workspace_id = %s
              and source = %s
              and id = any(%s)
            returning id
            """,
            (workspace_id, RESUME_SOURCE, uniq),
        )
        return [int(r["id"]) for r in cur.fetchall() if r.get("id") is not None]

    @app.get("/api/v1/job-responder/resume/status")
    async def job_responder_resume_status(
        workspaceId: str,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    select
                      count(*)::int as total,
                      count(*) filter (where kind = %s)::int as primary_cv_count,
                      max(updated_at) as last_updated
                    from public.knowledge_items
                    where workspace_id = %s and source = %s and kind = any(%s)
                    """,
                    (PRIMARY_CV_KIND, workspace_id, RESUME_SOURCE, list(RESUME_KINDS)),
                )
                row = cur.fetchone() or {}
            return {
                "workspaceId": str(workspace_id),
                "defaultTestWorkspaceId": str(DEFAULT_TEST_WORKSPACE_ID),
                "testMode": JOB_RESPONDER_TEST_MODE,
                "count": int(row.get("total") or 0),
                "primaryCvCount": int(row.get("primary_cv_count") or 0),
                "hasPrimaryCv": int(row.get("primary_cv_count") or 0) > 0,
                "lastUpdated": row.get("last_updated").isoformat() if row.get("last_updated") else None,
            }
        finally:
            conn.close()

    @app.get("/api/v1/job-responder/resume/sources")
    async def job_responder_resume_sources(
        workspaceId: str,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    select
                      id,
                      title,
                      url,
                      kind,
                      category,
                      tags,
                      updated_at,
                      coalesce(seen_count, 1)::int as seen_count,
                      left(coalesce(ai_summary, ''), 220) as preview,
                      left(coalesce(content_text, ''), 16000) as content_snippet
                    from public.knowledge_items
                    where workspace_id = %s
                      and source = %s
                      and kind = any(%s)
                    order by
                      case when kind = %s then 0 else 1 end,
                      updated_at desc
                    limit 200
                    """,
                    (workspace_id, RESUME_SOURCE, list(RESUME_KINDS), PRIMARY_CV_KIND),
                )
                rows = cur.fetchall()
            return {
                "workspaceId": str(workspace_id),
                "defaultTestWorkspaceId": str(DEFAULT_TEST_WORKSPACE_ID),
                "count": len(rows),
                "items": [
                    {
                        "knowledgeItemId": int(r["id"]),
                        "title": (r.get("title") or "").strip() or f"Источник #{int(r['id'])}",
                        "name": (r.get("title") or "").strip() or f"Источник #{int(r['id'])}",
                        "url": r.get("url"),
                        "kind": r.get("kind"),
                        "category": r.get("category"),
                        "tags": r.get("tags") or [],
                        "preview": r.get("preview"),
                        "contentText": strip_profile_wrapper(str(r.get("content_snippet") or ""))[:12000],
                        "contentPreview": strip_profile_wrapper(str(r.get("content_snippet") or ""))[:12000],
                        "description": r.get("preview") if str(r.get("category") or "") == "link" else "",
                        "merged": int(r.get("seen_count") or 1) > 1
                        or (
                            "merged"
                            in (
                                r.get("tags")
                                if isinstance(r.get("tags"), list)
                                else []
                            )
                        ),
                        "seenCount": int(r.get("seen_count") or 1),
                        "updatedAt": r.get("updated_at").isoformat() if r.get("updated_at") else None,
                    }
                    for r in rows
                ],
            }
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/sources/delete")
    async def job_responder_resume_sources_delete(
        payload: JobResponderDeleteSourcesPayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)
        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                deleted = _delete_resume_sources(
                    cur,
                    workspace_id,
                    knowledge_item_ids=payload.knowledgeItemIds,
                    titles=payload.titles,
                )
            conn.commit()
            return {
                "ok": True,
                "deletedIds": deleted,
                "deletedCount": len(deleted),
                "workspaceId": str(workspace_id),
            }
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.delete("/api/v1/job-responder/resume/sources/{knowledge_item_id}")
    async def job_responder_resume_source_delete_one(
        knowledge_item_id: int,
        workspaceId: str,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(workspaceId)
        _guard_workspace(auth_ctx, workspace_id)
        if knowledge_item_id <= 0:
            raise HTTPException(status_code=400, detail="knowledge_item_id must be positive")
        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                deleted = _delete_resume_sources(
                    cur,
                    workspace_id,
                    knowledge_item_ids=[knowledge_item_id],
                )
            conn.commit()
            if not deleted:
                raise HTTPException(status_code=404, detail="source_not_found")
            return {
                "ok": True,
                "deletedIds": deleted,
                "deletedCount": len(deleted),
                "workspaceId": str(workspace_id),
            }
        except HTTPException:
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/capture")
    async def job_responder_resume_capture(
        payload: JobResponderResumeCapturePayload,
        request: Request,
        background_tasks: BackgroundTasks,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                kind_norm = _resume_kind_norm(payload.kind)
                category = truncate_text(str(payload.category or "cv").strip().lower(), 128) or "cv"
                title = truncate_text(payload.title.strip(), 1000)
                text = str(payload.text or "").strip()
                kid, embedded, _content_hash, profile = _upsert_resume_item_text(
                    cur,
                    workspace_id,
                    title=title,
                    text=text,
                    kind_norm=kind_norm,
                    category=category,
                    url=None,
                    embed=False,
                )
            conn.commit()
            ingest_meta = (profile or {}).pop("_ingest", {}) if isinstance(profile, dict) else {}
            _queue_embed(background_tasks, kid, title, text, str((profile or {}).get("ai_summary") or ""))
            _queue_gemini_rag_sync(background_tasks, workspace_id, kid)
            _queue_extracted_link_index(
                background_tasks,
                workspace_id,
                text,
                parent_title=title,
                parent_id=kid if kid != -1 else None,
            )
            return {
                "ok": True,
                "knowledgeItemId": kid,
                "kind": kind_norm,
                "category": category,
                "embedded": embedded,
                "contentHash": _content_hash,
                "profile": profile,
                "linkedSources": [],
                "linkIndexQueued": True,
                "merged": bool(ingest_meta.get("merged")),
                "workspaceId": str(workspace_id),
            }
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/text-capture")
    async def job_responder_resume_text_capture(
        payload: JobResponderTextCapturePayload,
        request: Request,
        background_tasks: BackgroundTasks,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        """Ingest free-form pasted text into Resume RAG (source=job_responder)."""
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        text = str(payload.text or "").strip()
        if len(text) < 20:
            raise HTTPException(status_code=422, detail="text too short (min 20 chars)")

        kind_norm = _resume_kind_norm(payload.kind)
        category = truncate_text(str(payload.category or "notes").strip().lower(), 128) or "notes"
        title = truncate_text(
            (payload.title or "").strip() or f"Notes {text[:48].replace(chr(10), ' ')}",
            1000,
        )

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                kid, embedded, content_hash, profile = _upsert_resume_item_text(
                    cur,
                    workspace_id,
                    title=title,
                    text=text,
                    kind_norm=kind_norm,
                    category=category,
                    url=None,
                    extra_tags=["pasted-text"],
                    embed=False,
                )
            conn.commit()
            ingest_meta = (profile or {}).pop("_ingest", {}) if isinstance(profile, dict) else {}
            _queue_embed(background_tasks, kid, title, text)
            _queue_gemini_rag_sync(background_tasks, workspace_id, kid)
            _queue_extracted_link_index(
                background_tasks,
                workspace_id,
                text,
                parent_title=title,
                parent_id=kid if kid != -1 else None,
            )
            return {
                "ok": True,
                "knowledgeItemId": kid,
                "kind": kind_norm,
                "category": category,
                "embedded": embedded,
                "contentHash": content_hash,
                "profile": profile,
                "linkedSources": [],
                "linkIndexQueued": True,
                "merged": bool(ingest_meta.get("merged")),
                "workspaceId": str(workspace_id),
            }
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/file-capture")
    async def job_responder_resume_file_capture(
        request: Request,
        background_tasks: BackgroundTasks,
        workspaceId: str = Form(...),
        kind: str = Form("job_resume"),
        category: str = Form("cv"),
        title: Optional[str] = Form(default=None, max_length=1000),
        caption: Optional[str] = Form(default=None, max_length=4000),
        file: UploadFile = File(...),
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        try:
            workspace_id = int(workspaceId.strip())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="workspaceId must be numeric") from exc
        _guard_workspace(auth_ctx, workspace_id)

        kind_norm = _resume_kind_norm(kind)
        category_norm = truncate_text(str(category).strip().lower(), 128) or "cv"
        safe_name = sanitize_extracted_text(str(file.filename or "upload.bin")) or "upload.bin"

        raw = await file.read()
        if not raw:
            raise HTTPException(status_code=400, detail="empty_file")
        if len(raw) > MAX_FILE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"file_too_large_max_{MAX_FILE_BYTES}",
            )

        mime_type = str(file.content_type or "application/octet-stream")
        started = time.monotonic()
        deadline = started + FILE_CAPTURE_BUDGET_SEC
        timings: Dict[str, float] = {}
        try:
            is_image = mime_type.startswith("image/") or str(safe_name).lower().endswith(
                (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")
            )
            remaining = deadline - time.monotonic()
            t_extract = time.monotonic()
            extracted_text, meta, category_override = _extract_text_with_vision(
                safe_name,
                raw,
                mime_type,
                allow_vision=bool(is_image and remaining > 8),
                category_hint=category_norm,
            )
            timings["extractSec"] = round(time.monotonic() - t_extract, 3)
            if meta.get("needsVision") and not extracted_text:
                extracted_text = (
                    f"Изображение {safe_name}: OCR на запросе пропущен (лимит времени). "
                    "Текст можно вставить вручную."
                )
                meta["visionDeferred"] = True
            if category_override:
                category_norm = category_override
                if kind_norm == PRIMARY_CV_KIND and category_norm == "screenshot":
                    # screenshots in portfolio path should stay experience; keep CV kind if user forced it
                    pass
                elif kind_norm != PRIMARY_CV_KIND:
                    kind_norm = "job_experience"

            if caption:
                extracted_text = f"{caption.strip()}\n\n{extracted_text}".strip()

            extracted_text = sanitize_extracted_text(extracted_text or "")
            if len(extracted_text) < 20:
                err = meta.get("error") or "too_short"
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"no_text_extracted ({err}). "
                        "Для PDF/DOC сохраните как текст или DOCX, либо загрузите скриншот. "
                        f"extract={meta}"
                    ),
                )

            # Keep multiple primary CVs as separate RAG rows even if extract overlaps.
            if kind_norm == PRIMARY_CV_KIND:
                extracted_text = f"CV file: {safe_name}\n\n{extracted_text}"

            item_title = truncate_text(
                sanitize_extracted_text(
                    (title or str(meta.get("filename") or safe_name) or "Resume").strip()
                )
                or "Resume",
                1000,
            )
            extra_tags = ["screenshot"] if category_norm == "screenshot" else None

            t_upsert = time.monotonic()
            conn = pg_connect()
            try:
                with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                    kid, embedded, content_hash, profile = _upsert_resume_item_text(
                        cur,
                        workspace_id,
                        title=item_title,
                        text=extracted_text,
                        kind_norm=kind_norm,
                        category=category_norm,
                        url=None,
                        extra_tags=extra_tags,
                        embed=False,
                    )
                conn.commit()
                timings["upsertSec"] = round(time.monotonic() - t_upsert, 3)
                ingest_meta = (profile or {}).pop("_ingest", {}) if isinstance(profile, dict) else {}
                _queue_embed(background_tasks, kid, item_title, extracted_text)
                _queue_gemini_rag_sync(background_tasks, workspace_id, kid)
                _queue_extracted_link_index(
                    background_tasks,
                    workspace_id,
                    extracted_text,
                    parent_title=item_title,
                    parent_id=kid if kid != -1 else None,
                    raw_bytes=len(raw),
                )
                total_sec = round(time.monotonic() - started, 3)
                timings["totalSec"] = total_sec
                _LOG.info(
                    "file-capture ok name=%s bytes=%s extract=%.3fs upsert=%.3fs total=%.3fs kid=%s merged=%s",
                    safe_name,
                    len(raw),
                    timings.get("extractSec") or 0,
                    timings.get("upsertSec") or 0,
                    total_sec,
                    kid,
                    ingest_meta.get("merged"),
                )
                return {
                    "ok": True,
                    "knowledgeItemId": kid,
                    "kind": kind_norm,
                    "category": category_norm,
                    "embedded": embedded,
                    "contentHash": content_hash,
                    "extract": meta,
                    "profile": profile,
                    "linkedSources": [],
                    "linkIndexQueued": True,
                    "merged": bool(ingest_meta.get("merged")),
                    "partial": bool(meta.get("pdfTruncated") or meta.get("visionDeferred")),
                    "timings": timings,
                    "workspaceId": str(workspace_id),
                }
            except Exception:
                conn.rollback()
                raise
            finally:
                conn.close()
        except HTTPException:
            raise
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"invalid_extracted_text: {exc}",
            ) from exc
        except Exception as exc:
            _LOG.exception("file-capture failed name=%s", safe_name)
            raise HTTPException(
                status_code=422,
                detail=f"file_ingest_failed: {type(exc).__name__}: {exc}",
            ) from exc

    @app.post("/api/v1/job-responder/resume/link-capture")
    async def job_responder_resume_link_capture(
        payload: JobResponderResumeLinkCapturePayload,
        request: Request,
        background_tasks: BackgroundTasks,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        url_norm = normalize_url(payload.url)
        kind_norm = _resume_kind_norm(payload.kind)
        category_norm = truncate_text(str(payload.category or "experience").strip().lower(), 128) or "experience"

        preview = fetch_link_preview(url_norm, timeout_sec=LINK_PREVIEW_TIMEOUT_SEC)
        text = ""
        try:
            fetched = fetch_content_via_jina(url_norm, timeout_sec=8)
            if fetched.get("ok"):
                text = str(fetched.get("content_text") or "").strip()
        except Exception:
            text = ""
        if len(text) < 20:
            title_bit = preview.get("title") or url_norm
            desc_bit = preview.get("summary") or ""
            text = f"{title_bit}\nURL: {url_norm}\n{desc_bit}".strip()
        if len(text) < 20:
            raise HTTPException(status_code=422, detail="empty_link_content")

        item_title = truncate_text((payload.title or preview.get("title") or url_norm or "Link").strip(), 1000)
        category_for_store = category_norm if category_norm != "experience" else "link"

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                existing = _find_resume_item_by_url(cur, workspace_id, url_norm)
                kid, embedded, content_hash, profile = _upsert_resume_item_text(
                    cur,
                    workspace_id,
                    title=item_title,
                    text=text[:12000],
                    kind_norm=kind_norm,
                    category=category_for_store,
                    url=url_norm,
                    extra_tags=["link"],
                    embed=False,
                    link_preview=preview,
                )
                ingest_meta = (profile or {}).pop("_ingest", {}) if isinstance(profile, dict) else {}
                linked = _index_extracted_links(
                    cur,
                    workspace_id,
                    text,
                    parent_title=item_title,
                    parent_id=kid if kid != -1 else None,
                    max_links=LINK_PREVIEW_MAX,
                    fetch_preview=False,
                )
            conn.commit()
            _queue_embed(background_tasks, kid, item_title, text[:3500])
            _queue_gemini_rag_sync(background_tasks, workspace_id, kid)
            return {
                "ok": True,
                "knowledgeItemId": kid,
                "kind": kind_norm,
                "category": category_for_store,
                "embedded": embedded,
                "contentHash": content_hash,
                "profile": profile,
                "deduped": bool(existing is not None or ingest_meta.get("merged")),
                "merged": bool(ingest_meta.get("merged")),
                "description": (preview.get("summary") or "")[:280],
                "linkedSources": linked,
                "workspaceId": str(workspace_id),
            }
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/drive-import")
    async def job_responder_drive_import(
        payload: JobResponderDriveImportPayload,
        request: Request,
        background_tasks: BackgroundTasks,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        """
        MVP: list + download files from a Google Drive folder via user access token.
        Full OAuth app consent is TODO - see docs/job-responder/drive.md
        """
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        token = (payload.accessToken or "").strip()
        if not token:
            raise HTTPException(
                status_code=422,
                detail=(
                    "accessToken required for Drive import MVP. "
                    "Paste a Google OAuth access token with drive.readonly "
                    "(see docs/job-responder/drive.md). Full OAuth in-extension is TODO."
                ),
            )

        folder_id = parse_drive_folder_id(payload.folderUrlOrId)
        kind_norm = _resume_kind_norm(payload.kind)
        category_norm = truncate_text(str(payload.category or "drive").strip().lower(), 128) or "drive"

        try:
            import urllib.error
            import urllib.parse
            import urllib.request
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        q = urllib.parse.quote(
            f"'{folder_id}' in parents and trashed=false",
            safe="",
        )
        list_url = (
            "https://www.googleapis.com/drive/v3/files"
            f"?q={q}&pageSize={int(payload.maxFiles)}"
            "&fields=files(id,name,mimeType,size)"
            "&supportsAllDrives=true&includeItemsFromAllDrives=true"
        )

        def _drive_get(url: str) -> bytes:
            req = urllib.request.Request(
                url,
                headers={"Authorization": f"Bearer {token}"},
                method="GET",
            )
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    return resp.read()
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")[:500]
                raise HTTPException(
                    status_code=422,
                    detail=f"drive_http_{exc.code}: {body}",
                ) from exc

        list_raw = _drive_get(list_url)
        try:
            listing = json.loads(list_raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=502, detail="drive_list_invalid_json") from exc

        files = listing.get("files") or []
        imported: List[Dict[str, Any]] = []
        errors: List[Dict[str, Any]] = []

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                for fmeta in files[: payload.maxFiles]:
                    fid = str(fmeta.get("id") or "")
                    fname = str(fmeta.get("name") or fid or "drive-file")
                    mime = str(fmeta.get("mimeType") or "application/octet-stream")
                    if mime == "application/vnd.google-apps.folder":
                        continue
                    try:
                        if mime.startswith("application/vnd.google-apps."):
                            # export Google Docs as plain text
                            export_mime = "text/plain"
                            if "spreadsheet" in mime:
                                export_mime = "text/csv"
                            elif "presentation" in mime:
                                export_mime = "text/plain"
                            dl_url = (
                                f"https://www.googleapis.com/drive/v3/files/{fid}/export"
                                f"?mimeType={urllib.parse.quote(export_mime)}"
                            )
                        else:
                            dl_url = (
                                f"https://www.googleapis.com/drive/v3/files/{fid}"
                                f"?alt=media&supportsAllDrives=true"
                            )
                        raw = _drive_get(dl_url)
                        text, meta, cat_override = _extract_text_with_vision(
                            fname,
                            raw,
                            mime,
                            allow_vision=False,
                            category_hint=category_norm,
                        )
                        use_category = cat_override or category_norm
                        use_kind = kind_norm
                        if use_category == "screenshot":
                            use_kind = "job_experience"
                        if len((text or "").strip()) < 20:
                            errors.append({"name": fname, "error": f"no_text: {meta}"})
                            continue
                        kid, embedded, content_hash, profile = _upsert_resume_item_text(
                            cur,
                            workspace_id,
                            title=truncate_text(fname, 1000),
                            text=text.strip(),
                            kind_norm=use_kind,
                            category=use_category,
                            url=f"https://drive.google.com/file/d/{fid}/view",
                            extra_tags=["drive", "screenshot"] if use_category == "screenshot" else ["drive"],
                            embed=False,
                        )
                        ingest_meta = (profile or {}).pop("_ingest", {}) if isinstance(profile, dict) else {}
                        imported.append(
                            {
                                "knowledgeItemId": kid,
                                "title": fname,
                                "kind": use_kind,
                                "category": use_category,
                                "embedded": embedded,
                                "contentHash": content_hash,
                                "profile": profile,
                                "merged": bool(ingest_meta.get("merged")),
                                "linkedSources": [],
                            }
                        )
                        _queue_embed(background_tasks, kid, fname, text.strip())
                        _queue_gemini_rag_sync(background_tasks, workspace_id, kid)
                        _queue_extracted_link_index(
                            background_tasks,
                            workspace_id,
                            text.strip(),
                            parent_title=fname,
                            parent_id=kid if kid != -1 else None,
                            raw_bytes=len(raw),
                        )
                    except HTTPException as exc:
                        errors.append({"name": fname, "error": str(exc.detail)})
                    except Exception as exc:
                        errors.append({"name": fname, "error": str(exc)})
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        return {
            "ok": True,
            "folderId": folder_id,
            "workspaceId": str(workspace_id),
            "importedCount": len(imported),
            "imported": imported,
            "errors": errors,
            "todo": "Full in-extension Google OAuth consent is not wired yet - token is pasted manually for MVP.",
        }

    @app.post("/api/v1/job-responder/resume/search")
    async def job_responder_resume_search(
        payload: JobResponderResumeSearchPayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                mode, rows = _resume_search_rows(cur, workspace_id, payload.query, payload.limit)
            items = [
                {
                    "knowledgeItemId": int(r["id"]),
                    "title": r.get("title"),
                    "kind": r.get("kind"),
                    "category": r.get("category"),
                    "summary": r.get("ai_summary"),
                    "distance": float(r["distance"]) if r.get("distance") is not None else None,
                }
                for r in rows
            ]
            return {"mode": mode, "query": payload.query, "items": items}
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/relevance")
    async def job_responder_relevance(
        payload: JobResponderRelevancePayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                if payload.selectedSourceIds:
                    rows = _resume_selected_rows(cur, workspace_id, payload.selectedSourceIds)
                else:
                    rows = _resume_workspace_rows(cur, workspace_id, SELECTED_SOURCES_MAX)
        finally:
            conn.close()

        rag_items, _truncated = cap_rag_items(list(rows), max_n=SELECTED_SOURCES_MAX)
        merged = merge_profiles_from_rows(rag_items)
        result = score_resume_vs_vacancy(payload.vacancy, rag_items, merged_profile=merged)
        result["workspaceId"] = str(workspace_id)
        result["sourcesUsed"] = [
            {
                "knowledgeItemId": int(r.get("id")),
                "title": r.get("title"),
                "kind": r.get("kind"),
            }
            for r in rag_items[:12]
        ]
        result["usedUnifiedProfile"] = True
        return result

    @app.get("/api/v1/job-responder/gemini-rag/status")
    async def job_responder_gemini_rag_status(
        workspaceId: str,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(workspaceId)
        _guard_workspace(auth_ctx, workspace_id)
        return jr_gemini_rag.get_status(pg_connect, workspace_id)

    @app.post("/api/v1/job-responder/gemini-rag/sync")
    async def job_responder_gemini_rag_sync(
        payload: JobResponderGeminiRagSyncPayload,
        request: Request,
        background_tasks: BackgroundTasks,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)
        if not jr_gemini_rag.is_enabled():
            return {"ok": False, "enabled": False, "message": "JOB_RESPONDER_GEMINI_RAG is off"}

        def _job() -> None:
            try:
                jr_gemini_rag.sync_workspace(pg_connect, workspace_id, poll=payload.poll)
            except Exception:
                _LOG.exception("gemini rag full sync failed ws=%s", workspace_id)

        if payload.poll:
            result = jr_gemini_rag.sync_workspace(pg_connect, workspace_id, poll=True)
            result["enabled"] = True
            return result

        background_tasks.add_task(_job)
        return {
            "ok": True,
            "enabled": True,
            "queued": True,
            "workspaceId": str(workspace_id),
            "message": "Gemini RAG sync queued",
        }

    @app.post("/api/v1/job-responder/generate")
    async def job_responder_generate(
        payload: JobResponderGeneratePayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        started = time.monotonic()
        deadline = started + GENERATE_BUDGET_SEC
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        if not has_any_bookmark_llm_keys():
            return {
                "ok": False,
                "error": "llm_not_configured",
                "message": "LLM-ключи не настроены в Swoop Admin -> Settings.",
                "text": "",
                "workspaceId": str(workspace_id),
            }

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    select count(*)::int as c
                    from public.knowledge_items
                    where workspace_id = %s and source = %s and kind = %s
                    """,
                    (workspace_id, RESUME_SOURCE, PRIMARY_CV_KIND),
                )
                cv_row = cur.fetchone() or {}
                if int(cv_row.get("c") or 0) < 1:
                    raise HTTPException(
                        status_code=422,
                        detail="Upload a primary resume first (job_responder/resume/capture with kind=job_resume).",
                    )

                if payload.selectedSourceIds:
                    rag_rows = _resume_selected_rows(cur, workspace_id, payload.selectedSourceIds)
                    if not rag_rows:
                        raise HTTPException(status_code=422, detail="Selected sources were not found in your Resume RAG.")
                else:
                    rag_rows = _resume_workspace_rows(cur, workspace_id, SELECTED_SOURCES_MAX)
        finally:
            conn.close()

        rag_items, truncated = cap_rag_items(list(rag_rows), max_n=SELECTED_SOURCES_MAX)
        merged = merge_profiles_from_rows(rag_items)
        relevance = score_resume_vs_vacancy(payload.vacancy, rag_items, merged_profile=merged)
        mode = "question_answers" if payload.mode in ("qa", "question_answers") else "cover_letter"
        merged_questions = list(payload.vacancy.questions or [])
        if payload.questions:
            merged_questions = list(payload.questions) + merged_questions
        normalized_questions = normalize_questions(merged_questions)
        prompt_extra = resolve_prompt_extra(payload.promptExtra, payload.customInstructions)
        overrides = normalize_profile_overrides(payload.profileOverrides)
        if overrides:
            merged = apply_profile_overrides(merged, overrides)
            prompt_extra = inject_overrides_into_prompt_extra(prompt_extra, overrides)
        # Aggressive compact on first try (not only on retry).
        profile_cap = COMPACT_PROFILE_CHARS
        cover_cap = COVER_TEMPLATE_CHARS
        profile_compressed = False
        provider_errors: List[str] = []
        gemini_rag_used = False
        gemini_rag_citations: List[str] = []
        raw_text = ""
        chat_result = None
        compact_text = ""
        has_template = False

        rag_status = jr_gemini_rag.get_status(pg_connect, workspace_id) if jr_gemini_rag.is_enabled() else {}
        use_rag = payload.useGeminiRag
        if use_rag is None:
            use_rag = bool(jr_gemini_rag.is_enabled() and rag_status.get("ready"))

        if use_rag and jr_gemini_rag.is_enabled() and rag_status.get("storeName") and int(rag_status.get("docCount") or 0) > 0:
            cover_template_rag = resolve_cover_template(
                payload.coverTemplate, payload.baseLetter, max_chars=cover_cap
            )
            has_template = bool(cover_template_rag) and mode == "cover_letter"
            system_prompt_rag = build_system_prompt(
                mode, has_cover_template=has_template, prompt_extra=prompt_extra
            )
            user_prompt_rag = jr_gemini_rag.build_gemini_rag_user_prompt(
                payload.vacancy,
                mode,
                payload.host,
                normalized_questions,
                cover_template=cover_template_rag if has_template else "",
                prompt_extra=prompt_extra,
                host_labels=HOST_LABELS,
            )
            remaining_rag = deadline - time.monotonic()
            if remaining_rag >= 8:
                try:
                    rag_gen = call_with_timeout(
                        jr_gemini_rag.generate_with_file_search,
                        min(remaining_rag - 1.0, 22.0),
                        store_name=str(rag_status["storeName"]),
                        system_prompt=system_prompt_rag,
                        user_prompt=user_prompt_rag,
                        mode=mode,
                        model=JR_GEMINI_MODEL,
                    )
                except FuturesTimeout:
                    rag_gen = {"ok": False, "error": "timeout"}
                    provider_errors.append("gemini_rag:timeout")
                except Exception as exc:
                    rag_gen = {"ok": False, "error": str(exc)}
                    provider_errors.append(f"gemini_rag:{type(exc).__name__}")
                else:
                    if rag_gen.get("ok") and str(rag_gen.get("text") or "").strip():
                        raw_text = str(rag_gen["text"]).strip()
                        gemini_rag_used = True
                        gemini_rag_citations = list(rag_gen.get("citations") or [])
                        chat_result = type(
                            "GeminiRagResult",
                            (),
                            {
                                "content": raw_text,
                                "model_resolved": rag_gen.get("model"),
                                "provider_used": rag_gen.get("provider") or "gemini_file_search",
                            },
                        )()
                    else:
                        provider_errors.append(f"gemini_rag:{rag_gen.get('error') or 'empty'}")

        def _run_llm(profile_max: int, cover_max: int, attempt_timeout: float):
            cover_template = resolve_cover_template(
                payload.coverTemplate, payload.baseLetter, max_chars=cover_max
            )
            has_template = bool(cover_template) and mode == "cover_letter"
            compact_text = format_compact_profile(merged, max_chars=profile_max)
            system_prompt = build_system_prompt(
                mode, has_cover_template=has_template, prompt_extra=prompt_extra
            )
            user_prompt = build_user_prompt(
                payload.vacancy,
                compact_text,
                mode,
                payload.host,
                normalized_questions,
                cover_template=cover_template if has_template else "",
                prompt_extra=prompt_extra,
            )
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
            max_tokens = 1200 if mode == "question_answers" else 700
            # Fast providers first. OpenRouter intentionally skipped.
            # Prefer openmodel (stable) then Gemini flash; GLM last (slow key pool).
            attempts = (
                {"tier_override": "fast", "route_provider_override": "openmodel", "route_model_override": ""},
                {
                    "tier_override": "fast",
                    "route_provider_override": "gemini",
                    "route_model_override": JR_GEMINI_MODEL,
                },
                {"tier_override": "fast", "route_provider_override": "glm", "route_model_override": ""},
            )
            chat_result = None
            last_err = ""
            for kwargs in attempts:
                remaining = deadline - time.monotonic()
                if remaining < 3.5:
                    last_err = "timeout"
                    provider_errors.append("budget_exhausted")
                    break
                provider = str(kwargs.get("route_provider_override") or "?")
                t_cap = min(float(attempt_timeout), remaining - 0.8, 12.0)
                if t_cap < 3.0:
                    last_err = "timeout"
                    provider_errors.append(f"{provider}:no_time")
                    break
                try:
                    chat_result = call_with_timeout(
                        openai_chat_completions_generic,
                        t_cap,
                        messages=messages,
                        temperature=0.35,
                        max_tokens_override=max_tokens,
                        **kwargs,
                    )
                except FuturesTimeout:
                    last_err = "timeout"
                    provider_errors.append(f"{provider}:timeout>{t_cap:.0f}s")
                    _LOG.warning(
                        "generate provider timeout provider=%s timeout=%.1f profile=%d",
                        provider,
                        t_cap,
                        profile_max,
                    )
                    chat_result = None
                    continue
                except Exception as exc:
                    last_err = f"{type(exc).__name__}: {exc}"
                    provider_errors.append(f"{provider}:{type(exc).__name__}")
                    _LOG.warning("generate LLM attempt failed provider=%s: %s", provider, last_err)
                    chat_result = None
                    continue
                if chat_result and str(getattr(chat_result, "content", None) or "").strip():
                    return chat_result, "", compact_text, has_template
                empty_detail = "empty"
                if chat_result is not None:
                    empty_detail = "empty_content"
                last_err = last_err or empty_detail
                provider_errors.append(f"{provider}:{empty_detail}")
                chat_result = None
            return chat_result, last_err, compact_text, has_template

        if not raw_text:
            chat_result, last_err, compact_text, has_template = _run_llm(
                profile_cap, cover_cap, LLM_ATTEMPT_TIMEOUT_SEC
            )
        else:
            last_err = ""
            compact_text = format_compact_profile(merged, max_chars=profile_cap)
        if (not chat_result or not str(getattr(chat_result, "content", None) or "").strip()) and (
            last_err == "timeout" or last_err.startswith("timeout") or "timeout" in (last_err or "")
        ):
            remaining = deadline - time.monotonic()
            if remaining >= 6:
                profile_compressed = True
                profile_cap = COMPACT_PROFILE_CHARS_RETRY
                cover_cap = COVER_TEMPLATE_CHARS_RETRY
                _LOG.warning(
                    "generate mini-profile retry remaining=%.1f errs=%s",
                    remaining,
                    ";".join(provider_errors[-6:]),
                )
                chat_result, last_err, compact_text, has_template = _run_llm(
                    profile_cap, cover_cap, min(9.0, remaining - 1.0)
                )

        raw_text = str(getattr(chat_result, "content", None) or "").strip() if chat_result else raw_text
        if not raw_text:
            elapsed = time.monotonic() - started
            err_tail = "; ".join(provider_errors[-8:]) if provider_errors else last_err or "unknown"
            _LOG.warning(
                "generate empty last_err=%s elapsed=%.2f providers=%s profile=%d",
                last_err,
                elapsed,
                err_tail,
                len(compact_text or ""),
            )
            timed_out = "timeout" in str(last_err or "") or any("timeout" in e for e in provider_errors)
            if timed_out:
                msg = (
                    f"Модель не успела за {elapsed:.0f}с (бюджет {GENERATE_BUDGET_SEC:.0f}с). "
                    f"Провайдеры: {err_tail}. "
                    f"Профиль {len(compact_text or '')} симв. / {len(rag_items)} sources. "
                    "Повторите «Отклик» - сервер уже использует сжатый unified profile."
                )
            else:
                msg = (
                    f"LLM не вернул текст. Провайдеры: {err_tail}. "
                    "Проверьте Swoop Admin -> Settings -> Gemini / openmodel / GLM (без OpenRouter)."
                )
            return {
                "ok": False,
                "error": "llm_timeout" if timed_out else "llm_empty",
                "message": msg,
                "text": "",
                "timedOut": timed_out,
                "providerErrors": provider_errors,
                "contextLimited": truncated,
                "profileCompressed": profile_compressed or timed_out,
                "compactProfileChars": len(compact_text or ""),
                "sourcesMerged": len(rag_items),
                "usedUnifiedProfile": True,
                "elapsedSec": round(elapsed, 2),
                "limitMessage": (
                    f"В unified profile слиты {len(rag_items)} источников (лимит merge {SELECTED_SOURCES_MAX})."
                    if truncated
                    else f"Unified compact profile: {len(rag_items)} sources, {len(compact_text or '')} chars."
                ),
                "relevance": relevance,
                "sources": [
                    {"knowledgeItemId": int(r.get("id")), "title": r.get("title"), "kind": r.get("kind")}
                    for r in rag_items
                ],
                "workspaceId": str(workspace_id),
            }

        answers = None
        if mode == "question_answers":
            parsed = parse_answers_json(raw_text, expected_questions=normalized_questions)
            if parsed:
                answers = parsed
                raw_text = "\n\n".join(
                    f"Q: {a.get('question', '')}\nA: {a.get('answer', '')}" for a in parsed
                )
            else:
                # Fallback: keep question texts even if JSON parse failed
                if normalized_questions:
                    answers = [
                        {"question": str(q.get("text") or ""), "answer": hh_format_text(raw_text) if i == 0 else ""}
                        for i, q in enumerate(normalized_questions)
                    ]
                    raw_text = "\n\n".join(
                        f"Q: {a['question']}\nA: {a['answer'] or '—'}" for a in answers
                    )
                else:
                    raw_text = hh_format_text(raw_text)
        else:
            raw_text = hh_format_text(raw_text)

        sources = [
            {
                "knowledgeItemId": int(r.get("id")),
                "title": r.get("title"),
                "kind": r.get("kind"),
                "distance": float(r["distance"]) if r.get("distance") is not None else None,
            }
            for r in rag_items
        ]
        elapsed_ok = time.monotonic() - started
        limit_message = (
            f"Unified profile: {len(rag_items)} sources -> {len(compact_text)} chars"
            + (" (mini retry)" if profile_compressed else "")
            + (f"; merge capped at {SELECTED_SOURCES_MAX}" if truncated else "")
            + (f"; gemini_rag docs={rag_status.get('docCount')}" if gemini_rag_used else "")
            + f"; {elapsed_ok:.1f}s"
        )
        return {
            "ok": True,
            "text": raw_text,
            "answers": answers,
            "sources": sources,
            "relevance": relevance,
            "model": getattr(chat_result, "model_resolved", None),
            "provider": getattr(chat_result, "provider_used", None),
            "host": payload.host,
            "mode": mode,
            "usedCoverTemplate": has_template,
            "usedUnifiedProfile": not gemini_rag_used,
            "usedGeminiRag": gemini_rag_used,
            "geminiRagCitations": gemini_rag_citations,
            "profileCompressed": profile_compressed,
            "compactProfileChars": len(compact_text),
            "sourcesMerged": len(rag_items),
            "contextLimited": truncated,
            "limitMessage": limit_message,
            "elapsedSec": round(elapsed_ok, 2),
            "questionsCount": len(normalized_questions),
            "workspaceId": str(workspace_id),
        }
