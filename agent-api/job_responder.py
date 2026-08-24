"""Job Responder: Resume RAG slice + vacancy cover letter / question generation."""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple
from urllib.parse import parse_qs, urlparse

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

_SKILL_SPLIT = re.compile(r"[,;/|•·\n]+")
_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9+#.\-]{2,}")
# http(s) URLs in CV/portfolio/text (trim trailing punctuation separately)
_URL_RE = re.compile(r"https?://[^\s<>\"'`)\]]+", re.IGNORECASE)

_KNOWN_TOOLS = {
    "python",
    "javascript",
    "typescript",
    "react",
    "vue",
    "node",
    "nodejs",
    "n8n",
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


class JobResponderVacancyPayload(BaseModel):
    url: Optional[str] = Field(default=None, max_length=4000)
    title: str = Field(..., min_length=1, max_length=1000)
    company: Optional[str] = Field(default=None, max_length=500)
    description: str = Field(..., min_length=1, max_length=50000)
    questions: List[str] = Field(default_factory=list)
    structured: Optional[JobResponderVacancyStructured] = None


class JobResponderGeneratePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    mode: Literal["cover_letter", "question_answers"] = "cover_letter"
    host: str = Field(default="web", max_length=32)
    vacancy: JobResponderVacancyPayload
    locale: str = Field(default="ru", max_length=16)
    selectedSourceIds: List[int] = Field(default_factory=list)
    # User's own cover letter to adapt (not write from scratch). Alias: baseLetter.
    coverTemplate: Optional[str] = Field(default=None, max_length=20000)
    baseLetter: Optional[str] = Field(default=None, max_length=20000)


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


def resolve_cover_template(cover_template: Optional[str], base_letter: Optional[str]) -> str:
    raw = (cover_template or base_letter or "").strip()
    return raw[:20000] if raw else ""


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


def score_resume_vs_vacancy(
    vacancy: JobResponderVacancyPayload,
    resume_rows: List[Dict[str, Any]],
) -> Dict[str, Any]:
    vac_profile = vacancy_to_match_blob(vacancy)
    vac_skills = {s.lower() for s in (vac_profile.get("skills") or [])}
    vac_tools = {s.lower() for s in (vac_profile.get("tools") or [])}
    vac_roles = {s.lower() for s in (vac_profile.get("roles") or [])}
    vac_domains = {s.lower() for s in (vac_profile.get("domains") or [])}
    vac_prefs = {s.lower() for s in (vac_profile.get("employment_preferences") or [])}
    vac_format = (vac_profile.get("geo_remote") or "").lower()

    merged_skills: set = set()
    merged_tools: set = set()
    merged_roles: set = set()
    merged_domains: set = set()
    merged_prefs: set = set()
    resume_formats: set = set()
    resume_seniority: Optional[str] = None

    for row in resume_rows:
        body = str(row.get("content_text") or row.get("ai_summary") or "")
        prof = parse_profile_from_content(body)
        merged_skills.update(s.lower() for s in (prof.get("skills") or []))
        merged_tools.update(s.lower() for s in (prof.get("tools") or []))
        merged_roles.update(s.lower() for s in (prof.get("roles") or []))
        merged_domains.update(s.lower() for s in (prof.get("domains") or []))
        merged_prefs.update(s.lower() for s in (prof.get("employment_preferences") or []))
        if prof.get("geo_remote"):
            resume_formats.add(str(prof["geo_remote"]).lower())
        if prof.get("seniority") and not resume_seniority:
            resume_seniority = str(prof["seniority"])

    rationale: List[str] = []
    score = 35  # baseline if any resume context exists

    skill_hits = sorted(vac_skills & (merged_skills | merged_tools))
    if vac_skills:
        ratio = len(skill_hits) / max(len(vac_skills), 1)
        score += int(35 * min(1.0, ratio))
        if skill_hits:
            rationale.append(f"Совпадение навыков: {', '.join(skill_hits[:8])}")
        else:
            rationale.append("Прямых совпадений ключевых навыков мало - опирайтесь на смежный опыт")
            score -= 8
    else:
        # soft token overlap on title keywords
        title_tokens = {t.lower() for t in _TOKEN_RE.findall(vacancy.title or "") if len(t) > 2}
        soft = sorted(title_tokens & (merged_skills | merged_tools | merged_roles | merged_domains))
        if soft:
            score += min(20, 4 * len(soft))
            rationale.append(f"Совпадения по заголовку: {', '.join(soft[:6])}")

    role_hits = sorted(vac_roles & merged_roles)
    if role_hits:
        score += 8
        rationale.append(f"Роли: {', '.join(role_hits[:4])}")

    domain_hits = sorted(vac_domains & merged_domains)
    if domain_hits:
        score += 7
        rationale.append(f"Домены: {', '.join(domain_hits[:4])}")

    if vac_format:
        if vac_format in resume_formats or (vac_format == "remote" and "remote" in merged_prefs):
            score += 10
            rationale.append(f"Формат работы совпадает: {vac_format}")
        else:
            score -= 5
            rationale.append(f"Формат вакансии ({vac_format}) не явно подтверждён в Resume RAG")

    pref_hits = sorted(vac_prefs & merged_prefs)
    if pref_hits:
        score += 5
        rationale.append(f"Занятость: {', '.join(pref_hits)}")

    if vac_profile.get("experience_raw"):
        rationale.append(f"Требуемый опыт: {vac_profile['experience_raw']}")
        if resume_seniority:
            rationale.append(f"В резюме seniority: {resume_seniority}")
            score += 3

    if not resume_rows:
        score = 0
        rationale = ["Нет выбранных/найденных источников Resume RAG"]

    score = max(0, min(100, score))
    if not rationale:
        rationale.append("Базовая оценка по общему контексту резюме")

    return {
        "score": score,
        "rationale": rationale[:8],
        "vacancyProfile": vac_profile,
        "matchedSkills": skill_hits[:12],
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


def build_system_prompt(mode: str, *, has_cover_template: bool = False) -> str:
    base = """Ты помощник кандидата при отклике на вакансии.

Правила:
- Пиши от первого лица кандидата.
- Используй ТОЛЬКО факты из блока RESUME CONTEXT. Если факта нет - не выдумывай.
- Без AI-slop: без "страстно увлечен", "синергия", "динамичная команда", "уникальная возможность".
- Формат HH: короткое тире "-", стрелки "->", кавычки ASCII ".
- Язык: русский (если вакансия явно на другом языке - можно на языке вакансии).
- Не используй markdown-заголовки и списки с буллетами - plain text для поля HH.
- Учитывай STRUCTURED VACANCY (формат, занятость, навыки) если они есть.
"""
    if mode == "question_answers":
        return (
            base
            + """
Режим: ответы на вопросы работодателя.
Верни ТОЛЬКО валидный JSON-массив:
[{"question":"...","answer":"..."}]
По одному объекту на каждый вопрос из списка QUESTIONS. Ответы 1-4 предложения, конкретно."""
        )
    if has_cover_template:
        return (
            base
            + """
Режим: адаптация сопроводительного письма под вакансию.
Дан блок COVER TEMPLATE - это письмо кандидата. НЕ пиши письмо с нуля.
Задача: адаптировать шаблон под конкретную вакансию и выбранные источники:
- сохрани голос, тон и структуру автора;
- подставь/уточни факты под требования вакансии (только из RESUME CONTEXT);
- убери нерелевантное, усили совпадения с вакансией;
- длина ориентировочно как у шаблона (или 800-1400 символов).
Верни ТОЛЬКО текст письма, без пояснений."""
        )
    return (
        base
        + """
Режим: сопроводительное письмо (cover letter).
Длина: 800-1400 символов.
Структура: приветствие -> 1-2 релевантных кейса под требования -> стек/формат -> CTA -> имя (если есть в RESUME CONTEXT).
Верни ТОЛЬКО текст письма, без пояснений."""
    )


def build_user_prompt(
    vacancy: JobResponderVacancyPayload,
    rag_items: List[Dict[str, Any]],
    mode: str,
    host: str,
    questions: Optional[List[str]] = None,
    cover_template: str = "",
) -> str:
    host_label = HOST_LABELS.get(host, host or "web")
    ctx_lines = []
    for idx, item in enumerate(rag_items, start=1):
        title = str(item.get("title") or f"Source {idx}")
        category = str(item.get("category") or "")
        kind = str(item.get("kind") or "")
        summary = str(item.get("summary") or item.get("ai_summary") or "")
        body = str(item.get("content_text") or "")[:2500]
        ctx_lines.append(
            f"[source {idx}] title={title!r} kind={kind} category={category}\n"
            f"summary: {summary}\n"
            f"text: {body}"
        )
    resume_context = "\n\n".join(ctx_lines) if ctx_lines else "(empty - do not invent facts)"

    structured = vacancy.structured.model_dump(exclude_none=True) if vacancy.structured else None
    vacancy_block = json.dumps(
        {
            "host": host_label,
            "url": vacancy.url,
            "title": vacancy.title,
            "company": vacancy.company,
            "description": vacancy.description[:8000],
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
        parts.append(f"COVER TEMPLATE (adapt, do not rewrite from scratch):\n{cover_template[:12000]}")
    if mode == "question_answers":
        qlist = questions or vacancy.questions or []
        parts.append("QUESTIONS:\n" + json.dumps(qlist, ensure_ascii=False, indent=2))
    return "\n\n".join(parts)


def register_job_responder_routes(app, deps: Dict[str, Any]) -> None:
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
                raise HTTPException(
                    status_code=422,
                    detail="vision_required: изображение требует OCR/vision, но vision недоступен",
                )
            try:
                from hermes_media import vision_analyze_from_settings
            except Exception as exc:  # pragma: no cover
                raise HTTPException(
                    status_code=503,
                    detail=f"vision_unavailable: {exc}",
                ) from exc

            b64 = base64.b64encode(raw).decode("ascii")
            vision = vision_analyze_from_settings(
                "Извлеки весь читаемый текст со скриншота/изображения портфолио для Resume RAG. "
                "Верни только текст (заголовки, описания проектов, стек). Без комментариев.",
                image_base64=b64,
            )
            meta["vision"] = {"ok": bool(vision.get("ok")), "error": vision.get("error")}
            if not vision.get("ok"):
                raise HTTPException(
                    status_code=503,
                    detail=f"vision_failed: {vision.get('error') or 'unknown'}",
                )
            extracted_text = str(vision.get("text") or vision.get("content") or "").strip()
            meta["method"] = "vision"
            if category_hint in ("experience", "portfolio", "drive", "cv", ""):
                category_override = "screenshot"

        return extracted_text, meta, category_override

    def _resume_search_rows(cur, workspace_id: int, query: str, limit: int) -> Tuple[str, List[Dict[str, Any]]]:
        emb = get_openai_embedding(query)
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
              null::float8 as distance
            from public.knowledge_items k
            where k.workspace_id = %s
              and k.source = %s
              and k.kind = any(%s)
              and k.id = any(%s)
            order by
              case when k.kind = %s then 0 else 1 end,
              k.updated_at desc
            limit 20
            """,
            (workspace_id, RESUME_SOURCE, list(RESUME_KINDS), ids, PRIMARY_CV_KIND),
        )
        return cur.fetchall()

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
    ) -> Tuple[int, bool, str, Dict[str, Any]]:
        title = sanitize_extracted_text(title or "")
        text = sanitize_extracted_text(text or "")
        profile = extract_resume_profile(text, title=title, category=category)
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

        embed_source = "\n".join(p for p in (title, ai_summary, text[:3500]) if p)[:8000]
        vec = get_openai_embedding(embed_source)
        embedded = False
        if vec and len(vec) == bookmarks_vector_dim and kid != -1:
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
                (
                    kid,
                    build_vector_literal(vec),
                    "job-responder-embed",
                ),
            )
            embedded = True
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
        max_links: int = 8,
        fetch_remote: bool = False,
    ) -> List[Dict[str, Any]]:
        """Extract http(s) URLs from text and upsert selectable link sources (category=link).

        Remote Jina fetch is off by default so ingest stays under Cloudflare ~100s.
        """
        urls = extract_urls_from_text(text, limit=max_links)
        linked: List[Dict[str, Any]] = []
        for url in urls:
            existing = _find_resume_item_by_url(cur, workspace_id, url)
            if existing is not None:
                linked.append(
                    {
                        "knowledgeItemId": existing,
                        "url": url,
                        "deduped": True,
                        "title": url,
                    }
                )
                continue

            link_text = ""
            if fetch_remote:
                try:
                    fetched = fetch_content_via_jina(normalize_url(url), timeout_sec=4)
                    if fetched.get("ok"):
                        link_text = str(fetched.get("content_text") or "").strip()
                except Exception:
                    link_text = ""

            if len(link_text) < 20:
                parent_bit = f" (from {parent_title})" if parent_title else ""
                parent_id_bit = f" parent_id={parent_id}" if parent_id else ""
                link_text = (
                    f"Link extracted from Job Responder source{parent_bit}{parent_id_bit}.\n"
                    f"URL: {url}\n"
                    "Content fetch unavailable; URL indexed for RAG selection."
                )

            item_title = truncate_text(url, 1000)
            kid, embedded, content_hash, profile = _upsert_resume_item_text(
                cur,
                workspace_id,
                title=item_title,
                text=link_text,
                kind_norm="job_experience",
                category="link",
                url=normalize_url(url) or url,
                extra_tags=["link", "extracted-url"],
            )
            linked.append(
                {
                    "knowledgeItemId": kid,
                    "url": url,
                    "deduped": False,
                    "embedded": embedded,
                    "contentHash": content_hash,
                    "title": item_title,
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
        urls = extract_urls_from_text(text, limit=8)
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
                        max_links=8,
                        fetch_remote=False,
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
                      left(coalesce(ai_summary, content_text, ''), 280) as preview
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
                        "title": r.get("title"),
                        "url": r.get("url"),
                        "kind": r.get("kind"),
                        "category": r.get("category"),
                        "tags": r.get("tags") or [],
                        "preview": r.get("preview"),
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
                )
            conn.commit()
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
                )
            conn.commit()
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
        try:
            extracted_text, meta, category_override = _extract_text_with_vision(
                safe_name,
                raw,
                mime_type,
                allow_vision=True,
                category_hint=category_norm,
            )
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
                    )
                conn.commit()
                _queue_extracted_link_index(
                    background_tasks,
                    workspace_id,
                    extracted_text,
                    parent_title=item_title,
                    parent_id=kid if kid != -1 else None,
                    raw_bytes=len(raw),
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
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        url_norm = normalize_url(payload.url)
        kind_norm = _resume_kind_norm(payload.kind)
        category_norm = truncate_text(str(payload.category or "experience").strip().lower(), 128) or "experience"

        fetched = fetch_content_via_jina(url_norm, timeout_sec=25)
        if not fetched.get("ok"):
            raise HTTPException(status_code=422, detail=f"fetch_failed:{fetched.get('error') or fetched}")

        text = str(fetched.get("content_text") or "").strip()
        if len(text) < 20:
            raise HTTPException(status_code=422, detail="empty_link_content")

        item_title = truncate_text((payload.title or url_norm or "Link").strip(), 1000)
        category_for_store = category_norm if category_norm != "experience" else "link"

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                existing = _find_resume_item_by_url(cur, workspace_id, url_norm)
                kid, embedded, content_hash, profile = _upsert_resume_item_text(
                    cur,
                    workspace_id,
                    title=item_title,
                    text=text,
                    kind_norm=kind_norm,
                    category=category_for_store,
                    url=url_norm,
                    extra_tags=["link"],
                )
                # Nested URLs inside fetched page (light: no recursive remote fetch)
                linked = _index_extracted_links(
                    cur,
                    workspace_id,
                    text,
                    parent_title=item_title,
                    parent_id=kid if kid != -1 else None,
                    max_links=8,
                    fetch_remote=False,
                )
            conn.commit()
            return {
                "ok": True,
                "knowledgeItemId": kid,
                "kind": kind_norm,
                "category": category_for_store,
                "embedded": embedded,
                "contentHash": content_hash,
                "profile": profile,
                "deduped": existing is not None and existing == kid,
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
                            allow_vision=True,
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
                        )
                        imported.append(
                            {
                                "knowledgeItemId": kid,
                                "title": fname,
                                "kind": use_kind,
                                "category": use_category,
                                "embedded": embedded,
                                "contentHash": content_hash,
                                "profile": profile,
                                "linkedSources": [],
                            }
                        )
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
                    search_q = build_resume_search_query(payload.vacancy)
                    _, rows = _resume_search_rows(cur, workspace_id, search_q, 12)
        finally:
            conn.close()

        result = score_resume_vs_vacancy(payload.vacancy, [dict(r) for r in rows])
        result["workspaceId"] = str(workspace_id)
        result["sourcesUsed"] = [
            {
                "knowledgeItemId": int(r.get("id")),
                "title": r.get("title"),
                "kind": r.get("kind"),
            }
            for r in rows[:8]
        ]
        return result

    @app.post("/api/v1/job-responder/generate")
    async def job_responder_generate(
        payload: JobResponderGeneratePayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = _auth(request, x_api_key, authorization)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        _guard_workspace(auth_ctx, workspace_id)

        if not has_any_bookmark_llm_keys():
            raise HTTPException(
                status_code=503,
                detail="LLM keys are not configured in Swoop service_settings.",
            )

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
                    search_q = build_resume_search_query(payload.vacancy)
                    _, rag_rows = _resume_search_rows(cur, workspace_id, search_q, 12)
        finally:
            conn.close()

        rag_items = [dict(r) for r in rag_rows]
        relevance = score_resume_vs_vacancy(payload.vacancy, rag_items)
        mode = payload.mode
        cover_template = resolve_cover_template(payload.coverTemplate, payload.baseLetter)
        has_template = bool(cover_template) and mode == "cover_letter"
        system_prompt = build_system_prompt(mode, has_cover_template=has_template)
        user_prompt = build_user_prompt(
            payload.vacancy,
            rag_items,
            mode,
            payload.host,
            payload.vacancy.questions,
            cover_template=cover_template if has_template else "",
        )

        chat_result = openai_chat_completions_generic(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.35,
            tier_override="general",
            max_tokens_override=1800 if mode == "question_answers" else 1200,
        )
        raw_text = str(chat_result.content or "").strip()
        if not raw_text:
            raise HTTPException(status_code=502, detail="LLM returned empty response")

        answers = None
        if mode == "question_answers":
            try:
                parsed = json.loads(raw_text)
                if isinstance(parsed, list):
                    answers = parsed
                    raw_text = "\n\n".join(
                        f"Q: {a.get('question', '')}\nA: {hh_format_text(str(a.get('answer') or ''))}"
                        for a in parsed
                        if isinstance(a, dict)
                    )
            except json.JSONDecodeError:
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
            for r in rag_items[:8]
        ]

        return {
            "text": raw_text,
            "answers": answers,
            "sources": sources,
            "relevance": relevance,
            "model": chat_result.model_resolved,
            "provider": chat_result.provider_used,
            "host": payload.host,
            "mode": mode,
            "usedCoverTemplate": has_template,
            "workspaceId": str(workspace_id),
        }
