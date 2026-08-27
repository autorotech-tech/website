"""Unit tests for generate budget helpers (no FastAPI / no live LLM)."""

from __future__ import annotations

import job_responder_budget as budget
import job_responder_crag as crag


def test_should_attempt_mini_profile_retry_on_empty_not_only_timeout():
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=8.0) is True
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=5.5) is True
    assert budget.should_attempt_mini_profile_retry(has_text=False, remaining_sec=4.0) is False
    assert budget.should_attempt_mini_profile_retry(has_text=True, remaining_sec=20.0) is False


def test_cascade_max_providers_leaves_room_for_retry():
    assert (
        budget.cascade_max_providers(profile_compressed=True, remaining_sec=28.0, is_retry=False) == 2
    )
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=28.0, is_retry=False) == 3
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=10.0, is_retry=False) == 2
    assert budget.cascade_max_providers(profile_compressed=False, remaining_sec=25.0, is_retry=True) == 2


def test_summarize_provider_errors_tail():
    errs = [f"e{i}" for i in range(12)]
    s = budget.summarize_provider_errors(errs, limit=3)
    assert s == "e9; e10; e11"


def test_generate_budget_tighter_than_cf_soft():
    assert budget.GENERATE_BUDGET_SEC <= 32.0
    assert budget.LLM_ATTEMPT_TIMEOUT_SEC <= 10.0
    assert budget.LLM_PROVIDER_CAP_SEC <= 11.0


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
    assert (
        crag.should_run_crag_refine(
            has_text=True,
            mode="cover_letter",
            profile_compressed=False,
            remaining_sec=15.0,
            faith_failures=["ungrounded_skill:x"],
        )
        is True
    )
    assert crag.should_run_crag_critique(13.0) is False
    assert crag.should_run_crag_critique(14.0) is True
