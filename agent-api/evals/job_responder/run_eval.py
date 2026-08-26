"""Heuristic eval runner for Job Responder golden cases (no LLM).

Phase 0: post-process pipeline + must_not_claim / tourism domain / slop scrub.

Usage:
  cd agent-api && python3 -m evals.job_responder.run_eval
"""

from __future__ import annotations

import sys

from evals.job_responder.metrics import evaluate_case, load_cases


def main() -> int:
    cases = load_cases()
    if not cases:
        print("No golden cases found.")
        return 1
    failed = 0
    skipped = 0
    for case in cases:
        status, detail = evaluate_case(case)
        cid = case.get("id", "?")
        if status == "SKIP":
            skipped += 1
            print(f"SKIP {cid} {detail}")
            continue
        if status == "FAIL":
            failed += 1
        print(f"{status} {cid} {detail or ''}".strip())
    passed = len(cases) - failed - skipped
    print(f"\n{passed}/{len(cases)} passed, {skipped} skipped (Phase 0 baseline eval).")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
