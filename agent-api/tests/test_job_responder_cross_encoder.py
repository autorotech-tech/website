"""Tests for offline cross-encoder re-rank (deps optional)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder_cross_encoder import (
    blend_scores,
    ce_rerank_enabled,
    ce_status,
    normalize_ce_scores,
    profile_text_for_ce,
    rerank_vacancy_batch,
    sentence_transformers_available,
)


def test_ce_status_reports_flag_and_deps():
    st = ce_status()
    assert "enabledFlag" in st
    assert "depsAvailable" in st
    assert "model" in st
    assert st["model"]


def test_normalize_and_blend_without_model():
    norm = normalize_ce_scores([0.1, 0.9, 0.5])
    assert len(norm) == 3
    assert max(norm) == 1.0 or max(norm) <= 1.0
    blended = blend_scores([80, 40, 60], [0.1, 0.9, 0.5], blend=0.5)
    assert len(blended) == 3
    # Higher CE on middle item should pull its blended score up vs prior-only ranking
    assert blended[1] > blended[0] or blended[1] > 40


def test_rerank_identity_when_flag_off(monkeypatch=None):
    # Without pytest monkeypatch fixture — setenv manually
    prev = os.environ.pop("JOB_RESPONDER_CE_RERANK", None)
    try:
        os.environ["JOB_RESPONDER_CE_RERANK"] = "0"
        assert ce_rerank_enabled() is False
        items = [
            {"id": "1", "title": "A", "description": "python n8n", "score": 70},
            {"id": "2", "title": "B", "description": "cooking", "score": 40},
        ]
        out, meta = rerank_vacancy_batch("skills: python n8n", items, force=False)
        assert meta.get("applied") is False
        assert meta.get("reason") == "flag_off"
        assert [x["id"] for x in out] == ["1", "2"]
        assert out[0]["score"] == 70
    finally:
        if prev is None:
            os.environ.pop("JOB_RESPONDER_CE_RERANK", None)
        else:
            os.environ["JOB_RESPONDER_CE_RERANK"] = prev


def test_rerank_force_degrades_without_sentence_transformers():
    if sentence_transformers_available():
        # Env has CE — skip degrade assertion
        return
    items = [
        {"id": "1", "title": "Dev", "description": "n8n automation", "score": 55},
        {"id": "2", "title": "Chef", "description": "kitchen", "score": 90},
    ]
    out, meta = rerank_vacancy_batch("n8n python automation", items, force=True)
    assert meta.get("applied") is False
    assert meta.get("reason") in {"deps_missing", "unavailable", "predict_failed"} or str(
        meta.get("reason") or ""
    ).startswith("predict")
    assert len(out) == 2
    assert out[0]["score"] == 55


def test_profile_text_for_ce_includes_skills():
    text = profile_text_for_ce(
        {
            "skills": ["google ads", "seo"],
            "tools": ["ga4"],
            "domains": ["tourism"],
            "experience_bullets": ["job: tourism ROAS"],
        }
    )
    low = text.lower()
    assert "google ads" in low
    assert "tourism" in low
