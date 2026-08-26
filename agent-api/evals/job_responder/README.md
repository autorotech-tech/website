# Job Responder eval harness (skeleton)

Golden JD–resume pairs + heuristic metrics for regression before merge.

See playbook: [`docs/job-responder/rag-ats-optimization-playbook.md`](../../../docs/job-responder/rag-ats-optimization-playbook.md).

## Run

```bash
cd agent-api
python -m evals.job_responder.run_eval
# or later: pytest evals/job_responder -q
```

## Add a case

1. Copy `golden/cases/_template.json`.
2. Fill vacancy + `must_include_facts` / `must_not_claim`.
3. Point `profile_fixture` at a compact-profile JSON under `golden/fixtures/`.

## Metrics (Phase A)

- `must_not_claim` / `must_include_facts` — string containment on generated or fixture letter.
- Faithfulness LLM-judge / Ragas — Phase B (optional `pip install ragas`).
