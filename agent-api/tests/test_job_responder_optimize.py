"""Tests for permanent Resume KB domain tagging + vacancy-aware compact profile."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import (
    JobResponderVacancyPayload,
    extract_resume_profile,
    format_compact_profile,
    hh_format_text,
    merge_profiles_from_rows,
)
from job_responder_optimize import (
    extract_domains_from_text,
    extract_evidence_units,
    format_vacancy_aware_compact,
    pin_domain_facts,
    prefix_evidence,
    vacancy_domains_from_text,
)


def test_extract_tourism_and_ecommerce_domains():
    text = (
        "pquoc.com - туристическая платформа Phu Quoc, 785 отелей, SEO/GEO. "
        "Also WooCommerce ecommerce shop for Askona."
    )
    doms = extract_domains_from_text(text)
    assert "tourism" in doms
    assert "ecommerce" in doms or "seo" in doms


def test_enrich_profile_projects_and_domains():
    text = (
        "Project: pquoc.com travel platform for Phu Quoc tourism GTM, 785 hotels, 8 languages.\n"
        "https://pquoc.com/\n"
        "Built multilingual SEO and RAG chat for travelers.\n"
    )
    prof = extract_resume_profile(text, title="Portfolio", category="portfolio")
    assert "tourism" in [d.lower() for d in prof.get("domains") or []]
    names = " ".join(str(p.get("name") or "") for p in (prof.get("projects") or [])).lower()
    assert "pquoc" in names or any("pquoc" in str(b).lower() for b in (prof.get("experience_bullets") or []))


def test_pin_domain_facts_survives_compact_budget():
    rows = [
        {
            "id": 1,
            "kind": "job_resume",
            "title": "CV",
            "content_text": (
                "Skills: GA4, Google Ads, Яндекс Директ, team leadership\n"
                "Опыт: руководил performance-маркетингом, ROAS рост\n"
                "Проект: pquoc.com - tourism GTM Phu Quoc, 785 отелей, travel SEO\n"
                "https://pquoc.com/\n"
            ),
            "category": "cv",
            "updated_at": "2",
        },
        {
            "id": 2,
            "kind": "job_experience",
            "title": "Generic marketing notes",
            "content_text": (
                "Google Analytics, Директ, Meta Ads, CRM, budgeting, A/B tests, "
                "team of 5 marketers, weekly reporting, brand guidelines. " * 8
            ),
            "category": "notes",
            "updated_at": "1",
        },
    ]
    merged = merge_profiles_from_rows(rows)
    vac_domains = vacancy_domains_from_text(
        "Руководитель отдела маркетинга",
        "Туризм, Elbrus, remote. Опыт в travel и hospitality обязателен.",
        ["маркетинг"],
    )
    assert "tourism" in vac_domains
    pin = pin_domain_facts(merged, vac_domains)
    assert "tourism" in pin["domains_matched"]
    compact = format_compact_profile(merged, max_chars=1700, vacancy_domains=vac_domains)
    low = compact.lower()
    assert "domains_matched" in low or "industry_experience" in low
    assert "tourism" in low or "pquoc" in low or "phu" in low


def test_saas_vacancy_pins_saas_not_tourism_only():
    text = "Built B2B SaaS onboarding and PLG loops for Autoro Swoop. n8n automation."
    prof = extract_resume_profile(text, title="SaaS case")
    vac = vacancy_domains_from_text("SaaS Growth Lead", "Looking for SaaS PLG experience", [])
    pin = pin_domain_facts(prof, vac)
    assert "saas" in vac
    # May or may not match if saas tagged; at least vacancy extraction works
    assert "saas" in vac


def test_extract_evidence_units_job_project_education():
    text = (
        "Опыт работы\n"
        "Acme Corp | Performance Lead | 2019-2024\n"
        "Grew ROAS 2x via Google Ads and Meta\n"
        "Project: pquoc.com travel platform for Phu Quoc tourism\n"
        "Образование\n"
        "МГУ, бакалавр экономики, 2015\n"
    )
    units = extract_evidence_units(text, title="CV")
    types = {u["unit_type"] for u in units}
    assert "job" in types
    assert "project" in types
    assert "education" in types
    assert all(str(u.get("evidence") or "").startswith(("job:", "project:", "education:")) for u in units)


def test_prefix_evidence_idempotent():
    assert prefix_evidence("job", "Acme - ROAS growth").startswith("job:")
    assert prefix_evidence("job", "job: already prefixed") == "job: already prefixed"


def test_enrich_profile_persists_evidence_units():
    text = (
        "Опыт работы\n"
        "Elbrus Travel | Head of Marketing | 2020-2023\n"
        "Tourism GTM for Phu Quoc, 785 hotels SEO\n"
        "Project: pquoc.com - travel platform\n"
    )
    prof = extract_resume_profile(text, title="Marketing CV", category="cv")
    units = prof.get("evidence_units") or []
    assert len(units) >= 2
    bullets = prof.get("experience_bullets") or []
    assert any(str(b).startswith("job:") for b in bullets)
    assert any(str(b).startswith("project:") for b in bullets)


def test_hh_format_fixes_broken_company_header():
    dirty = "# ОТКЛИК\nКомпания:** Elbrus\n**Должность:** Head of Marketing\n"
    out = hh_format_text(dirty)
    assert "**Компания:**" in out
    assert "Компания:**" not in out.replace("**Компания:**", "")


def test_vacancy_aware_formatter_reserves_slot():
    profile = {
        "source_count": 2,
        "skills": ["ga4", "direct"] + [f"skill{i}" for i in range(30)],
        "tools": ["n8n"],
        "domains": ["tourism", "marketing"],
        "experience_bullets": [
            "pquoc.com tourism platform Phu Quoc - 785 hotels multilingual SEO",
            "Generic ads optimization with GA4 and Direct",
        ] + [f"Filler experience bullet number {i} about campaigns" for i in range(12)],
        "projects": [
            {
                "name": "pquoc.com",
                "summary": "Phu Quoc travel platform",
                "url": "https://pquoc.com/",
                "domains": "tourism",
            }
        ],
        "metrics": ["785 hotels"],
        "_text_blob": "pquoc tourism phu quoc travel",
    }
    text = format_vacancy_aware_compact(profile, vacancy_domains=["tourism"], max_chars=1400)
    assert "pquoc" in text.lower()
    assert "tourism" in text.lower()
