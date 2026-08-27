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

Recommended gate in `.github/workflows/keept-staging-smoke.yml` (add via GitHub UI or PAT with `workflow` scope - Cursor OAuth cannot push workflow files):

```yaml
  job-responder-eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Autoro Hunt golden eval (Phase 0)
        working-directory: agent-api
        run: python3 -m evals.job_responder.run_eval
```

## Phase B (later)

- Wire live `generate()` output into cases.
- Ragas / LLM-judge faithfulness (optional).

## Phase 6 offline scripts (CE + ESCO)

Docs: [`docs/job-responder/README.md`](../../../docs/job-responder/README.md) § Phase 6.

```bash
# From repo root
python3 scripts/job-responder-ce-rerank.py --help
python3 scripts/job-responder-esco-import.py --dry-run

# Unit tests (no sentence-transformers required)
cd agent-api
PYTHONPATH=. python3 tests/test_job_responder_cross_encoder.py  # if __main__
PYTHONPATH=. python3 -c "
from tests import test_job_responder_cross_encoder as t
t.test_ce_status_reports_flag_and_deps()
t.test_normalize_and_blend_without_model()
t.test_rerank_identity_when_flag_off()
t.test_rerank_force_degrades_without_sentence_transformers()
t.test_profile_text_for_ce_includes_skills()
print('ce ok')
"
```
