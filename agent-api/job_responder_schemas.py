"""Thin ATS contract schemas for Autoro Hunt (generate + future recruiter reverse).

Maps Senior AI/ML ATS brief stages 2–3 (NER → taxonomy profile) onto existing
compact profile / evidence_units without heavy spaCy on the CF hot path.

Shared by:
- cover-letter generate (CandidateProfile ↔ merged dict)
- recruiter reverse search (same shape; query = JobDescription, corpus = profiles)
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PersonalInfo(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)
    email: Optional[str] = Field(default=None, max_length=200)
    telegram: Optional[str] = Field(default=None, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=80)
    location: Optional[str] = Field(default=None, max_length=200)
    links: List[Dict[str, str]] = Field(default_factory=list)


class ExperienceItem(BaseModel):
    title_raw: str = Field(..., min_length=1, max_length=300)
    title_normalized: Optional[str] = Field(default=None, max_length=300)
    company: Optional[str] = Field(default=None, max_length=200)
    unit_type: str = Field(default="job", max_length=32)
    evidence: Optional[str] = Field(default=None, max_length=800)
    domains: List[str] = Field(default_factory=list)


class EducationItem(BaseModel):
    raw: str = Field(..., min_length=1, max_length=400)
    normalized: Optional[str] = Field(default=None, max_length=400)


class SkillItem(BaseModel):
    skill_raw: str = Field(..., min_length=1, max_length=200)
    esco_id: Optional[str] = Field(default=None, max_length=64)
    onet_element: Optional[str] = Field(default=None, max_length=64)
    weight: float = Field(default=1.0, ge=0.0, le=1.0)


class CandidateProfile(BaseModel):
    """ATS-shaped profile JSON (Alonso/Kumar-style normalized resume)."""

    personal_info: PersonalInfo = Field(default_factory=PersonalInfo)
    experience: List[ExperienceItem] = Field(default_factory=list)
    education: List[EducationItem] = Field(default_factory=list)
    skills: List[SkillItem] = Field(default_factory=list)
    tools: List[str] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)
    languages: List[str] = Field(default_factory=list)
    evidence_units: List[Dict[str, str]] = Field(default_factory=list)
    seniority: Optional[str] = Field(default=None, max_length=100)
    source_count: int = Field(default=0, ge=0)


class JobDescription(BaseModel):
    """Normalized JD for ranking / generate retrieve (stage 4–5 query side)."""

    title: str = Field(..., min_length=1, max_length=1000)
    company: Optional[str] = Field(default=None, max_length=500)
    description: str = Field(default="", max_length=50000)
    key_skills: List[str] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)
    seniority: Optional[str] = Field(default=None, max_length=100)
    work_format: Optional[str] = Field(default=None, max_length=200)
    url: Optional[str] = Field(default=None, max_length=4000)


def _esco_lookup_map() -> Dict[str, Dict[str, Optional[str]]]:
    """Label → {esco_id, onet_element} from skill-synonyms (nullable stubs OK)."""
    try:
        from job_responder_semantic import load_skill_synonyms
    except Exception:
        return {}
    out: Dict[str, Dict[str, Optional[str]]] = {}
    try:
        doc = load_skill_synonyms() or {}
        nodes = doc.get("nodes") or []
    except Exception:
        return {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        esco = node.get("esco_id")
        onet = node.get("onet_element")
        for lab in node.get("labels") or []:
            key = str(lab or "").strip().lower()
            if key:
                out[key] = {
                    "esco_id": str(esco) if esco else None,
                    "onet_element": str(onet) if onet else None,
                }
    return out


def merged_profile_to_candidate(profile: Dict[str, Any]) -> CandidateProfile:
    """Lift Autoro Hunt merged compact dict → CandidateProfile contract."""
    esco_map = _esco_lookup_map()
    skills: List[SkillItem] = []
    seen: set = set()
    for raw in list(profile.get("skills") or [])[:40]:
        s = str(raw or "").strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        meta = esco_map.get(key) or {}
        skills.append(
            SkillItem(
                skill_raw=s[:200],
                esco_id=meta.get("esco_id"),
                onet_element=meta.get("onet_element"),
                weight=1.0,
            )
        )

    experience: List[ExperienceItem] = []
    for eu in list(profile.get("evidence_units") or [])[:24]:
        if not isinstance(eu, dict):
            continue
        title = str(eu.get("title") or eu.get("content") or eu.get("evidence") or "").strip()
        if not title:
            continue
        experience.append(
            ExperienceItem(
                title_raw=title[:300],
                title_normalized=None,
                company=None,
                unit_type=str(eu.get("unit_type") or "job")[:32],
                evidence=str(eu.get("evidence") or eu.get("content") or "")[:800] or None,
                domains=[],
            )
        )
    if not experience:
        for b in list(profile.get("experience_bullets") or [])[:16]:
            bit = str(b or "").strip()
            if bit:
                experience.append(
                    ExperienceItem(
                        title_raw=bit[:300],
                        unit_type="job",
                        evidence=bit[:800],
                    )
                )

    education = [
        EducationItem(raw=str(e)[:400])
        for e in (profile.get("education") or [])
        if str(e or "").strip()
    ][:8]

    contacts = profile.get("contact_overrides") or []
    personal = PersonalInfo(
        email=str(profile.get("email") or "")[:200] or None,
        telegram=str(profile.get("telegram") or "")[:120] or None,
        links=[
            {"url": str(lk.get("url") or ""), "title": str(lk.get("title") or "")}
            for lk in (profile.get("links") or [])
            if isinstance(lk, dict) and lk.get("url")
        ][:12],
    )
    if contacts and not personal.telegram:
        for c in contacts:
            cs = str(c)
            if "@" in cs and "telegram" in cs.lower():
                personal.telegram = cs.split(":")[-1].strip()[:120]
                break

    return CandidateProfile(
        personal_info=personal,
        experience=experience,
        education=education,
        skills=skills,
        tools=[str(t) for t in (profile.get("tools") or [])[:36]],
        domains=[str(d) for d in (profile.get("domains") or [])[:20]],
        languages=[str(x) for x in (profile.get("languages") or [])[:10]],
        evidence_units=[
            eu
            for eu in (profile.get("evidence_units") or [])
            if isinstance(eu, dict)
        ][:24],
        seniority=str(profile.get("seniority") or "")[:100] or None,
        source_count=int(profile.get("source_count") or 0),
    )


def vacancy_to_job_description(
    *,
    title: str,
    company: Optional[str] = None,
    description: str = "",
    key_skills: Optional[List[str]] = None,
    domains: Optional[List[str]] = None,
    seniority: Optional[str] = None,
    work_format: Optional[str] = None,
    url: Optional[str] = None,
) -> JobDescription:
    return JobDescription(
        title=(title or "")[:1000] or "vacancy",
        company=(company or None),
        description=(description or "")[:50000],
        key_skills=[str(s) for s in (key_skills or []) if str(s).strip()][:40],
        domains=[str(d) for d in (domains or []) if str(d).strip()][:20],
        seniority=seniority,
        work_format=work_format,
        url=url,
    )
