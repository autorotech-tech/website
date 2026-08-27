"""Generate wall-clock budget helpers (no FastAPI) for Autoro Hunt cover letters."""

from __future__ import annotations

from typing import List

# Soft wall-clock for generate: CF edge often ~15–35s; finish JSON before soft cut.
GENERATE_BUDGET_SEC = 30.0
# Soft caps for unified compact profile (many Resume sources).
COMPACT_PROFILE_CHARS = 2000
COMPACT_PROFILE_CHARS_MANY = 1400
COMPACT_PROFILE_CHARS_RETRY = 1000
COMPACT_PROFILE_MANY_SOURCES = 6
COVER_TEMPLATE_CHARS = 1200
COVER_TEMPLATE_CHARS_RETRY = 500
# Tight slices so openmodel→gemini fit under CF; GLM only if budget healthy.
LLM_ATTEMPT_TIMEOUT_SEC = 9.0
LLM_PROVIDER_CAP_SEC = 10.0
LLM_MINI_RETRY_TIMEOUT_SEC = 8.0
LLM_MINI_RETRY_MIN_REMAINING_SEC = 5.5
GEMINI_RAG_EARLY_SEC = 6.0
GEMINI_RAG_MIN_BUDGET_SEC = 18.0


def should_attempt_mini_profile_retry(*, has_text: bool, remaining_sec: float) -> bool:
    """Always retry with a tinier profile when draft is empty and a slice remains (not only on timeout)."""
    return (not has_text) and float(remaining_sec) >= LLM_MINI_RETRY_MIN_REMAINING_SEC


def cascade_max_providers(*, profile_compressed: bool, remaining_sec: float, is_retry: bool = False) -> int:
    """Limit cascade width so mini-retry / finalize still fit under CF soft budget."""
    rem = float(remaining_sec)
    if is_retry or rem < 12.0:
        return 2
    if profile_compressed or rem < 18.0:
        return 2
    return 3


def summarize_provider_errors(errors: List[str], *, limit: int = 8) -> str:
    """Compact providerErrors for logs / empty-response payloads."""
    if not errors:
        return ""
    tail = [str(e).strip() for e in errors if str(e).strip()][-limit:]
    return "; ".join(tail)
