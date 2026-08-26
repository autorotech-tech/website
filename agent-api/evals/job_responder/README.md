# Job Responder eval harness (Phase 0 baseline)

Golden JD–resume pairs + heuristic metrics for regression before merge.

Playbook: [`docs/job-responder/rag-ats-optimization-playbook.md`](../../../docs/job-responder/rag-ats-optimization-playbook.md) · Phase 0: ban-list, transferable rule, 7 golden cases.

## Run

```bash
cd agent-api
python3 -m evals.job_responder.run_eval
# or with pytest:
python3 -m pytest tests/test_job_responder_eval.py -q
```

## Golden cases (7)

| id | Checks |
|----|--------|
| `saas-no-direct-match` | transferable branch, must_not_claim Airflow/senior/C1 |
| `tourism-domain-pin` | tourism + Meta + ROAS in letter |
| `hh-slop-scrub` | HH ASCII + slop removal |
| `cefr-embellish-scrub` | C1 stripped when not in profile |
| `senior-embellish-scrub` | senior/эксперт stripped |
| `en-cliche-ban` | EN cover fluff removed |
| `ru-cliche-ban` | RU cover fluff removed |

## Add a case

1. Copy `golden/cases/_template.json`.
2. Set `sample_letter` (required for Phase 0).
3. Optional `post_process`: `hh_format` or `finalize`.
4. Point `profile_fixture` at JSON under `golden/fixtures/`.

## CI

`keept-staging-smoke.yml` runs `python3 -m evals.job_responder.run_eval` when `agent-api/evals/**` or `job_responder.py` changes.

## Phase B (later)

- Wire live `generate()` output into cases.
- Ragas / LLM-judge faithfulness (optional).
