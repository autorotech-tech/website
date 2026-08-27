"""CRAG-lite: deterministic grade + heuristic faith + optional refine for generate."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Set

from job_responder_format import strip_embellished_language_claims
from job_responder_semantic import build_semantic_grid, match_skills, normalize_phrase

# Critique+refine only when wall-clock still has real headroom under CF soft budget.
CRAG_REFINE_MIN_BUDGET_SEC = 10.0
CRAG_CRITIQUE_MIN_BUDGET_SEC = 14.0
CRAG_REFINE_CAP_SEC = 8.0
CRAG_CRITIQUE_MAX_TOKENS = 120
CRAG_REFINE_MAX_TOKENS = 550


def should_run_crag_refine(
    *,
    has_text: bool,
    mode: str,
    profile_compressed: bool,
    remaining_sec: float,
    faith_failures: Optional[Sequence[str]] = None,
) -> bool:
    """Gate LLM critique/refine so it cannot starve the draft under CF soft timeout."""
    if not has_text or mode != "cover_letter":
        return False
    if profile_compressed:
        return False
    if not is_crag_lite_enabled():
        return False
    if remaining_sec < CRAG_REFINE_MIN_BUDGET_SEC:
        return False
    if faith_failures is not None and not faith_failures:
        return False
    return True


def should_run_crag_critique(remaining_sec: float) -> bool:
    return remaining_sec >= CRAG_CRITIQUE_MIN_BUDGET_SEC

Label = str  # Correct | Ambiguous | Incorrect


def _resume_blob(profile: Dict[str, Any]) -> str:
    blob = str(profile.get("_text_blob") or "")
    if blob:
        return blob.lower()
    return " ".join(
        [
            " ".join(profile.get("skills") or []),
            " ".join(profile.get("tools") or []),
            " ".join(profile.get("experience_bullets") or []),
            " ".join(str(t) for t in (profile.get("source_titles") or [])),
        ]
    ).lower()


def _resume_exact(profile: Dict[str, Any]) -> Set[str]:
    parts: Set[str] = set()
    for key in ("skills", "tools", "roles", "domains"):
        for item in profile.get(key) or []:
            n = normalize_phrase(str(item))
            if n:
                parts.add(n)
    return parts


def grade_jd_requirements(
    vacancy_skills: Sequence[str],
    merged_profile: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Map JD skills/tools to Correct / Ambiguous / Incorrect (no LLM)."""
    grid = merged_profile.get("jr_semantic_grid")
    if not isinstance(grid, dict) or not grid.get("clusters"):
        grid = build_semantic_grid(merged_profile)
    skills = [str(s).strip() for s in vacancy_skills if str(s or "").strip()]
    if not skills:
        return []
    hits, misses = match_skills(
        skills,
        grid,
        resume_blob=_resume_blob(merged_profile),
        resume_exact=_resume_exact(merged_profile),
    )
    grades: List[Dict[str, Any]] = []
    for hit in hits:
        tier = str(hit.get("tier") or "exact")
        label: Label = "Correct" if tier == "exact" else "Ambiguous"
        grades.append(
            {
                "skill": str(hit.get("skill") or ""),
                "label": label,
                "tier": tier,
                "evidence": list(hit.get("evidence") or [])[:3],
            }
        )
    for miss in misses:
        grades.append({"skill": miss, "label": "Incorrect", "tier": None, "evidence": []})
    return grades


