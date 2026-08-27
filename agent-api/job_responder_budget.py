"""Generate wall-clock budget helpers (no FastAPI) for Autoro Hunt cover letters."""

from __future__ import annotations

from typing import List, Tuple

# Soft wall-clock for generate: finish JSON before CF/proxy kills the connection.
# Evidence (VPS 2026-08-27): openmodel urlopen default was 45s while FuturesTimeout was
# 16–26s → zombie threads + only 2 uvicorn workers → nginx/CF HTTP 502 (HTML), not soft JSON.
# Keep hard wall under ~25s so abandoned HTTP dies with the slice (see swoop_openmodel timeout).
GENERATE_BUDGET_SEC = 24.0
# Soft caps for unified compact profile (many Resume sources).
COMPACT_PROFILE_CHARS = 1600
COMPACT_PROFILE_CHARS_MANY = 1100
COMPACT_PROFILE_CHARS_RETRY = 800
COMPACT_PROFILE_MANY_SOURCES = 6
# With many sources, start at mini size immediately (no full→retry dance).
# VPS 2026-08-27: ≥6 sources already need compress; ≥12 was too late for real KB.
COMPACT_PROFILE_EARLY_SOURCES = 6
COVER_TEMPLATE_CHARS = 900
COVER_TEMPLATE_CHARS_RETRY = 400

# Evidence (VPS 2026-08-27):
# - gemini-3.5-flash cover letter ≈ 47s without HTTP cap (unusable under CF)
# - openmodel claude-haiku often 4–5s, but under load can hang past 20s
# - single hung key at 45s starved workers → 502; fail-fast slice + rotate instead
# Cascade: haiku → deepseek → gemini flash, each with short HTTP timeout ≤ slice.
LLM_PRIMARY_TIMEOUT_SEC = 10.0
LLM_FALLBACK_TIMEOUT_SEC = 7.0
LLM_PROVIDER_CAP_SEC = 12.0
LLM_MINI_RETRY_TIMEOUT_SEC = 8.0
LLM_MINI_RETRY_MIN_REMAINING_SEC = 8.0
# Soft-retry after mid-word truncation only when enough wall-clock remains.
COVER_TRUNCATION_RETRY_MIN_SEC = 10.0
# Legacy aliases (tests / older call sites).
LLM_ATTEMPT_TIMEOUT_SEC = LLM_PRIMARY_TIMEOUT_SEC
GEMINI_RAG_EARLY_SEC = 5.0
# Auto File Search only when nearly full budget still free (explicit opt-in preferred).
GEMINI_RAG_MIN_BUDGET_SEC = 20.0
# Absolute asyncio.wait_for ceiling (seconds after start) - must beat CF soft cut.
GENERATE_HARD_WALL_SEC = 27.0

# Explicit fast OpenModel slug - admin default kimi-k3 is too slow for CF soft budget.
JR_OPENMODEL_FAST_MODEL = "claude-haiku-4-5-20251001"
JR_OPENMODEL_FALLBACK_MODEL = "deepseek-v4-flash"


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
    """How many cascade steps (haiku → deepseek → gemini) fit in remaining soft budget.

    Each step uses a short HTTP timeout so a hung key/provider fails fast and rotates
    instead of burning one urlopen until CF 502. Mini-profile retry stays single-step.
    """
    _ = profile_compressed
    if is_retry:
        return 1
    rem = float(remaining_sec)
    if rem >= 20.0:
        return 3
    if rem >= 12.0:
        return 2
    return 1


def provider_timeout_for(
    provider: str,
    *,
    remaining_sec: float,
    is_retry: bool = False,
    attempt_index: int = 0,
) -> float:
    """Per-attempt time slice. Primary fail-fast; fallbacks share remaining budget."""
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
