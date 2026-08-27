"""Generate wall-clock budget helpers (no FastAPI) for Autoro Hunt cover letters."""

from __future__ import annotations

from typing import List, Tuple

# Soft wall-clock for generate: CF edge often ~15–35s; finish JSON before soft cut.
GENERATE_BUDGET_SEC = 32.0
# Soft caps for unified compact profile (many Resume sources).
COMPACT_PROFILE_CHARS = 1600
COMPACT_PROFILE_CHARS_MANY = 1100
COMPACT_PROFILE_CHARS_RETRY = 800
COMPACT_PROFILE_MANY_SOURCES = 6
# With a large KB, start at mini size immediately (no full→retry dance).
COMPACT_PROFILE_EARLY_SOURCES = 12
COVER_TEMPLATE_CHARS = 900
COVER_TEMPLATE_CHARS_RETRY = 400

# Evidence (VPS 2026-08-27):
# - gemini-3.5-flash cover letter ≈ 47s (unusable under CF soft budget)
# - openmodel claude-haiku cover letter ≈ 4–5s (fits)
# - 2×9s openmodel→gemini cascade always exhausted budget on real prompts
# Primary = openmodel/haiku with room for catalog warm + letter; no gemini in cascade.
LLM_PRIMARY_TIMEOUT_SEC = 16.0
LLM_FALLBACK_TIMEOUT_SEC = 8.0
LLM_PROVIDER_CAP_SEC = 18.0
LLM_MINI_RETRY_TIMEOUT_SEC = 12.0
LLM_MINI_RETRY_MIN_REMAINING_SEC = 6.0
# Legacy aliases (tests / older call sites).
LLM_ATTEMPT_TIMEOUT_SEC = LLM_PRIMARY_TIMEOUT_SEC
GEMINI_RAG_EARLY_SEC = 5.0
# Auto File Search only when nearly full budget still free (explicit opt-in preferred).
GEMINI_RAG_MIN_BUDGET_SEC = 28.0

# Explicit fast OpenModel slug - admin default kimi-k3 is too slow for CF soft budget.
JR_OPENMODEL_FAST_MODEL = "claude-haiku-4-5-20251001"


def should_attempt_mini_profile_retry(*, has_text: bool, remaining_sec: float) -> bool:
    """Always retry with a tinier profile when draft is empty and a slice remains (not only on timeout)."""
    return (not has_text) and float(remaining_sec) >= LLM_MINI_RETRY_MIN_REMAINING_SEC


def choose_profile_cap(source_count: int) -> Tuple[int, bool]:
    """Return (max_chars, profile_compressed) for the first generate attempt."""
    n = int(source_count or 0)
    if n >= COMPACT_PROFILE_EARLY_SOURCES:
        return COMPACT_PROFILE_CHARS_RETRY, True
    if n >= COMPACT_PROFILE_MANY_SOURCES:
        return COMPACT_PROFILE_CHARS_MANY, True
    return COMPACT_PROFILE_CHARS, False


def cascade_max_providers(*, profile_compressed: bool, remaining_sec: float, is_retry: bool = False) -> int:
    """Width of cascade: primary openmodel (+ optional second openmodel model), never gemini.

    Gemini flash takes ~45s+ for cover letters and must not consume the CF soft budget.
    """
    rem = float(remaining_sec)
    if is_retry:
        return 1
    if rem < 12.0:
        return 1
    if profile_compressed and rem < 16.0:
        return 1
    return 2


def provider_timeout_for(
    provider: str,
    *,
    remaining_sec: float,
    is_retry: bool = False,
    attempt_index: int = 0,
) -> float:
    """Per-attempt time slice. Primary gets the long window; fallback/retry share remainder."""
    rem = max(0.0, float(remaining_sec) - 0.5)
    if is_retry:
        base = LLM_MINI_RETRY_TIMEOUT_SEC
    elif int(attempt_index) <= 0:
        base = LLM_PRIMARY_TIMEOUT_SEC
    else:
        base = LLM_FALLBACK_TIMEOUT_SEC
    _ = provider  # reserved for per-provider overrides
    return max(0.0, min(float(base), rem, LLM_PROVIDER_CAP_SEC))


def summarize_provider_errors(errors: List[str], *, limit: int = 8) -> str:
    """Compact providerErrors for logs / empty-response payloads."""
    if not errors:
        return ""
    tail = [str(e).strip() for e in errors if str(e).strip()][-limit:]
    return "; ".join(tail)