def build_crag_hints(grades: Sequence[Dict[str, Any]], *, domain_pin: Optional[Dict[str, Any]] = None) -> str:
    """Prompt block injected before draft generate."""
    if not grades and not (domain_pin or {}).get("pinned_bullets"):
        return ""
    lines = [
        "CRAG GRADE (facts only; Incorrect = skip OR 1 bullet with named profile fact "
        "- no vague transferable fluff, no invented KPI). "
        "Accent industry/domain experience when domains_matched / pin facts exist:"
    ]
    by_label: Dict[str, List[str]] = {"Correct": [], "Ambiguous": [], "Incorrect": []}
    for g in grades:
        label = str(g.get("label") or "")
        skill = str(g.get("skill") or "").strip()
        if not skill or label not in by_label:
            continue
        ev = g.get("evidence") or []
        if label == "Ambiguous" and ev:
            by_label[label].append(f"{skill} (смежный: {', '.join(str(e) for e in ev[:2])})")
        else:
            by_label[label].append(skill)
    for label in ("Correct", "Ambiguous", "Incorrect"):
        if by_label[label]:
            lines.append(f"- {label}: " + "; ".join(by_label[label][:12]))
    matched = list((domain_pin or {}).get("domains_matched") or [])[:6]
    if matched:
        lines.append(
            "- Industry accent (обязательно): отраслевой опыт по "
            + ", ".join(str(d) for d in matched)
            + " - только с фактами из pin/profile"
        )
    pinned = list((domain_pin or {}).get("pinned_bullets") or [])[:3]
    if pinned:
        lines.append("- Domain pin (обязательный факт): " + " | ".join(pinned))
    return "\n".join(lines)


def _skill_in_text(skill: str, text: str) -> bool:
    s = normalize_phrase(skill)
    if not s:
        return False
    low = text.lower()
    if s in low:
        return True
    # Word-boundary for short tokens (SQL, PLG)
    if len(s) <= 6:
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(s)}(?![a-z0-9])", low))
    return s.replace(" ", "") in low.replace(" ", "")


def faith_check_failures(
    letter: str,
    profile_blob: str,
    grades: Sequence[Dict[str, Any]],
    *,
    vacancy_domains: Optional[Sequence[str]] = None,
    domains_matched: Optional[Sequence[str]] = None,
) -> List[str]:
    """Heuristic ungrounded-claim detector (post-draft)."""
    failures: List[str] = []
    body = letter or ""
    low = body.lower()
    for g in grades:
        if str(g.get("label")) != "Incorrect":
            continue
        skill = str(g.get("skill") or "")
        if skill and _skill_in_text(skill, body):
            failures.append(f"ungrounded_skill:{skill}")
    _, emb_fixes = strip_embellished_language_claims(body, profile_blob)
    if emb_fixes:
        failures.append("embellished_language")
    vac_dom = [str(d).lower() for d in (vacancy_domains or []) if str(d).strip()]
    matched_dom = [str(d).lower() for d in (domains_matched or []) if str(d).strip()]
    if vac_dom and matched_dom:
        dom_ok = any(d in low for d in matched_dom) or any(d in low for d in vac_dom)
        if not dom_ok:
            failures.append(f"missing_domain:{vac_dom[0]}")
    return failures


def build_critique_user_prompt(draft: str, failures: Sequence[str], profile_compact: str) -> str:
    return (
        "List 1-3 concrete fixes (RU). Drop vague transferable fluff without named profile facts. "
        "If domains_matched / industry facts exist in Profile - keep or add one industry bullet with real names/metrics. "
        "Issues:\n"
        + "\n".join(f"- {f}" for f in failures)
        + f"\n\nProfile (facts only):\n{(profile_compact or '')[:2200]}\n\nDraft:\n{draft[:3500]}"
    )


def build_refine_user_prompt(
    draft: str,
    critique: str,
    profile_compact: str,
    crag_hints: str = "",
) -> str:
    parts = [
        "Fix the cover letter. Remove ungrounded claims and vague transferable fluff. "
        "Keep only bullets with named facts from Profile (tools/products/metrics). "
        "Emphasize industry/domain experience when Profile has domains_matched / industry_experience / matched projects. "
        "Keep HH structure. Output full letter only.",
        f"Issues/fixes:\n{critique.strip()}",
    ]
    if crag_hints.strip():
        parts.append(crag_hints.strip())
    parts.append(f"Profile:\n{(profile_compact or '')[:2200]}")
    parts.append(f"Draft:\n{draft[:3500]}")
    return "\n\n".join(parts)


def is_crag_lite_enabled() -> bool:
    import os

    return os.environ.get("JOB_RESPONDER_CRAG_LITE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
