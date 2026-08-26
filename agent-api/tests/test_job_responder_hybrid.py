"""Tests for BM25 + dense RRF hybrid relevance merge."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import JobResponderVacancyPayload, merge_profiles_from_rows, score_resume_vs_vacancy
from job_responder_hybrid import (
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


def test_tokenize_bm25_strips_stopwords():
    toks = tokenize_bm25("Skills: marketing and google ads")
    assert "marketing" in toks
    assert "and" not in toks
