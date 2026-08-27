"""Unit tests for outbound prepare (human-gated queue)."""

from __future__ import annotations

from job_responder_outbound import normalize_answers, prepare_outbound_bundle, prepare_outbound_item


def test_normalize_answers_mixed():
    rows = normalize_answers(
        [
            {"question": "Опыт с n8n?", "answer": "Да, 2 года"},
            "Готовы к релокации?",
            {"text": "Зарплата", "answer": "по договорённости"},
            {"foo": 1},
        ]
    )
    assert len(rows) == 3
    assert rows[0]["answer"] == "Да, 2 года"
    assert rows[1]["question"] == "Готовы к релокации?"
    assert rows[1]["answer"] == ""


def test_prepare_item_hh_selectors_and_human_gate():
    row = prepare_outbound_item(
        {
            "id": "123",
            "url": "https://hh.ru/vacancy/123",
            "title": "n8n engineer",
            "company": "Autoro",
            "score": 88,
            "letterText": "Здравствуйте",
        }
    )
    assert row is not None
    assert row["platform"] == "hh"
    assert row["humanGate"] is True
    assert row["autoSubmit"] is False
    assert row["status"] == "ready_for_review"
    assert "letter" in row["selectors"]
    assert "manual_submit" in row["actions"]


def test_prepare_bundle_min_score_and_stub():
    bundle = prepare_outbound_bundle(
        [
            {"id": "1", "url": "https://hh.ru/vacancy/1", "title": "A", "score": 90},
            {"id": "2", "url": "https://hh.ru/vacancy/2", "title": "B", "score": 40},
            {"id": "3", "url": "https://remote.co/job/x", "title": "C", "score": 70},
        ],
        default_letter="",
        min_score=60,
        workspace_id="1",
    )
    assert bundle["ok"] is True
    assert bundle["humanGate"] is True
    assert bundle["autoSubmit"] is False
    assert bundle["count"] == 2
    assert len(bundle["skipped"]) == 1
    assert bundle["skipped"][0]["reason"] == "below_min_score"
    statuses = {r["id"]: r["status"] for r in bundle["prepared"]}
    assert statuses["1"] == "needs_letter"
    assert any(r["platform"] == "web" for r in bundle["prepared"])


def test_prepare_item_extracts_id_from_url():
    row = prepare_outbound_item({"url": "https://hh.kz/vacancy/99999?query=1", "title": "X", "score": 10})
    assert row is not None
    assert row["id"] == "99999"
    assert row["host"] == "kz"
