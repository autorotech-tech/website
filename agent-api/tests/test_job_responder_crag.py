"""Unit tests for CRAG-lite grading and faith heuristics (no LLM)."""

from __future__ import annotations

import job_responder_crag as crag
from job_responder_semantic import build_semantic_grid


def _marketing_profile() -> dict:
    profile = {
        "skills": ["performance marketing", "Meta Ads", "Google Ads", "ROAS"],
        "tools": ["Meta Ads", "Looker Studio"],
        "domains": ["tourism"],
        "domains_matched": ["tourism"],
        "experience_bullets": ["Tourism funnel ROAS x2"],
    }
    profile["jr_semantic_grid"] = build_semantic_grid(profile)
    return profile


def _ai_builder_profile() -> dict:
    profile = {
        "skills": ["Product Manager", "MVP", "Cursor", "Antigravity"],
        "tools": ["Cursor", "Antigravity", "n8n", "Supabase"],
        "domains": ["ai", "saas"],
        "experience_bullets": [
            "Пишу прототипы и решения в Cursor, Antigravity",
            "MVP на Supabase + n8n",
        ],
        "_text_blob": "Cursor Antigravity n8n Supabase AI Product Builder MVP",
    }
    profile["jr_semantic_grid"] = build_semantic_grid(profile)
    return profile


def test_grade_jd_requirements_correct_and_incorrect():
    profile = _marketing_profile()
    grades = crag.grade_jd_requirements(["Meta Ads", "Airflow"], profile)
    by_skill = {g["skill"]: g["label"] for g in grades}
    assert by_skill.get("Meta Ads") == "Correct"
    assert by_skill.get("Airflow") == "Incorrect"


def test_build_crag_hints_lists_labels():
    grades = [
        {"skill": "Meta Ads", "label": "Correct", "evidence": []},
        {"skill": "Airflow", "label": "Incorrect", "evidence": []},
    ]
    hints = crag.build_crag_hints(grades, domain_pin={"pinned_bullets": ["pquoc.com ROAS"]})
    assert "Correct: Meta Ads" in hints
    assert "Incorrect: Airflow" in hints
    assert "pquoc.com" in hints


def test_pin_matched_tools_cursor_antigravity():
    """JD∩profile tools (Cursor, Antigravity) must surface in pin + CRAG hints."""
    profile = _ai_builder_profile()
    jd_skills = [
        "Cursor",
        "Claude Code",
        "Codex",
        "Lovable",
        "Replit",
        "Bolt",
        "Antigravity",
    ]
    grades = crag.grade_jd_requirements(jd_skills, profile)
    pin = crag.pin_matched_tools(jd_skills, profile, grades=grades)
    matched_low = {t.lower() for t in pin["tools_matched"]}
    assert "cursor" in matched_low
    assert "antigravity" in matched_low
    # Must not invent Lovable when absent from profile
    assert "lovable" not in matched_low
    hints = crag.build_crag_hints(grades, tool_pin=pin)
    assert "TOOL PIN" in hints
    assert "Cursor" in hints
    assert "Antigravity" in hints


def test_faith_check_detects_missing_pinned_tool():
    failures = crag.faith_check_failures(
        "1. **MVP** - запускал продукты с нуля.",
        "tools: Cursor, Antigravity",
        [],
        tools_matched=["Cursor", "Antigravity"],
    )
    assert "missing_tool:Cursor" in failures
    assert "missing_tool:Antigravity" in failures


def test_faith_check_detects_ungrounded_skill():
    profile = _marketing_profile()
    grades = crag.grade_jd_requirements(["Airflow"], profile)
    failures = crag.faith_check_failures(
        "1. **Airflow pipelines** - built daily DAGs.",
        "skills: Meta Ads",
        grades,
    )
    assert any(f.startswith("ungrounded_skill:") for f in failures)


def test_faith_check_requires_domain_when_matched():
    failures = crag.faith_check_failures(
        "1. **Meta Ads** - campaigns only.",
        "skills: Meta Ads",
        [],
        vacancy_domains=["tourism"],
        domains_matched=["tourism"],
    )
    assert any(f.startswith("missing_domain:") for f in failures)


def test_is_crag_lite_enabled_default():
    assert crag.is_crag_lite_enabled() is True
