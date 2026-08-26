"""Phase 0 golden eval gate for Job Responder baseline."""

from __future__ import annotations

from evals.job_responder.metrics import evaluate_case, load_cases


def test_golden_cases_all_pass():
    cases = load_cases()
    assert cases, "expected at least one golden case"
    failures: list[str] = []
    for case in cases:
        status, detail = evaluate_case(case)
        if status == "SKIP":
            failures.append(f"{case.get('id')}: skipped ({detail})")
        elif status == "FAIL":
            failures.append(f"{case.get('id')}: {detail}")
    assert not failures, "golden eval failures:\n" + "\n".join(failures)
