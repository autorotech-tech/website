"""Worker-starvation guards: dedicated executors, generate lock, extension retry copy."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import job_responder as jr
import job_responder_budget as budget


ROOT = Path(__file__).resolve().parents[2]
API_JS = ROOT / "extensions" / "job-responder" / "lib" / "api.js"
MANIFEST = ROOT / "extensions" / "job-responder" / "manifest.json"


def test_dedicated_executors_keep_generate_off_relevance_pool():
    assert jr.JR_GENERATE_EXECUTOR._max_workers == budget.JR_GENERATE_EXECUTOR_WORKERS == 1
    assert jr.JR_RELEVANCE_EXECUTOR._max_workers == budget.JR_RELEVANCE_EXECUTOR_WORKERS
    assert jr.JR_GENERATE_EXECUTOR is not jr.JR_RELEVANCE_EXECUTOR


def test_generate_lockfile_serializes_parallel_calls(tmp_path, monkeypatch):
    lock = tmp_path / "jr-generate.lock"
    monkeypatch.setenv("JR_GENERATE_LOCKFILE", str(lock))
    order = []

    def work(n: int) -> int:
        order.append(("start", n))
        time.sleep(0.08)
        order.append(("end", n))
        return n

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(jr.run_serialized_generate, work, 1)
        f2 = pool.submit(jr.run_serialized_generate, work, 2)
        assert {f1.result(timeout=5), f2.result(timeout=5)} == {1, 2}

    kinds = [item[0] for item in order]
    assert kinds == ["start", "end", "start", "end"]


def test_extension_relevance_retries_without_reload_first_hint():
    src = API_JS.read_text(encoding="utf-8")
    assert "Повторите «Оценить предложение»" in src
    assert "Затем Reload расширения" not in src
    assert "errorKind === 'relevance' ? 3" in src
    assert "enqueueFatRequest" in src
    assert "relevance/batch" in src
    manifest = MANIFEST.read_text(encoding="utf-8")
    assert '"version": "0.9.22"' in manifest


def test_cover_max_tokens_and_latest_models_in_budget():
    assert budget.COVER_MAX_TOKENS == 1200
    assert budget.JR_OPENMODEL_FAST_MODEL == "fable-5"
    assert budget.JR_GEMINI_MODEL == "gemini-3.7-flash"
    assert budget.JR_OPENMODEL_FALLBACK_MODEL == "claude-sonnet-4-6"
    assert jr.JR_GEMINI_MODEL == "gemini-3.7-flash"
