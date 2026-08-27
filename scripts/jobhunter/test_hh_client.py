#!/usr/bin/env python3
"""Fixture tests for Jobhunter helpers (no network)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from hh_client import (  # noqa: E402
    Filters,
    Profile,
    build_offers,
    classify_and_score,
    dedupe_rows,
    extract_emails_from_html,
    hh_format_text,
    normalize_vacancy,
)


class TestHhFormat(unittest.TestCase):
    def test_dashes_arrows_quotes(self) -> None:
        raw = "«Процесс → результат» — автоматизация"
        self.assertEqual(hh_format_text(raw), '"Процесс -> результат" - автоматизация')


class TestNormalize(unittest.TestCase):
    def test_normalize(self) -> None:
        raw = {
            "id": "123",
            "name": "n8n engineer",
            "alternate_url": "https://hh.uz/vacancy/123",
            "employer": {"name": "Acme", "site_url": "https://acme.example", "type": "company"},
            "published_at": "2026-07-24T10:00:00+0300",
            "employment_form": {"id": "PROJECT"},
            "work_format": [{"id": "REMOTE"}],
            "snippet": {"requirement": "Python", "responsibility": "Automate"},
            "salary": {"from": 1000, "to": 2000, "currency": "USD"},
        }
        row = normalize_vacancy(raw, "uz")
        self.assertEqual(row["vacancy_id"], "123")
        self.assertEqual(row["host"], "uz")
        self.assertIn("REMOTE", row["work_format"])
        self.assertEqual(row["status"], "new")


class TestClassify(unittest.TestCase):
    def test_agency_skip(self) -> None:
        filters = Filters(host="uz", exclude_keywords=["агентство"])
        row = {
            "title": "Менеджер",
            "company": "Кадровое агентство Люди",
            "snippet": "работа через агентство",
            "employer_type": "agency",
            "status": "new",
        }
        out = classify_and_score(row, filters)
        self.assertEqual(out["route"], "agency_skip")
        self.assertEqual(out["status"], "skipped")

    def test_direct_email(self) -> None:
        filters = Filters(host="uz", min_score=10)
        row = {
            "title": "Automation",
            "company": "ProdCo",
            "snippet": "n8n remote",
            "employer_type": "company",
            "contacts_email": "hr@prodco.example",
            "work_format": "REMOTE",
            "employment_form": "PROJECT",
            "status": "new",
        }
        out = classify_and_score(row, filters)
        self.assertEqual(out["route"], "direct")
        self.assertTrue(out["has_direct_path"])
        self.assertGreaterEqual(out["score"], 70)


class TestEmails(unittest.TestCase):
    def test_extract(self) -> None:
        html = '<a href="mailto:hr@acme.com">HR</a> noise noreply@acme.com jobs@acme.com'
        emails = extract_emails_from_html(html)
        self.assertIn("hr@acme.com", emails)
        self.assertIn("jobs@acme.com", emails)
        self.assertNotIn("noreply@acme.com", emails)


class TestOffers(unittest.TestCase):
    def test_offer_formatting(self) -> None:
        profile = Profile()
        row = {
            "title": "AI архитектор",
            "company": "Тест",
            "route": "direct",
            "status": "enriched",
            "contacts_email": "hr@test.example",
        }
        out = build_offers(row, profile)
        self.assertNotIn("—", out["cover_letter"])
        self.assertNotIn("→", out["cover_letter"])
        self.assertEqual(out["status"], "awaiting_approve")
        self.assertTrue(out["email_to"].startswith("hr@"))


class TestDedupe(unittest.TestCase):
    def test_dedupe(self) -> None:
        rows = [
            {"host": "uz", "vacancy_id": "1"},
            {"host": "uz", "vacancy_id": "1"},
            {"host": "uz", "vacancy_id": "2"},
        ]
        out = dedupe_rows(rows, existing_keys=["uz:2"])
        self.assertEqual([r["vacancy_id"] for r in out], ["1"])


if __name__ == "__main__":
    unittest.main()
