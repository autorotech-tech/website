"""Unit tests for generate budget helpers (no FastAPI / no live LLM)."""

from __future__ import annotations

import job_responder_budget as budget
import job_responder_crag as crag


def test_should_attempt_mini_profile_retry_on_empty_not_only_timeout():
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=10.0) is True
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=8.0) is True
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=4.0) is False
    assert budget.should_attempt_mini_profile_retry(has_text=True, remaining_sec=20.0) is False


def test_choose_profile_cap_early_compress_for_many_sources():
    chars, compressed = budget.choose_profile_cap(20)
    assert compressed is True
    assert chars == budget.COMPACT_PROFILE_CHARS_RETRY
    chars6, compressed6 = budget.choose_profile_cap(6)
    assert compressed6 is True
    assert chars6 == budget.COMPACT_PROFILE_CHARS_RETRY
    chars3, compressed3 = budget.choose_profile_cap(3)
    assert compressed3 is False
    assert chars3 == budget.COMPACT_PROFILE_CHARS


def test_cascade_max_providers_single_primary():
    """Under CF soft timeout prefer one fast provider with a full slice (no empty fallback)."""
    assert (
        budget.cascade_max_providers(profile_compressed=True, remaining_sec=28.0, is_retry=False) == 1
    )
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=28.0, is_retry=False) == 1
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=10.0, is_retry=False) == 1
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=25.0, is_retry=True) == 1


def test_provider_timeout_primary_gets_full_slice():
    primary = budget.provider_timeout_for("openmodel", remaining_sec=22.0, is_retry=False, attempt_index=0)
    assert primary >= 14.0
    assert primary <= budget.LLM_PROVIDER_CAP_SEC
    assert primary <= budget.GENERATE_BUDGET_SEC
    retry = budget.provider_timeout_for("openmodel", remaining_sec=12.0, is_retry=True, attempt_index=0)
    assert retry <= budget.LLM_MINI_RETRY_TIMEOUT_SEC
    assert retry <= 11.5


def test_truncation_retry_min_budget():
    assert budget.COVER_TRUNCATION_RETRY_MIN_SEC >= 10.0


def test_summarize_provider_errors_tail():
    errs = [f"e{i}" for i in range(12)]
    s = budget.summarize_provider_errors(errs, limit=3)
    assert s == "e9; e10; e11"


def test_generate_budget_tighter_than_cf_soft():
    assert budget.GENERATE_BUDGET_SEC <= 28.0
    assert budget.LLM_PRIMARY_TIMEOUT_SEC <= 22.0
    assert budget.LLM_PROVIDER_CAP_SEC <= 22.0
    assert budget.GENERATE_HARD_WALL_SEC <= 30.0
    assert budget.GENERATE_HARD_WALL_SEC > budget.GENERATE_BUDGET_SEC
    assert budget.JR_OPENMODEL_FAST_MODEL
    # HTTP openmodel must die with the soft slice (no 45s zombies → 502).
    assert budget.LLM_PROVIDER_CAP_SEC <= 20.0


def test_crag_refine_skipped_when_compressed_or_low_budget():
    assert (
        crag.should_run_crag_refine(
            has_text=True,
            mode="cover_letter",
            profile_compressed=True,
            remaining_sec=20.0,
            faith_failures=["ungrounded_skill:x"],
        )
        is False
    )
    assert (
        crag.should_run_crag_refine(
            has_text=True,
            mode="cover_letter",
            profile_compressed=False,
            remaining_sec=5.0,
            faith_failures=["ungrounded_skill:x"],
        )
        is False
    )
    # Default CRAG off: refine gated even with headroom unless env enables it.
    assert crag.is_crag_lite_enabled() is False
    assert (
        crag.should_run_crag_refine(
            has_text=True,
            mode="cover_letter",
            profile_compressed=False,
            remaining_sec=15.0,
            faith_failures=["ungrounded_skill:x"],
        )
        is False
    )
    assert crag.should_run_crag_critique(13.0) is False
    assert crag.should_run_crag_critique(14.0) is True
