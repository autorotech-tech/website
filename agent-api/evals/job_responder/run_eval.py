"""Heuristic eval runner for Job Responder golden cases (no LLM).

Phase A: checks banned phrases + must_not_claim against a sample letter
or fixture. Wire generate() later for full regression.

Usage:
  python -m evals.job_responder.run_eval
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CASES = ROOT / "golden" / "cases"


def _load_cases():
    cases = []
    for path in sorted(CASES.glob("*.json")):
        if path.name.startswith("_"):
            continue
        cases.append(json.loads(path.read_text(encoding="utf-8")))
    return cases


def check_letter(letter: str, case: dict) -> list[str]:
    errors: list[str] = []
    low = letter.lower()
    for phrase in case.get("banned_phrases") or []:
        if phrase.lower() in low:
            errors.append(f"banned_phrase:{phrase}")
    for claim in case.get("must_not_claim") or []:
        if claim.lower() in low:
            errors.append(f"must_not_claim:{claim}")
    # must_include only when letter is a real generate output (skip empty stub)
    if letter.strip() and not letter.startswith("("):
        for fact in case.get("must_include_facts") or []:
            if fact.lower() not in low:
                errors.append(f"missing_fact:{fact}")
    return errors


def main() -> int:
    cases = _load_cases()
    if not cases:
        print("No golden cases found.")
        return 1
    failed = 0
    for case in cases:
        # Stub letter: transferable-friendly sample for dry-run of harness.
        # Replace with generate() output in Phase B CI.
        # Stub must not contain must_not_claim tokens (naive containment).
        sample = (
            "(stub) Смежный опыт: Meta Ads и ROAS в tourism funnel. "
            "Оркестрацию пайплайнов не заявляю. CTA и контакты."
        )
        errs = check_letter(sample, case)
        # Stub intentionally has no banned phrases; must_include skipped for stubs
        status = "PASS" if not errs else "FAIL"
        if errs:
            failed += 1
        print(f"{status} {case.get('id')} {errs or ''}".strip())
    print(f"\n{len(cases) - failed}/{len(cases)} passed (harness dry-run).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
