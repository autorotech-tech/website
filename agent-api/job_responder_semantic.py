"""Deterministic semantic skill/tool matching for Job Responder relevance.

No LLM / embeddings on the hot path. Builds an extended synonym grid from
Resume RAG compact profile + text evidence, then matches vacancy skills via:
exact -> cluster synonym -> fuzzy/token containment.
"""

from __future__ import annotations

import hashlib
import re
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9+#.%]{2,}")
_WS_RE = re.compile(r"\s+")

# Stopwords for token overlap (RU/EN)
_STOP = frozenset(
    {
        "и",
        "в",
        "на",
        "по",
        "для",
        "с",
        "из",
        "к",
        "о",
        "от",
        "the",
        "and",
        "of",
        "to",
        "for",
        "in",
        "a",
        "an",
        "with",
        "or",
        "навыки",
        "skill",
        "skills",
        "опыт",
        "знание",
        "умение",
        "работа",
        "work",
    }
)

# Canonical clusters: each term maps to the same cluster id via inverted index.
# Keep phrases that appear on HH.ru / LinkedIn for this candidate's domains.
_CLUSTER_TERMS: Dict[str, Tuple[str, ...]] = {
    "marketing": (
        "marketing",
        "маркетинг",
        "маркетолог",
        "marketer",
        "b2c маркетинг",
        "b2b маркетинг",
        "b2c marketing",
        "b2b marketing",
        "growth marketing",
        "growth",
        "performance marketing",
        "performance",
        "digital marketing",
        "digital",
        "product marketing",
        "internet marketing",
        "интернет маркетинг",
        "performance-маркетинг",
        "перфоманс",
        "performance маркетинг",
    ),
    "campaign_analysis": (
        "анализ эффективности маркетинговых кампаний",
        "анализ маркетинговых кампаний",
        "анализ кампаний",
        "campaign analysis",
        "marketing campaign analysis",
        "анализ эффективности",
        "маркетинговый анализ",
        "анализ маркетинга",
        "эффективность кампаний",
        "эффективность рекламы",
        "a/b",
        "a/b test",
        "ab test",
        "ab-тесты",
        "а/б",
        "эксперименты",
        "campaign performance",
        "оптимизация кампаний",
        "анализ рекламных кампаний",
    ),
    "marketing_metrics": (
        "маркетинговые метрики",
        "marketing metrics",
        "метрики",
        "metrics",
        "kpi",
        "roas",
        "roi",
        "gmv",
        "gp",
        "gross profit",
        "ctr",
        "cpa",
        "cpc",
        "cpm",
        "ltv",
        "cac",
        "arpu",
        "conversion rate",
        "конверсия",
        "unit economics",
        "юнит-экономика",
        "маркетинговые kpi",
        "показатели эффективности",
        "performance metrics",
    ),
    "budget_planning": (
        "планирование бюджета",
        "бюджет",
        "budget",
        "budget planning",
        "media budget",
        "медиабюджет",
        "медиа бюджет",
        "бюджет маркетинга",
        "marketing budget",
        "план бюджета",
        "budgeting",
        "бюджеты",
        "планирование медиабюджета",
        "распределение бюджета",
        "media planning",
        "медиапланирование",
    ),
    "ppc_seo_crm": (
        "ppc",
        "seo",
        "sem",
        "crm",
        "google ads",
        "google adwords",
        "яндекс директ",
        "yandex direct",
        "facebook ads",
        "meta ads",
        "контекстная реклама",
        "таргет",
        "targeting",
        "paid acquisition",
        "платный трафик",
    ),
    "analytics": (
        "analytics",
        "аналитика",
        "web analytics",
        "веб-аналитика",
        "google analytics",
        "ga4",
        "я.метрика",
        "яндекс метрика",
        "yandex metrica",
        "amplitude",
        "mixpanel",
        "data analysis",
        "анализ данных",
        "product analytics",
    ),
    "product": (
        "product",
        "продукт",
        "product manager",
        "продакт",
        "pm",
        "product ownership",
        "roadmap",
        "бэклог",
        "backlog",
        "user research",
        "JTBD",
    ),
    "ai_automation": (
        "ai",
        "ии",
        "llm",
        "chatgpt",
        "claude",
        "gemini",
        "rag",
        "automation",
        "автоматизация",
        "n8n",
        "агенты",
        "ai agents",
        "нейросети",
        "prompt engineering",
    ),
    "remote_work": (
        "remote",
        "удалённо",
        "удаленно",
        "удалёнка",
        "удаленка",
        "work from home",
        "wfh",
        "hybrid",
        "гибрид",
    ),
    "video_content": (
        "video",
        "видео",
        "content",
        "контент",
        "ai video",
        "comfyui",
        "runway",
        "kling",
        "midjourney",
        "нейрокреатор",
    ),
}

