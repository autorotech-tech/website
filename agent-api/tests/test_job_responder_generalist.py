"""Generalist / transferable relevance + effectiveness prompt defaults."""

from __future__ import annotations

import job_responder as jr
from job_responder import (
    DEFAULT_EFFECTIVENESS_EVAL_PROMPT,
    JobResponderVacancyPayload,
    attach_effectiveness_notes,
    build_effectiveness_notes,
    merge_profiles_from_rows,
    score_resume_vs_vacancy,
)


def _saas_adjacent_resume_rows():
    return [
        {
            "id": 1,
            "kind": "job_resume",
            "title": "CV Growth",
            "content_text": (
                "Skills: Growth Marketing, Performance Marketing, Google Ads, GA4, n8n, CRM. "
                "Built B2B SaaS onboarding and PLG loops for Autoro Swoop. "
                "Domains: tourism, e-commerce, saas. Remote. "
                "Roles: Head of Marketing, performance marketer."
            ),
            "category": "cv",
            "updated_at": "1",
        }
    ]


def test_default_effectiveness_prompt_nonempty_ru():
    assert "Оценщик эффективности" in DEFAULT_EFFECTIVENESS_EVAL_PROMPT
    assert "смежный профиль" in DEFAULT_EFFECTIVENESS_EVAL_PROMPT.lower()
    assert "PO/roadmap" in DEFAULT_EFFECTIVENESS_EVAL_PROMPT or "roadmap" in DEFAULT_EFFECTIVENESS_EVAL_PROMPT
    assert len(DEFAULT_EFFECTIVENESS_EVAL_PROMPT) > 200


def test_ultra_short_has_generalist_rule():
    assert "Специалист широкого профиля" in jr.ULTRA_SHORT_SYSTEM_PROMPT
    assert "11." in jr.ULTRA_SHORT_SYSTEM_PROMPT
    assert "адаптирует смежный опыт" in jr.ULTRA_SHORT_SYSTEM_PROMPT


def test_generalist_role_miss_midband_not_hard_zero():
    rows = _saas_adjacent_resume_rows()
    merged = merge_profiles_from_rows(rows)
    out = score_resume_vs_vacancy(
        JobResponderVacancyPayload(
            title="Product Owner / Roadmap Lead",
            description=(
                "B2B SaaS product ownership, roadmap, PLG. "
                "Growth marketing, Google Ads, CRM. Remote."
            ),
            structured={
                "keySkills": [
                    "product ownership",
                    "roadmap",
                    "b2b saas",
                    "growth marketing",
                    "google ads",
                ],
                "workFormat": "удалённо",
            },
        ),
        rows,
        merged_profile=merged,
    )
    assert out["score"] >= 42, out
    assert out.get("allow_transferable") or out.get("generalistProfile"), out
    blob = " ".join(out.get("rationale") or []).lower()
    assert "смежный профиль" in blob or "адаптац" in blob, out.get("rationale")
    missing_join = " ".join(out.get("missing") or []).lower()
    # Do not hard-miss B2B SaaS when present in resume blob
    assert "домены: b2b saas" not in missing_join or "saas" in " ".join(out.get("matched") or []).lower()


def test_saas_in_blob_not_listed_as_hard_missing_domain_only():
    rows = _saas_adjacent_resume_rows()
    merged = merge_profiles_from_rows(rows)
    out = score_resume_vs_vacancy(
        JobResponderVacancyPayload(
            title="SaaS Marketing Manager",
            description="B2B SaaS subscription PLG marketing Google Ads GA4",
            structured={"keySkills": ["b2b saas", "google ads", "ga4"]},
        ),
        rows,
        merged_profile=merged,
    )
    missing_join = " ".join(out.get("missing") or []).lower()
    # If domain soft-hit worked, "b2b saas" should not appear as bare hard miss alone
    if "домены:" in missing_join and "saas" in missing_join:
        assert out.get("generalistProfile") or any(
            "saas" in str(m).lower() for m in (out.get("matched") or [])
        ), out


def test_effectiveness_notes_heuristic_and_custom_prompt():
    scored = {
        "score": 55,
        "matched": ["Навыки: google ads"],
        "missing": ["Роль (точное название): product owner - смежный профиль"],
        "rationale": ["смежный профиль / адаптация опыта"],
        "generalistProfile": True,
        "allow_transferable": True,
    }
    notes = build_effectiveness_notes(scored)
    assert notes["source"] == "heuristic"
    assert notes["matched"]
    assert any("смежный" in a.lower() for a in notes["adaptability"])
    custom = "CUSTOM EFFECTIVENESS PROMPT XYZ"
    attached = attach_effectiveness_notes(scored, effectiveness_prompt=custom)
    assert attached["effectivenessPromptUsed"] is True
    assert attached["effectivenessNotes"]["promptChars"] == len(custom)
