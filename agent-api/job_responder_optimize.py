"""Permanent Resume KB optimization for Autoro Hunt.

Normalize / structure / dedupe uploaded sources into rich profile slots,
tag domains/industries, build semantic evidence, and produce vacancy-aware
compact profiles so generate never drops the most relevant industry context.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# Canonical industry/domain ids -> match phrases (RU/EN). Generic, not tourism-only.
DOMAIN_CATALOG: Dict[str, Tuple[str, ...]] = {
    "tourism": (
        "tourism",
        "travel",
        "туриз",
        "путешеств",
        "hospitality",
        "hotel",
        "отел",
        "resort",
        "курорт",
        "phu quoc",
        "фукуок",
        "pquoc",
        "booking.com",
        "tripadvisor",
        "klook",
        "турагент",
        "туроператор",
        "авиабилет",
        "destination",
    ),
    "ecommerce": (
        "ecommerce",
        "e-commerce",
        "ecom",
        "интернет-магазин",
        "интернет магазин",
        "marketplace",
        "маркетплейс",
        "wildberries",
        "ozon",
        "shopify",
        "woocommerce",
        "retail",
        "ритейл",
        "d2c",
        "dtc",
    ),
    "saas": (
        "saas",
        "b2b saas",
        "software as a service",
        "подписочн",
        "subscription product",
        "product-led",
        "plg",
    ),
    "edtech": (
        "edtech",
        "ed-tech",
        "образован",
        "онлайн-курс",
        "онлайн курс",
        "lms",
        "e-learning",
        "elearning",
        "школ",
        "университет",
    ),
    "fintech": (
        "fintech",
        "финтех",
        "банк",
        "banking",
        "платеж",
        "payment",
        "кредит",
        "insurance",
        "страхов",
        "crypto",
        "web3",
        "defi",
    ),
    "marketing": (
        "marketing",
        "маркетинг",
        "growth",
        "performance",
        "бренд",
        "brand",
        "smm",
        "pr ",
        " performance-маркетинг",
    ),
    "seo": (
        "seo",
        "geo",
        "аeo",
        "поисков",
        "search engine",
        "сео",
        "линькбилд",
        "link building",
        "контент-маркетинг",
    ),
    "ai": (
        "ai ",
        "ии ",
        "llm",
        "machine learning",
        "ml ",
        "нейросет",
        "rag",
        "агент",
        "ai agent",
        "chatgpt",
        "gemini",
        "claude",
    ),
    "automation": (
        "automation",
        "автоматиз",
        "n8n",
        "zapier",
        "make.com",
        "workflow",
        "rpa",
    ),
    "media": (
        "media",
        "медиа",
        "content studio",
        "видеопродакш",
        "video production",
        "publisher",
        "издател",
        "youtube",
        "streaming",
    ),
    "healthcare": (
        "health",
        "healthcare",
        "медтех",
        "medtech",
        "клиник",
        "pharma",
        "фарм",
        "telemed",
    ),
    "real_estate": (
        "real estate",
        "недвижим",
        "proptech",
        "риелтор",
        "застройщик",
        "housing",
    ),
    "gaming": (
        "gaming",
        "game",
        "игр",
        "esport",
        "киберспорт",
        "gamedev",
    ),
    "logistics": (
        "logistics",
        "логистик",
        "supply chain",
        "доставк",
        "fulfillment",
        "warehouse",
        "склад",
    ),
    "hr": (
        "hr tech",
        "hrtech",
        "recrut",
        "рекрут",
        "подбор персонал",
        "talent",
        "кадр",
    ),
    "devtools": (
        "developer tools",
        "devtools",
        "api platform",
        "infrastructure",
        "devops",
        "cloud platform",
    ),
}

# Product / company name hints that reinforce a domain when found in profile text.
DOMAIN_PRODUCT_HINTS: Dict[str, Tuple[str, ...]] = {
    "tourism": ("pquoc.com", "pquoc", "phu quoc", "ask phu quoc"),
    "ecommerce": ("askona", "lamoda", "wildberries", "ozon"),
    "ai": ("autoro.tech", "swoop", "keept"),
    "automation": ("autoro.tech", "swoop", "n8n"),
    "seo": ("askona", "lamoda"),
}

_DOMAIN_RE_CACHE: Dict[str, re.Pattern] = {}
_METRIC_RE = re.compile(
    r"(?i)(?:\b\d+(?:[.,]\d+)?\s*%|\b(?:roas|roi|gmv|gp|ctr|cpa|cpc|cpm|ltv|cac|arpu)\b"
    r"|\b\d+\s*(?:\+|plus)?\s*(?:отел|hotel|язык|lang|язык\w*|проект\w*|лет))"
)
_PROJECT_LINE_RE = re.compile(
    r"(?im)^(?:[-*•]\s*)?(?:проект|project|кейс|case|продукт|product|платформ\w*)[:\s]+(.{8,220})$"
)
_URL_RE = re.compile(r"https?://[^\s<>\"'`)\]]+", re.I)
_BULLET_SPLIT_RE = re.compile(r"[\n\r]+|(?<=[.;])\s+(?=[A-ZА-ЯЁ])")


def _norm(s: str) -> str:
    t = (s or "").lower().replace("ё", "е")
    t = t.replace("—", "-").replace("–", "-").replace("→", "->")
    return re.sub(r"\s+", " ", t).strip()


def _uniq(items: Iterable[str], limit: int = 40) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for raw in items:
        s = re.sub(r"\s+", " ", str(raw or "")).strip()
        if len(s) < 2:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s[:220])
        if len(out) >= limit:
            break
    return out


def _domain_pattern(dom_id: str) -> re.Pattern:
    cached = _DOMAIN_RE_CACHE.get(dom_id)
    if cached:
        return cached
    phrases = DOMAIN_CATALOG.get(dom_id) or ()
    parts = [re.escape(p.strip()) for p in phrases if p.strip()]
    if not parts:
        pat = re.compile(r"(?!x)x")
    else:
        # Longer phrases first; allow soft boundaries for Cyrillic stems.
        parts.sort(key=len, reverse=True)
        pat = re.compile("|".join(parts), re.I)
    _DOMAIN_RE_CACHE[dom_id] = pat
    return pat


def extract_domains_from_text(text: str, *, title: str = "") -> List[str]:
    """Tag industries/domains present in free text (vacancy or resume)."""
    blob = _norm(f"{title}\n{text}")
    if not blob:
        return []
    found: List[str] = []
    for dom_id in DOMAIN_CATALOG:
        if _domain_pattern(dom_id).search(blob):
            found.append(dom_id)
            continue
        for hint in DOMAIN_PRODUCT_HINTS.get(dom_id, ()):
            if hint.lower() in blob:
                found.append(dom_id)
                break
    return _uniq(found, 20)


def extract_projects_from_text(text: str, *, title: str = "") -> List[Dict[str, str]]:
    """Extract project/product mentions with optional URL and domain tags."""
    raw = text or ""
    projects: List[Dict[str, str]] = []
    seen: Set[str] = set()

    def add(name: str, summary: str = "", url: str = "", domains: Optional[Sequence[str]] = None) -> None:
        n = re.sub(r"\s+", " ", (name or "").strip())
        if len(n) < 2:
            return
        key = n.lower()[:80]
        if key in seen:
            return
        seen.add(key)
        doms = list(domains or extract_domains_from_text(f"{n} {summary} {url}"))
        projects.append(
            {
                "name": n[:120],
                "summary": re.sub(r"\s+", " ", (summary or "").strip())[:220],
                "url": (url or "")[:400],
                "domains": ",".join(doms[:6]),
            }
        )

    for m in _PROJECT_LINE_RE.finditer(raw):
        line = m.group(1).strip()
        urls = _URL_RE.findall(line)
        add(line[:120], line, urls[0] if urls else "")

    # Known product URLs / names anywhere in text
    for url in _URL_RE.findall(raw)[:20]:
        host = re.sub(r"^https?://(www\.)?", "", url, flags=re.I).split("/")[0].lower()
        if host in {"example.com", "localhost"} or "jr-smoke" in url.lower():
            continue
        # Capture surrounding sentence as summary
        idx = raw.lower().find(url.lower())
        window = raw[max(0, idx - 80) : idx + len(url) + 120]
        add(host, re.sub(r"\s+", " ", window).strip()[:220], url)

    # Bare product tokens with domain hints
    low = _norm(f"{title}\n{raw}")
    for dom_id, hints in DOMAIN_PRODUCT_HINTS.items():
        for hint in hints:
            if hint.lower() in low:
                add(hint, f"domain:{dom_id}", "", [dom_id])

    return projects[:16]


def extract_metrics_from_text(text: str) -> List[str]:
    out: List[str] = []
    for line in (text or "").splitlines():
        s = re.sub(r"\s+", " ", line).strip(" -•*\t")
        if 12 <= len(s) <= 200 and _METRIC_RE.search(s):
            out.append(s[:180])
        if len(out) >= 12:
            break
    if not out:
        for m in _METRIC_RE.finditer(text or ""):
            start = max(0, m.start() - 40)
            end = min(len(text or ""), m.end() + 40)
            bit = re.sub(r"\s+", " ", (text or "")[start:end]).strip(" -•*,;")
            if 8 <= len(bit) <= 160:
                out.append(bit)
            if len(out) >= 8:
                break
    return _uniq(out, 12)


def extract_domain_evidence_bullets(
    text: str,
    domains: Sequence[str],
    *,
    limit: int = 8,
) -> List[str]:
    """Pick experience-like lines that mention matched domains / products."""
    if not domains:
        return []
    pats = [_domain_pattern(d) for d in domains if d in DOMAIN_CATALOG]
    hint_bits: List[str] = []
    for d in domains:
        hint_bits.extend(DOMAIN_PRODUCT_HINTS.get(d, ()))
    hint_low = [h.lower() for h in hint_bits]
    bullets: List[str] = []
    for line in re.split(r"[\n\r]+", text or ""):
        s = re.sub(r"\s+", " ", line).strip(" -•*\t")
        if not (20 <= len(s) <= 240):
            continue
        low = s.lower()
        hit = any(p.search(s) for p in pats) or any(h in low for h in hint_low)
        if not hit:
            continue
        bullets.append(s[:200])
        if len(bullets) >= limit:
            break
    return _uniq(bullets, limit)


def enrich_resume_profile(
    profile: Dict[str, Any],
    text: str,
    *,
    title: str = "",
    category: str = "",
) -> Dict[str, Any]:
    """Fill rich slots on top of heuristic extract_resume_profile output."""
    out = dict(profile or {})
    blob = f"{title}\n{text}"
    domains = list(out.get("domains") or [])
    domains.extend(extract_domains_from_text(blob, title=title))
    # Category hints
    cat = (category or "").lower()
    if "portfolio" in cat or "screenshot" in cat:
        domains.append("marketing")
    out["domains"] = _uniq(domains, 24)

    projects = list(out.get("projects") or [])
    if not projects or not isinstance(projects[0], dict):
        projects = []
    projects.extend(extract_projects_from_text(text, title=title))
    # Dedupe projects by name
    seen_p: Set[str] = set()
    clean_projects: List[Dict[str, str]] = []
    for p in projects:
        if not isinstance(p, dict):
            continue
        key = _norm(str(p.get("name") or ""))[:80]
        if not key or key in seen_p:
            continue
        seen_p.add(key)
        clean_projects.append(
            {
                "name": str(p.get("name") or "")[:120],
                "summary": str(p.get("summary") or "")[:220],
                "url": str(p.get("url") or "")[:400],
                "domains": str(p.get("domains") or "")[:120],
            }
        )
    out["projects"] = clean_projects[:16]

    metrics = list(out.get("metrics") or [])
    metrics.extend(extract_metrics_from_text(blob))
    out["metrics"] = _uniq([str(x) for x in metrics], 12)

    # Domain-tagged evidence bullets (permanent, not vacancy-specific)
    evidence = list(out.get("domain_evidence") or [])
    evidence.extend(extract_domain_evidence_bullets(blob, out["domains"], limit=10))
    # Also keep generic experience bullets
    exp = list(out.get("experience_bullets") or [])
    out["experience_bullets"] = _uniq([*evidence, *[str(x) for x in exp]], 18)
    out["domain_evidence"] = _uniq([str(x) for x in evidence], 12)

    return dedupe_profile_slots(out)


def dedupe_profile_slots(profile: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(profile or {})
    for key, lim in (
        ("skills", 50),
        ("tools", 40),
        ("roles", 20),
        ("domains", 24),
        ("languages", 10),
        ("employment_preferences", 10),
        ("experience_bullets", 18),
        ("education", 6),
        ("achievements", 8),
        ("metrics", 12),
        ("domain_evidence", 12),
        ("cover_snippets", 4),
        ("source_titles", 24),
    ):
        if key in out:
            out[key] = _uniq([str(x) for x in (out.get(key) or [])], lim)
    # Near-hash dedupe for long bullets
    bullets = out.get("experience_bullets") or []
    if bullets:
        kept: List[str] = []
        hashes: Set[str] = set()
        for b in bullets:
            s = re.sub(r"\s+", " ", str(b)).strip().lower()
            h = hashlib.sha1(s[:160].encode("utf-8")).hexdigest()[:12]
            # Also drop if high overlap with kept
            if h in hashes:
                continue
            if any(s[:60] in k.lower() or k.lower()[:60] in s for k in kept):
                continue
            hashes.add(h)
            kept.append(str(b)[:220])
        out["experience_bullets"] = kept[:18]
    links = out.get("links") or []
    if isinstance(links, list):
        seen_u: Set[str] = set()
        clean_l: List[Dict[str, str]] = []
        for lk in links:
            if not isinstance(lk, dict):
                continue
            url = str(lk.get("url") or "").strip()
            key = url.lower().rstrip("/")
            if not key or key in seen_u:
                continue
            seen_u.add(key)
            clean_l.append(
                {
                    "url": url[:400],
                    "title": str(lk.get("title") or "")[:120],
                    "summary": str(lk.get("summary") or "")[:220],
                }
            )
        out["links"] = clean_l[:14]
    return out


def vacancy_domains_from_text(title: str = "", description: str = "", skills: Optional[Sequence[str]] = None) -> List[str]:
    bits = [title or "", description or "", " ".join(skills or [])]
    return extract_domains_from_text("\n".join(bits), title=title)


def pin_domain_facts(
    profile: Dict[str, Any],
    vacancy_domains: Sequence[str],
    *,
    max_bullets: int = 4,
    max_projects: int = 3,
) -> Dict[str, Any]:
    """Select profile facts that match vacancy industries (any domain, not hardcoded)."""
    vac = [d for d in (_norm(x) for x in vacancy_domains) if d]
    if not vac:
        return {
            "domains_matched": [],
            "pinned_bullets": [],
            "pinned_projects": [],
            "pinned_metrics": [],
            "search_boost": "",
        }

    profile_domains = {_norm(str(d)) for d in (profile.get("domains") or [])}
    matched = [d for d in vac if d in profile_domains]
    # Soft match via product hints / evidence even if domain slot missed ingest
    blob = _norm(
        " ".join(
            [
                str(profile.get("_text_blob") or ""),
                " ".join(str(x) for x in (profile.get("experience_bullets") or [])),
                " ".join(str(x) for x in (profile.get("domain_evidence") or [])),
                " ".join(
                    f"{p.get('name','')} {p.get('summary','')} {p.get('url','')}"
                    for p in (profile.get("projects") or [])
                    if isinstance(p, dict)
                ),
            ]
        )
    )
    for d in vac:
        if d in matched:
            continue
        if _domain_pattern(d).search(blob):
            matched.append(d)
            continue
        if any(h.lower() in blob for h in DOMAIN_PRODUCT_HINTS.get(d, ())):
            matched.append(d)

    matched = _uniq(matched, 12)
    pinned_bullets: List[str] = []
    # Prefer explicit domain_evidence, then experience, then project summaries
    candidates = [
        *[str(x) for x in (profile.get("domain_evidence") or [])],
        *[str(x) for x in (profile.get("experience_bullets") or [])],
    ]
    for p in profile.get("projects") or []:
        if isinstance(p, dict):
            bit = " - ".join(
                x for x in (str(p.get("name") or ""), str(p.get("summary") or "")) if x
            )
            if bit:
                candidates.append(bit[:220])
    for c in candidates:
        low = c.lower()
        if any(_domain_pattern(d).search(c) for d in matched) or any(
            h.lower() in low for d in matched for h in DOMAIN_PRODUCT_HINTS.get(d, ())
        ):
            pinned_bullets.append(c[:200])
        if len(pinned_bullets) >= max_bullets:
            break
    pinned_bullets = _uniq(pinned_bullets, max_bullets)

    pinned_projects: List[Dict[str, str]] = []
    for p in profile.get("projects") or []:
        if not isinstance(p, dict):
            continue
        pdoms = {_norm(x) for x in str(p.get("domains") or "").split(",") if x.strip()}
        hay = _norm(f"{p.get('name')} {p.get('summary')} {p.get('url')}")
        if pdoms & set(matched) or any(_domain_pattern(d).search(hay) for d in matched):
            pinned_projects.append(p)
        if len(pinned_projects) >= max_projects:
            break

    pinned_metrics: List[str] = []
    for m in profile.get("metrics") or []:
        s = str(m)
        if any(_domain_pattern(d).search(s) for d in matched):
            pinned_metrics.append(s[:160])
        elif len(pinned_metrics) < 2 and matched:
            # Keep a couple generic metrics when industry matched (optional color).
            pinned_metrics.append(s[:160])
        if len(pinned_metrics) >= 4:
            break
    pinned_metrics = _uniq(pinned_metrics, 4)

    boost_parts = list(matched)
    for p in pinned_projects[:3]:
        if p.get("name"):
            boost_parts.append(str(p["name"]))
        if p.get("url"):
            boost_parts.append(str(p["url"]))
    for b in pinned_bullets[:3]:
        boost_parts.append(b[:80])
    search_boost = " | ".join(_uniq(boost_parts, 12))

    return {
        "domains_matched": matched,
        "pinned_bullets": pinned_bullets,
        "pinned_projects": pinned_projects,
        "pinned_metrics": pinned_metrics,
        "search_boost": search_boost,
    }


def format_vacancy_aware_compact(
    profile: Dict[str, Any],
    *,
    vacancy_domains: Optional[Sequence[str]] = None,
    max_chars: int = 2200,
    base_formatter=None,
) -> str:
    """Render compact profile with reserved slots for matched domains.

    Guarantees domains_matched / industry_experience survive char budget cuts.
    """
    max_chars = max(1200, int(max_chars))
    vac_domains = list(vacancy_domains or [])
    pin = pin_domain_facts(profile, vac_domains)

    # Reserved block built first - never truncated away when possible
    reserved_lines: List[str] = []
    if pin["domains_matched"]:
        reserved_lines.append(
            "domains_matched: " + ", ".join(pin["domains_matched"])
        )
    if pin["pinned_bullets"]:
        reserved_lines.append("industry_experience (pin - keep for letter):")
        for b in pin["pinned_bullets"]:
            reserved_lines.append(f"- {b[:180]}")
    if pin["pinned_projects"]:
        reserved_lines.append("matched_projects:")
        for p in pin["pinned_projects"]:
            bit = str(p.get("name") or "")
            if p.get("url"):
                bit += f" ({p['url']})"
            if p.get("summary"):
                bit += f" - {str(p['summary'])[:120]}"
            reserved_lines.append(f"- {bit[:200]}")
    if pin["pinned_metrics"]:
        reserved_lines.append(
            "matched_metrics: " + "; ".join(pin["pinned_metrics"][:4])
        )
    reserved = "\n".join(reserved_lines).strip()
    reserved_budget = min(700, max(280, max_chars // 3)) if reserved else 0
    if reserved and len(reserved) > reserved_budget:
        reserved = reserved[: reserved_budget - 12].rstrip() + "\n…"

    # Merge pinned bullets into profile so base formatter also surfaces them high
    enriched = dict(profile)
    if pin["pinned_bullets"]:
        enriched["experience_bullets"] = _uniq(
            [*pin["pinned_bullets"], *[str(x) for x in (profile.get("experience_bullets") or [])]],
            16,
        )
    if pin["domains_matched"]:
        enriched["domains"] = _uniq(
            [*pin["domains_matched"], *[str(x) for x in (profile.get("domains") or [])]],
            16,
        )
    if pin["pinned_projects"] and not enriched.get("projects"):
        enriched["projects"] = pin["pinned_projects"]

    body_budget = max_chars - (len(reserved) + 2 if reserved else 0)
    if base_formatter is not None:
        body = base_formatter(enriched, max_chars=max(900, body_budget))
    else:
        body = _fallback_compact(enriched, max_chars=max(900, body_budget))

    # Inject projects / metrics lines if base formatter omitted them
    extra: List[str] = []
    if enriched.get("projects") and "matched_projects:" not in (reserved + body):
        extra.append("projects:")
        for p in list(enriched.get("projects") or [])[:5]:
            if not isinstance(p, dict):
                continue
            bit = str(p.get("name") or "")
            if p.get("url"):
                bit += f" - {p['url']}"
            extra.append(f"- {bit[:180]}")
    if enriched.get("metrics") and "metrics:" not in body.lower():
        mets = [str(x) for x in (enriched.get("metrics") or [])[:4]]
        if mets:
            extra.append("metrics: " + "; ".join(mets))

    parts = []
    if reserved:
        parts.append(reserved)
    parts.append(body)
    if extra:
        parts.append("\n".join(extra))
    text = "\n".join(parts).strip()
    if len(text) <= max_chars:
        return text
    # Keep reserved intact; trim body tail
    if reserved:
        remain = max_chars - len(reserved) - 2
        body_trim = body[: max(200, remain)].rstrip()
        if len(body_trim) < len(body):
            body_trim = body_trim.rstrip() + "\n…(truncated)"
        return f"{reserved}\n{body_trim}"[:max_chars]
    return text[: max_chars - 20].rstrip() + "\n…(truncated)"


def _fallback_compact(profile: Dict[str, Any], *, max_chars: int) -> str:
    lines = ["UNIFIED RESUME PROFILE (compact, deduped)"]
    for label, key, n in (
        ("skills", "skills", 20),
        ("tools", "tools", 16),
        ("roles", "roles", 10),
        ("domains", "domains", 12),
    ):
        items = [str(x) for x in (profile.get(key) or []) if str(x).strip()][:n]
        if items:
            lines.append(f"{label}: " + ", ".join(items))
    bullets = [str(x) for x in (profile.get("experience_bullets") or []) if str(x).strip()][:8]
    if bullets:
        lines.append("experience:")
        lines.extend(f"- {b[:180]}" for b in bullets)
    text = "\n".join(lines)
    return text if len(text) <= max_chars else text[: max_chars - 12] + "\n…"


def build_master_compact_document(profile: Dict[str, Any]) -> str:
    """Full structured master document stored as job_profile_compact in KB."""
    grid = profile.get("jr_semantic_grid") if isinstance(profile.get("jr_semantic_grid"), dict) else {}
    payload = {
        "version": 1,
        "source_count": int(profile.get("source_count") or 0),
        "skills": list(profile.get("skills") or [])[:40],
        "tools": list(profile.get("tools") or [])[:36],
        "roles": list(profile.get("roles") or [])[:16],
        "domains": list(profile.get("domains") or [])[:20],
        "languages": list(profile.get("languages") or [])[:10],
        "employment_preferences": list(profile.get("employment_preferences") or [])[:10],
        "seniority": profile.get("seniority"),
        "geo_remote": profile.get("geo_remote"),
        "experience_bullets": list(profile.get("experience_bullets") or [])[:16],
        "domain_evidence": list(profile.get("domain_evidence") or [])[:12],
        "metrics": list(profile.get("metrics") or [])[:10],
        "achievements": list(profile.get("achievements") or [])[:8],
        "education": list(profile.get("education") or [])[:6],
        "projects": list(profile.get("projects") or [])[:12],
        "links": list(profile.get("links") or [])[:12],
        "source_titles": list(profile.get("source_titles") or [])[:20],
        "semantic_clusters": sorted((grid.get("clusters") or {}).keys())[:24],
        "semantic_fingerprint": grid.get("fingerprint"),
    }
    lines = [
        "AUTORO HUNT OPTIMIZED RESUME PROFILE",
        "This document is the deduped master profile for cover-letter generation.",
        "Use domain tags and projects when vacancy industry matches.",
        "",
        json.dumps(payload, ensure_ascii=False, indent=2),
        "",
        "## domains",
        ", ".join(payload["domains"]) or "(none)",
        "",
        "## experience",
    ]
    for b in payload["experience_bullets"]:
        lines.append(f"- {b}")
    if payload["projects"]:
        lines.append("")
        lines.append("## projects")
        for p in payload["projects"]:
            if not isinstance(p, dict):
                continue
            lines.append(
                f"- {p.get('name')}: {p.get('summary') or ''} {p.get('url') or ''} "
                f"[{p.get('domains') or ''}]".strip()
            )
    if payload["metrics"]:
        lines.append("")
        lines.append("## metrics")
        for m in payload["metrics"]:
            lines.append(f"- {m}")
    if profile.get("rag_edits"):
        lines.append("")
        lines.append("## rag_edits")
        lines.append(str(profile.get("rag_edits"))[:3000])
    return "\n".join(lines).strip()


def build_file_search_query_boost(vacancy_domains: Sequence[str], pin: Optional[Dict[str, Any]] = None) -> str:
    """Prefix for Gemini File Search user prompt to retrieve domain-relevant docs."""
    pin = pin or {}
    bits: List[str] = []
    if vacancy_domains:
        bits.append("Industry focus: " + ", ".join(vacancy_domains))
    if pin.get("search_boost"):
        bits.append("Retrieve facts about: " + str(pin["search_boost"]))
    bits.append(
        "Prefer resume/portfolio chunks matching the vacancy industry/domain; "
        "include product names and metrics when present."
    )
    return "\n".join(bits)


def domain_tags_for_profile(profile: Dict[str, Any]) -> List[str]:
    tags = [f"domain:{_norm(str(d))[:40]}" for d in (profile.get("domains") or [])[:12]]
    for p in (profile.get("projects") or [])[:8]:
        if isinstance(p, dict) and p.get("name"):
            tags.append(f"project:{_norm(str(p['name']))[:40]}")
    return list(dict.fromkeys(tags))[:24]


COMPACT_PROFILE_TITLE = "Optimized Resume Profile (master)"
COMPACT_PROFILE_CATEGORY = "optimized"