# Evidence patterns auto-extracted from resume text -> cluster id
_EVIDENCE_PATTERNS: Tuple[Tuple[str, str], ...] = (
    (r"\broas\b", "marketing_metrics"),
    (r"\bgmv\b", "marketing_metrics"),
    (r"\bgp\b", "marketing_metrics"),
    (r"\broi\b", "marketing_metrics"),
    (r"\bctr\b", "marketing_metrics"),
    (r"\bcpa\b", "marketing_metrics"),
    (r"\bcpc\b", "marketing_metrics"),
    (r"\bcpm\b", "marketing_metrics"),
    (r"\bltv\b", "marketing_metrics"),
    (r"\bcac\b", "marketing_metrics"),
    (r"\bkpi\b", "marketing_metrics"),
    (r"метрик", "marketing_metrics"),
    (r"конверси", "marketing_metrics"),
    (r"\bppc\b", "ppc_seo_crm"),
    (r"\bseo\b", "ppc_seo_crm"),
    (r"\bcrm\b", "ppc_seo_crm"),
    (r"\bsem\b", "ppc_seo_crm"),
    (r"google\s*ads", "ppc_seo_crm"),
    (r"yandex\s*direct|яндекс\s*директ", "ppc_seo_crm"),
    (r"контекстн\w*\s+реклам", "ppc_seo_crm"),
    (r"growth\s*marketing|performance\s*marketing|performance[-\s]*маркетинг|перфоманс", "marketing"),
    (r"\bb2c\b", "marketing"),
    (r"\bb2b\b", "marketing"),
    (r"media\s*budget|медиабюджет|бюджет|медиапланир", "budget_planning"),
    (r"планирован\w*\s+бюджет", "budget_planning"),
    (r"a/?b\s*test|а/?б\s*тест", "campaign_analysis"),
    (r"campaign\s*analysis|анализ\s+кампани|анализ\s+эффективност|маркетингов\w*\s+анализ", "campaign_analysis"),
    (r"эффективност\w*\s+(?:маркетинг|реклам|кампани)", "campaign_analysis"),
    (r"оптимизаци\w*\s+кампани", "campaign_analysis"),
    (r"ga4|google\s*analytics|amplitude|mixpanel", "analytics"),
    (r"\bn8n\b|\brag\b|\bllm\b", "ai_automation"),
)

# If any of these clusters have evidence, sibling HH skill phrases should match.
_MARKETING_FAMILY = frozenset(
    {
        "marketing",
        "campaign_analysis",
        "marketing_metrics",
        "budget_planning",
        "ppc_seo_crm",
    }
)


def normalize_phrase(text: str) -> str:
    t = (text or "").lower().replace("ё", "е")
    t = t.replace("—", "-").replace("–", "-").replace("→", "->")
    t = _WS_RE.sub(" ", t).strip(" ,.;:/\\|")
    return t


def tokenize(text: str) -> Set[str]:
    return {
        m.group(0).lower().replace("ё", "е")
        for m in _TOKEN_RE.finditer(text or "")
        if m.group(0).lower().replace("ё", "е") not in _STOP and len(m.group(0)) > 1
    }


def _build_term_index() -> Dict[str, str]:
    idx: Dict[str, str] = {}
    for cid, terms in _CLUSTER_TERMS.items():
        for term in terms:
            n = normalize_phrase(term)
            if n:
                idx[n] = cid
    return idx


_TERM_TO_CLUSTER = _build_term_index()


