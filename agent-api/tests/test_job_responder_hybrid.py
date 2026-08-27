"""Tests for BM25 + dense RRF hybrid relevance merge."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import JobResponderVacancyPayload, merge_profiles_from_rows, score_resume_vs_vacancy
from job_responder_hybrid import (
    absolute_match_quality,
    bm25_scores,
    hybrid_relevance_base,
    rank_indices,
    reciprocal_rank_fusion,
    tokenize_bm25,
)


def test_rrf_fusion_prefers_consensus_top_rank():
    bm25_rank = [2, 0, 1]
    dense_rank = [2, 1, 0]
    fused = reciprocal_rank_fusion([bm25_rank, dense_rank], k=60, n_docs=3)
    assert fused[2] > fused[0]
    assert fused[2] > fused[1]


def test_bm25_ranks_matching_doc_higher():
    docs = [
        "quantum physics lattice models",
        "performance marketing google ads roas tourism phu quoc",
        "unrelated cooking recipes",
    ]
    query = "performance marketing google ads tourism"
    scores = bm25_scores(query, docs)
    order = rank_indices(scores)
    assert order[0] == 1


def test_hybrid_base_uses_evidence_units():
    profile = {
        "skills": ["google ads", "seo"],
        "tools": ["ga4"],
        "evidence_units": [
            {
                "unit_type": "job",
                "evidence": "job: Elbrus Travel - tourism marketing ROAS growth",
            }
        ],
        "experience_bullets": ["job: Elbrus Travel - tourism marketing ROAS growth"],
        "_text_blob": "tourism marketing google ads",
        "source_count": 1,
    }
    base, meta = hybrid_relevance_base(
        "Head of Marketing tourism travel google ads",
        profile,
        [],
    )
    assert base > 0
    assert meta.get("chunkCount", 0) >= 1
    assert "quality" in meta
    # Quality-gated: must not auto-hit former 70 ceiling on thin corpus
    assert base <= 48.0


def test_absolute_quality_weak_overlap_stays_low():
    q = absolute_match_quality(0.4, 0.05, query_token_count=12)
    assert q < 0.35


def test_score_resume_includes_score_breakdown():
    rows = [
        {
            "id": 1,
            "kind": "job_resume",
            "title": "CV",
            "content_text": (
                "Skills: GA4, Google Ads, performance marketing\n"
                "Опыт: tourism GTM pquoc.com Phu Quoc 785 hotels ROAS\n"
            ),
            "category": "cv",
            "updated_at": "1",
        }
    ]
    merged = merge_profiles_from_rows(rows)
    vac = JobResponderVacancyPayload(
        title="Head of Marketing",
        description="Tourism travel marketing Google Ads performance",
        structured={"keySkills": ["marketing", "google ads", "tourism"]},
    )
    out = score_resume_vs_vacancy(vac, rows, merged_profile=merged)
    assert "scoreBreakdown" in out
    assert "rrf" in out["scoreBreakdown"]
    assert out["score"] >= 0
    assert out["score"] <= 100


def _marketing_resume_rows():
    return [
        {
            "id": 1,
            "kind": "job_resume",
            "title": "CV Growth Marketing",
            "content_text": (
                "Skills: Growth Marketing, Performance Marketing, PPC, SEO, CRM, Google Ads, GA4. "
                "Domains: tourism, travel, e-commerce. "
                "Project pquoc.com Phu Quoc 785 hotels ROAS GMV. Remote. "
                "Roles: Head of Marketing, performance marketer."
            ),
            "category": "cv",
            "updated_at": "1",
        }
    ]


def test_score_bands_strong_vs_weak_title_vs_wrong_domain():
    """Unbiased bands: strong can be high; title-only <70; wrong-domain <50."""
    rows = _marketing_resume_rows()
    merged = merge_profiles_from_rows(rows)

    strong = score_resume_vs_vacancy(
        JobResponderVacancyPayload(
            title="Head of Marketing / Performance",
            description=(
                "Туризм travel hospitality. Performance marketing, Google Ads, SEO, GA4, ROAS. "
                "Удалённо. Опыт в tourism / travel обязателен."
            ),
            structured={
                "keySkills": [
                    "performance marketing",
                    "google ads",
                    "seo",
                    "ga4",
                    "tourism",
                ],
                "workFormat": "удалённо",
            },
        ),
        rows,
        merged_profile=merged,
    )

    weak_title = score_resume_vs_vacancy(
        JobResponderVacancyPayload(
            title="MVP Product Owner",
            description="Remote. Looking for someone who likes products and startups.",
            structured={"keySkills": ["mvp", "product ownership"], "workFormat": "удалённо"},
        ),
        rows,
        merged_profile=merged,
    )

    wrong = score_resume_vs_vacancy(
        JobResponderVacancyPayload(
            title="Senior LLM Research Engineer",
            description=(
                "PyTorch transformers CUDA kernel research. PhD preferred. "
                "Remote. No marketing. Model training and evaluation."
            ),
            structured={
                "keySkills": ["pytorch", "cuda", "transformers", "llm research"],
                "workFormat": "удалённо",
            },
        ),
        rows,
        merged_profile=merged,
    )

    assert strong["score"] > weak_title["score"]
    assert strong["score"] > wrong["score"]
    # Soft signals (remote / vague title) must not land in 90–100
    assert weak_title["score"] < 70, weak_title
    assert wrong["score"] < 50, wrong
    # Strong match can be high, but not auto-100 on soft stack alone
    assert strong["score"] >= 55, strong
    assert strong["score"] < 100, strong
    assert strong["scoreBreakdown"]["rrf"] <= 48


def test_tokenize_bm25_strips_stopwords():
    toks = tokenize_bm25("Skills: marketing and google ads")
    assert "marketing" in toks
    assert "and" not in toks
