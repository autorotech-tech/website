"""Heuristic metrics for Job Responder golden cases (no LLM)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CASES_DIR = ROOT / "golden" / "cases"
FIXTURES_DIR = ROOT / "golden" / "fixtures"


def load_cases() -> list[dict[str, Any]]:
    cases: list[dict[str, Any]] = []
    for path in sorted(CASES_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue
        cases.append(json.loads(path.read_text(encoding="utf-8")))
    return cases


def load_profile_fixture(case: dict[str, Any]) -> str:
    rel = str(case.get("profile_fixture") or "").strip()
    if not rel:
        return ""
    path = ROOT / "golden" / rel
    if not path.is_file():
        return ""
    data = json.loads(path.read_text(encoding="utf-8"))
    parts: list[str] = []
    for key in ("skills", "tools", "domains", "domains_matched", "industry_experience", "experience", "roles"):
        val = data.get(key)
        if isinstance(val, list) and val:
            parts.append(f"{key}: " + ", ".join(str(v) for v in val))
        elif isinstance(val, str) and val.strip():
            parts.append(f"{key}: {val.strip()}")
    langs = data.get("languages")
    if isinstance(langs, list) and langs:
        parts.append("languages: " + ", ".join(str(v) for v in langs))
    elif isinstance(langs, str) and langs.strip():
        parts.append(langs.strip())
    return "\n".join(parts)


def apply_post_process(letter: str, case: dict[str, Any]) -> str:
    """Run baseline post-process pipeline (anti-embellish + HH scrub)."""
    from job_responder_format import hh_format_text, strip_embellished_language_claims

    mode = case.get("post_process")
    if not mode:
        return letter
    profile_blob = case.get("profile_blob") or load_profile_fixture(case)
    if mode == "finalize":
        from job_responder import finalize_cover_letter_contacts_and_links

        contacts = case.get("contacts") if isinstance(case.get("contacts"), dict) else {}
        links = case.get("links") if isinstance(case.get("links"), list) else []
        return finalize_cover_letter_contacts_and_links(
            letter,
            contacts=contacts,
            links=links,
            profile_blob=profile_blob,
        )
    if profile_blob:
        letter, _ = strip_embellished_language_claims(letter, profile_blob)
    return hh_format_text(letter)


def check_letter(letter: str, case: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    low = letter.lower()
    for phrase in case.get("banned_phrases") or []:
        if phrase.lower() in low:
            errors.append(f"banned_phrase:{phrase}")
    for claim in case.get("must_not_claim") or []:
        if claim.lower() in low:
            errors.append(f"must_not_claim:{claim}")
    for fact in case.get("must_include_facts") or []:
        if fact.lower() not in low:
            errors.append(f"missing_fact:{fact}")
    for char in case.get("must_not_contain_chars") or []:
        if char in letter:
            errors.append(f"forbidden_char:{char!r}")
    return errors


def evaluate_case(case: dict[str, Any]) -> tuple[str, list[str]]:
    raw = str(case.get("sample_letter") or "").strip()
    if not raw:
        return "SKIP", ["no_sample_letter"]
    letter = apply_post_process(raw, case) if case.get("post_process") else raw
    errs = check_letter(letter, case)
    return ("PASS" if not errs else "FAIL"), errs
