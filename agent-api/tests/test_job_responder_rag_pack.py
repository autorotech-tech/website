"""Tests for generate RAG context pack + ATS CandidateProfile schema."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import build_user_prompt, JobResponderVacancyPayload
from job_responder_rag_pack import (
    build_jd_query,
    build_rag_context_pack,
    format_rag_evidence_block,
    rank_evidence_units_for_jd,
)
from job_responder_schemas import (
    CandidateProfile,
    JobDescription,
    SkillItem,
    merged_profile_to_candidate,
    vacancy_to_job_description,
)


def test_rank_skips_json_profile_noise():
    units = [
        {
            "unit_type": "job",
            "title": "noise",
            "evidence": '{"skills":[],"roles":["developer"],"domains":["content"]}',
        },
        {
            "unit_type": "project",
            "title": "pquoc",
            "evidence": "project: tourism Phu Quoc Meta Ads ROAS growth",
        },
    ]
    ranked = rank_evidence_units_for_jd(
        units,
        "tourism Meta Ads ROAS",
        top_k=3,
    )
    assert len(ranked) == 1
    assert "tourism" in (ranked[0].get("evidence") or "").lower()


def test_rank_evidence_prefers_jd_overlap():
    units = [
        {
            "unit_type": "job",
            "title": "Kitchen",
            "evidence": "job: cooked pasta recipes daily",
        },
        {
            "unit_type": "project",
            "title": "pquoc",
            "evidence": "project: tourism Phu Quoc Meta Ads ROAS growth",
        },
        {
            "unit_type": "job",
            "title": "Unrelated",
            "evidence": "job: warehouse logistics forklift",
        },
    ]
    ranked = rank_evidence_units_for_jd(
        units,
        "Head of Marketing tourism Meta Ads ROAS travel",
        top_k=2,
    )
    assert ranked
    assert ranked[0]["rank"] == 1
    hay = (ranked[0].get("evidence") or "").lower()
    assert "tourism" in hay or "roas" in hay or "meta" in hay


def test_build_rag_context_pack_includes_pins_and_languages():
    profile = {
        "skills": ["google ads", "seo"],
        "tools": ["n8n", "ga4"],
        "languages": ["ru", "en"],
        "evidence_units": [
            {
                "unit_type": "job",
                "title": "Elbrus",
                "evidence": "job: Elbrus Travel tourism marketing Google Ads",
            }
        ],
        "experience_bullets": [],
        "projects": [],
    }
    pack = build_rag_context_pack(
        profile,
        title="Marketing lead tourism",
        description="Need Google Ads and travel performance marketer",
        key_skills=["google ads", "n8n"],
        vacancy_domains=["tourism"],
        domain_pin={
            "domains_matched": ["tourism"],
            "pinned_bullets": ["pquoc.com tourism funnel"],
        },
        tool_pin={"tools_matched": ["n8n"]},
        top_k=5,
    )
    assert pack["evidence_count"] >= 1
    assert "n8n" in pack["tools_matched"]
    assert "tourism" in pack["domains_matched"]
    assert "ru" in pack["languages"]
    block = format_rag_evidence_block(pack)
    assert "RESUME EVIDENCE" in block
    assert "TOOL PIN" in block
    assert "TOP EVIDENCE" in block


def test_user_prompt_includes_rag_evidence_block():
    vac = JobResponderVacancyPayload(
        title="n8n engineer",
        description="Automate workflows with n8n and Python",
    )
    prompt = build_user_prompt(
        vac,
        "skills: n8n, python",
        "cover_letter",
        "web",
        rag_evidence="RESUME EVIDENCE (ranked for this JD; cite named facts only):\n- TOOL PIN: n8n",
    )
    assert "RESUME CONTEXT:" in prompt
    assert "RESUME EVIDENCE" in prompt
    assert "TOOL PIN: n8n" in prompt


def test_candidate_profile_schema_from_merged():
    profile = {
        "skills": ["Google Ads", "SEO"],
        "tools": ["GA4"],
        "domains": ["tourism"],
        "languages": ["en"],
        "education": ["BS CS"],
        "evidence_units": [
            {
                "unit_type": "job",
                "title": "Marketer",
                "evidence": "job: performance marketing tourism",
                "content": "performance marketing tourism",
            }
        ],
        "links": [{"url": "https://autoro.tech", "title": "site"}],
        "source_count": 3,
        "seniority": "mid",
    }
    cand = merged_profile_to_candidate(profile)
    assert isinstance(cand, CandidateProfile)
    assert cand.source_count == 3
    assert any(isinstance(s, SkillItem) and s.skill_raw.lower() == "google ads" for s in cand.skills)
    assert cand.experience
    assert cand.experience[0].title_raw
    dumped = cand.model_dump()
    assert "personal_info" in dumped
    assert "skills" in dumped


def test_job_description_contract():
    jd = vacancy_to_job_description(
        title="DBA",
        description="PostgreSQL DBA needed",
        key_skills=["PostgreSQL", "SQL"],
        domains=["saas"],
    )
    assert isinstance(jd, JobDescription)
    assert "PostgreSQL" in jd.key_skills
    assert build_jd_query(title=jd.title, key_skills=jd.key_skills, description=jd.description)