def cluster_for_phrase(phrase: str) -> Optional[str]:
    n = normalize_phrase(phrase)
    if not n:
        return None
    if n in _TERM_TO_CLUSTER:
        return _TERM_TO_CLUSTER[n]
    # longest substring / containment against known terms
    best_cid: Optional[str] = None
    best_len = 0
    for term, cid in _TERM_TO_CLUSTER.items():
        if len(term) < 3:
            continue
        if term in n or n in term:
            if len(term) > best_len:
                best_len = len(term)
                best_cid = cid
    if best_cid:
        return best_cid
    # token overlap with cluster seed terms
    toks = tokenize(n)
    if not toks:
        return None
    scores: Dict[str, int] = {}
    for term, cid in _TERM_TO_CLUSTER.items():
        overlap = len(toks & tokenize(term))
        if overlap:
            scores[cid] = scores.get(cid, 0) + overlap
    if not scores:
        return None
    return max(scores.items(), key=lambda x: x[1])[0]


def _fuzzy_ratio(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def profile_fingerprint(profile: Dict[str, Any]) -> str:
    bits = [
        ",".join(sorted(str(x).lower() for x in (profile.get("skills") or [])[:40])),
        ",".join(sorted(str(x).lower() for x in (profile.get("tools") or [])[:40])),
        ",".join(sorted(str(x).lower() for x in (profile.get("roles") or [])[:20])),
        ",".join(sorted(str(x).lower() for x in (profile.get("domains") or [])[:20])),
        str(profile.get("_text_blob") or "")[:4000],
        str(profile.get("source_count") or 0),
    ]
    raw = "|".join(bits)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def build_semantic_grid(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Build / reuse jr_semantic_grid on a merged resume profile."""
    fp = profile_fingerprint(profile)
    cached = profile.get("jr_semantic_grid")
    if isinstance(cached, dict) and cached.get("fingerprint") == fp and cached.get("clusters"):
        return cached

    blob = normalize_phrase(str(profile.get("_text_blob") or ""))
    # Collect candidate terms from slots
    seed_terms: List[str] = []
    for key in ("skills", "tools", "roles", "domains"):
        for item in profile.get(key) or []:
            seed_terms.append(str(item))
    for bullet in (profile.get("experience_bullets") or [])[:14]:
        seed_terms.append(str(bullet)[:120])
    for title in (profile.get("source_titles") or [])[:12]:
        seed_terms.append(str(title))

    clusters: Dict[str, Dict[str, Any]] = {}
    aliases: Set[str] = set()

    def _clean_evidence(raw: str, *, cid: str) -> List[str]:
        n = normalize_phrase(raw)
        if not n:
            return []

        def ok(s: str) -> bool:
            if not s or len(s) > 40:
                return False
            if s.count(" ") > 4:
                return False
            if re.search(r"\.\s+\w+", s):
                return False
            return True

        if ok(n) and _TERM_TO_CLUSTER.get(n) in (None, cid):
            return [n]
        found: List[str] = []
        for pattern, pcid in _EVIDENCE_PATTERNS:
            if pcid != cid:
                continue
            for m in re.finditer(pattern, n, flags=re.I):
                bit = normalize_phrase(m.group(0))
                if ok(bit) and bit not in found:
                    found.append(bit)
        for term, tcid in _TERM_TO_CLUSTER.items():
            if tcid != cid or not (2 <= len(term) <= 28) or not ok(term) or term in found:
                continue
            if len(term) <= 3:
                if not re.search(rf"(?<![a-zа-я0-9]){re.escape(term)}(?![a-zа-я0-9])", n, flags=re.I):
                    continue
            elif term not in n:
                continue
            found.append(term)
            if len(found) >= 8:
                break
        return found[:6]

    def touch_cluster(cid: str, evidence: str, *, source: str) -> None:
        slot = clusters.setdefault(
            cid,
            {"id": cid, "evidence": [], "aliases": [], "sources": []},
        )
        existing = {normalize_phrase(x) for x in slot["evidence"]}
        for ev_n in _clean_evidence(evidence, cid=cid):
            if ev_n and ev_n not in existing:
                slot["evidence"].append(ev_n)
                existing.add(ev_n)
        if source and source not in slot["sources"]:
            slot["sources"].append(source)
        for alias in _CLUSTER_TERMS.get(cid, ()):
            an = normalize_phrase(alias)
            if an and an not in slot["aliases"]:
                slot["aliases"].append(an)
                aliases.add(an)

    # Expand from explicit profile terms
    for term in seed_terms:
        n = normalize_phrase(term)
        if not n:
            continue
        aliases.add(n)
        cid = cluster_for_phrase(n)
        if cid:
            touch_cluster(cid, n, source="profile")

    # Auto-evidence from resume blob (metrics / tools)
    for pattern, cid in _EVIDENCE_PATTERNS:
        for m in re.finditer(pattern, blob, flags=re.I):
            touch_cluster(cid, m.group(0), source="evidence")
            # also mark parent marketing if metrics/ppc found
            if cid in {"marketing_metrics", "ppc_seo_crm", "campaign_analysis", "budget_planning"}:
                touch_cluster("marketing", m.group(0), source="evidence")

    # Domain shortcuts
    for dom in profile.get("domains") or []:
        d = normalize_phrase(str(dom))
        if d in {"marketing", "seo", "ecommerce", "content"}:
            touch_cluster("marketing", d, source="domain")
        if d in {"ai", "ml", "automation"}:
            touch_cluster("ai_automation", d, source="domain")

    # Marketing family inheritance: Growth/Performance CV covers HH skill phrasing
    # like "маркетинговые метрики" / "планирование бюджета" even without every acronym.
    family_present = _MARKETING_FAMILY & set(clusters.keys())
    if family_present:
        shared_ev: List[str] = []
        for cid in sorted(family_present):
            shared_ev.extend(str(e) for e in (clusters[cid].get("evidence") or [])[:6])
        shared_ev = list(dict.fromkeys(shared_ev))[:10] or ["marketing"]
        for cid in _MARKETING_FAMILY:
            if cid in clusters:
                continue
            for ev in shared_ev[:4]:
                touch_cluster(cid, ev, source="family")

    # Prefer short, readable evidence first
    for slot in clusters.values():
        ev = sorted(slot["evidence"], key=lambda x: (len(x) > 40, len(x), x))
        slot["evidence"] = ev[:12]
        slot["aliases"] = slot["aliases"][:40]

    grid = {
        "version": 2,
        "fingerprint": fp,
        "clusters": clusters,
        "aliases": sorted(aliases)[:200],
        "termCount": len(aliases),
        "clusterCount": len(clusters),
    }
    profile["jr_semantic_grid"] = grid
    return grid


def _phrase_in_blob(phrase: str, blob: str, alias_set: Set[str]) -> bool:
    n = normalize_phrase(phrase)
    if not n:
        return False
    if n in alias_set or n in blob:
        return True
    # significant multi-token containment
    toks = [t for t in tokenize(n) if len(t) > 2]
    if len(toks) >= 2 and all(t in blob for t in toks):
        return True
    return False


def match_skill_against_grid(
    skill: str,
    grid: Dict[str, Any],
    *,
    resume_blob: str = "",
    resume_exact: Optional[Set[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Return match dict or None if truly missing."""
    n = normalize_phrase(skill)
    if not n:
        return None
    exact = {normalize_phrase(x) for x in (resume_exact or set()) if normalize_phrase(x)}
    blob = normalize_phrase(resume_blob)
    clusters: Dict[str, Any] = grid.get("clusters") or {}

    # Evidence terms actually seen in resume (not the full synonym dictionary)
    evidence_set: Set[str] = set()
    for slot in clusters.values():
        for ev in slot.get("evidence") or []:
            evidence_set.add(normalize_phrase(str(ev)))

    # 1) Exact: phrase is in profile slots or literally present as evidence / in blob
    if n in exact or n in evidence_set or (len(n) >= 4 and n in blob):
        return {
            "skill": skill,
            "normalized": n,
            "tier": "exact",
            "cluster": cluster_for_phrase(n),
            "evidence": [n],
        }

    # 2) Synonym cluster: vacancy maps to a cluster that resume has evidence for
    cid = cluster_for_phrase(n)
    if cid and cid in clusters:
        slot = clusters[cid]
        evidence = [normalize_phrase(str(e)) for e in (slot.get("evidence") or []) if str(e).strip()]
        evidence = [e for e in evidence if e and e != n]
        # Prefer readable skill phrases over bare acronyms in rationale
        evidence = sorted(evidence, key=lambda e: (0 if (" " in e or len(e) > 5) else 1, -len(e), e))[:6]
        if not evidence:
            evidence = [normalize_phrase(str(e)) for e in (slot.get("evidence") or [])[:3]]
        return {
            "skill": skill,
            "normalized": n,
            "tier": "synonym",
            "cluster": cid,
            "evidence": evidence[:5],
        }

    # 2b) Marketing family: sibling cluster has evidence (HH phrasing vs Growth CV)
    if cid and cid in _MARKETING_FAMILY:
        family_hits = [c for c in _MARKETING_FAMILY if c in clusters]
        if family_hits:
            evidence: List[str] = []
            for fc in family_hits:
                for e in (clusters[fc].get("evidence") or [])[:4]:
                    en = normalize_phrase(str(e))
                    if en and en not in evidence:
                        evidence.append(en)
            return {
                "skill": skill,
                "normalized": n,
                "tier": "synonym",
                "cluster": cid,
                "evidence": evidence[:5] or [family_hits[0]],
            }

    # 3) Fuzzy / token overlap vs evidence + profile terms (not full synonym dump)
    compare_pool = exact | evidence_set
    best_alias = ""
    best_ratio = 0.0
    for alias in list(compare_pool)[:240]:
        if abs(len(alias) - len(n)) > max(12, len(n)):
            continue
        ratio = _fuzzy_ratio(n, alias)
        if ratio > best_ratio:
            best_ratio = ratio
            best_alias = alias
    if best_ratio >= 0.78 and best_alias:
        return {
            "skill": skill,
            "normalized": n,
            "tier": "fuzzy",
            "cluster": cluster_for_phrase(best_alias) or cid,
            "evidence": [best_alias],
        }

    toks = tokenize(n)
    if toks and blob:
        hit = sum(1 for t in toks if t in blob)
        if hit / max(len(toks), 1) >= 0.7 and hit >= 2:
            return {
                "skill": skill,
                "normalized": n,
                "tier": "token",
                "cluster": cid,
                "evidence": sorted(toks)[:5],
            }

    alias_set = {normalize_phrase(a) for a in (grid.get("aliases") or [])}
    if _phrase_in_blob(n, blob, alias_set | exact | evidence_set):
        return {
            "skill": skill,
            "normalized": n,
            "tier": "blob",
            "cluster": cid,
            "evidence": [n],
        }

    return None


def match_skills(
    vacancy_skills: Iterable[str],
    grid: Dict[str, Any],
    *,
    resume_blob: str = "",
    resume_exact: Optional[Iterable[str]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    exact = {normalize_phrase(x) for x in (resume_exact or []) if normalize_phrase(x)}
    hits: List[Dict[str, Any]] = []
    miss: List[str] = []
    seen: Set[str] = set()
    for raw in vacancy_skills:
        s = str(raw or "").strip()
        if not s:
            continue
        key = normalize_phrase(s)
        if key in seen:
            continue
        seen.add(key)
        m = match_skill_against_grid(s, grid, resume_blob=resume_blob, resume_exact=exact)
        if m:
            hits.append(m)
        else:
            miss.append(s)
    return hits, miss


def format_semantic_hit(m: Dict[str, Any]) -> str:
    skill = str(m.get("skill") or "")
    evidence = [str(e) for e in (m.get("evidence") or []) if str(e).strip()][:4]
    tier = str(m.get("tier") or "")
    if tier == "exact":
        return skill
    if evidence:
        ev = ", ".join(evidence)
        return f"{skill} <- {ev}"
    return skill


def semantic_matched_lines(hits: Sequence[Dict[str, Any]], *, limit: int = 10) -> List[str]:
    semantic = [h for h in hits if h.get("tier") and h.get("tier") != "exact"]
    if not semantic:
        return []
    bits = [format_semantic_hit(h) for h in semantic[:limit]]
    return [f"Совпало (семантика): {', '.join(bits)}"]


def grid_tags_compact(grid: Dict[str, Any], *, max_tags: int = 16) -> List[str]:
    """Compact tags for knowledge item / workspace meta (jr_semantic_grid:*)."""
    tags = ["jr_semantic_grid"]
    for cid in list((grid.get("clusters") or {}).keys())[:12]:
        tags.append(f"jr_sg:{cid}"[:40])
    return tags[:max_tags]
