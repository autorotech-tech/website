"""Unit tests for prompt resolve, relevance placeholder, and rotate-friendly budget."""

from __future__ import annotations

import job_responder as jr
import job_responder_budget as budget


def test_resolve_prompt_extra_keeps_ultra_short():
    raw = jr.ULTRA_SHORT_SYSTEM_PROMPT
    assert jr.is_ultra_short_system_text(raw)
    got = jr.resolve_prompt_extra(raw, None)
    assert got == raw
    assert "[ROLE]" in got and "[RULES]" in got


def test_resolve_prompt_extra_keeps_custom_ultra_short_edits():
    custom = jr.ULTRA_SHORT_SYSTEM_PROMPT.replace("4-6 коротких факта", "9 коротких факта USEREDIT")
    assert "USEREDIT" in custom
    got = jr.resolve_prompt_extra(custom, None)
    assert "USEREDIT" in got
    sys_p = jr.build_system_prompt("cover_letter", prompt_extra=got)
    assert "USEREDIT" in sys_p
    assert sys_p.startswith("[ROLE]")
    assert "[CUSTOM]" not in sys_p


def test_build_system_prompt_default_when_extra_empty():
    sys_p = jr.build_system_prompt("cover_letter", prompt_extra="")
    assert "Специалист широкого профиля" in sys_p
    assert jr.RELEVANCE_PLACEHOLDER_TOKEN in sys_p
    assert "# ОТКЛИК НА ВАКАНСИЮ" not in sys_p


def test_build_system_prompt_non_ultra_goes_to_custom():
    sys_p = jr.build_system_prompt("cover_letter", prompt_extra="Упомяни n8n и Apify")
    assert "[CUSTOM]" in sys_p
    assert "Упомяни n8n и Apify" in sys_p


def test_format_and_apply_relevance_placeholder():
    relevance = {
        "score": 72,
        "matched": ["Инструменты: n8n, Apify", "Опыт: e-commerce"],
    }
    line = jr.format_relevance_line(relevance)
    assert line == "Релевантность: 72/100"
    assert "n8n" not in line
    assert "|" not in line

    draft = (
        "**Должность:** Test\n"
        "---\n"
        f"{jr.RELEVANCE_PLACEHOLDER_TOKEN}\n"
        "Здравствуйте!\n"
    )
    out = jr.apply_relevance_placeholder(draft, relevance)
    assert out.count("Релевантность: 72/100") == 1
    assert "n8n" not in out
    assert jr.RELEVANCE_PLACEHOLDER_TOKEN not in out
    assert "{Approximate" not in out


def test_apply_relevance_collapses_verbose_score_line():
    verbose = (
        "Релевантность: 60/100 | Инструменты: git, telegram; "
        "Совпало (семантика): b2b marketing <- https://example.com\n"
        "Привет!\n"
    )
    out = jr.apply_relevance_placeholder(verbose, {"score": 60})
    assert "Релевантность: 60/100" in out
    assert "Инструменты" not in out
    assert "b2b marketing" not in out
    assert "|" not in out.split("Привет!")[0]


def test_apply_relevance_strips_leftover_placeholder():
    out = jr.apply_relevance_placeholder(
        "Hello\n{ Approximate Relevance of a Vacancy }\nBye",
        {"score": 50},
    )
    assert "Релевантность: 50/100" in out
    assert "Approximate" not in out


def test_cascade_rotates_when_budget_allows():
    assert (
        budget.cascade_max_providers(profile_compressed=False, remaining_sec=22.0, is_retry=False)
        == 3
    )
    assert (
        budget.cascade_max_providers(profile_compressed=False, remaining_sec=19.0, is_retry=False)
        == 3
    )
    assert (
        budget.cascade_max_providers(profile_compressed=False, remaining_sec=14.0, is_retry=False)
        == 3
    )
    assert (
        budget.cascade_max_providers(profile_compressed=False, remaining_sec=10.0, is_retry=False)
        == 2
    )
    assert (
        budget.cascade_max_providers(profile_compressed=False, remaining_sec=8.0, is_retry=False)
        == 1
    )
    assert budget.cascade_max_providers(profile_compressed=True, remaining_sec=22.0, is_retry=True) == 1


def test_provider_timeout_fail_fast_primary_then_fallback():
    primary = budget.provider_timeout_for(
        "openmodel", remaining_sec=22.0, is_retry=False, attempt_index=0
    )
    fallback = budget.provider_timeout_for(
        "openmodel", remaining_sec=12.0, is_retry=False, attempt_index=1
    )
    assert primary <= budget.LLM_PRIMARY_TIMEOUT_SEC + 0.01
    assert primary <= budget.LLM_PROVIDER_CAP_SEC
    assert fallback <= budget.LLM_FALLBACK_TIMEOUT_SEC + 0.01
    assert budget.race_timeout_for(remaining_sec=25.0) <= budget.LLM_RACE_TIMEOUT_SEC
    assert budget.LLM_RACE_TIMEOUT_SEC + 6.0 <= budget.GENERATE_BUDGET_SEC


def test_generate_wall_still_under_cf_soft():
    assert budget.GENERATE_BUDGET_SEC <= 35.0
    assert budget.GENERATE_HARD_WALL_SEC <= 40.0
    assert budget.LLM_PROVIDER_CAP_SEC <= 16.0
    assert budget.JR_OPENMODEL_FALLBACK_MODEL
    assert budget.JR_OPENROUTER_FAST_MODEL
    from swoop_openmodel import OPENMODEL_CHAT_TIMEOUT_SEC

    # Default openmodel timeout for non-JR paths; JR passes request_timeout_sec.
    assert OPENMODEL_CHAT_TIMEOUT_SEC <= 45
