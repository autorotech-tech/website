"""PII redaction and prompt-injection screening for Keept capture pipeline."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

RouteDecision = Literal["auto_process", "human_review"]

INJECTION_KEYWORDS = (
    "bypass",
    "auto-approve",
    "ignore",
    "override",
    "system prompt",
    "instruction",
    "disregard",
)

SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b|\b\d{9,11}\b")
CC_PATTERN = re.compile(r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b")
EMAIL_PATTERN = re.compile(r"\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b")
PHONE_PATTERN = re.compile(
    r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b|"
    r"\b(?:\+?7|8)[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}\b"
)


@dataclass(frozen=True)
class SecurityScreenResult:
    text: str
    redacted_categories: list[str]
    prompt_injection: bool
    route: RouteDecision


def redact_pii(text: str) -> tuple[str, list[str]]:
    redacted = text or ""
    categories: list[str] = []

    if SSN_PATTERN.search(redacted):
        redacted = SSN_PATTERN.sub("[REDACTED_SSN]", redacted)
        categories.append("SSN")

    if CC_PATTERN.search(redacted):
        redacted = CC_PATTERN.sub("[REDACTED_CC]", redacted)
        categories.append("credit_card")

    if EMAIL_PATTERN.search(redacted):
        redacted = EMAIL_PATTERN.sub("[REDACTED_EMAIL]", redacted)
        categories.append("email")

    if PHONE_PATTERN.search(redacted):
        redacted = PHONE_PATTERN.sub("[REDACTED_PHONE]", redacted)
        categories.append("phone")

    return redacted, categories


def detect_prompt_injection(text: str) -> bool:
    lowered = (text or "").lower()
    return any(keyword in lowered for keyword in INJECTION_KEYWORDS)


def screen_capture_content(text: str) -> SecurityScreenResult:
    redacted, categories = redact_pii(text)
    injection = detect_prompt_injection(text)
    route: RouteDecision = "human_review" if injection or categories else "auto_process"
    return SecurityScreenResult(
        text=redacted,
        redacted_categories=categories,
        prompt_injection=injection,
        route=route,
    )
