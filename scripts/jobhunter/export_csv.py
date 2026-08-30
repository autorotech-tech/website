#!/usr/bin/env python3
"""Export vacancies JSON/JSONL to CSV for Obsidian / Sheets import."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

COLUMNS = [
    "vacancy_id",
    "host",
    "url",
    "title",
    "company",
    "company_url",
    "published_at",
    "employment_form",
    "work_format",
    "salary",
    "snippet",
    "contacts_email",
    "contacts_phone",
    "preferred_contact",
    "hr_emails_found",
    "is_agency",
    "has_direct_path",
    "route",
    "score",
    "status",
    "offer_variant",
    "cover_letter",
    "email_subject",
    "email_body",
    "approve",
    "error_code",
    "applied_at",
    "updated_at",
]


def load_items(path: str) -> List[Dict[str, Any]]:
    text = Path(path).read_text(encoding="utf-8")
    if path.endswith(".jsonl"):
        return [json.loads(line) for line in text.splitlines() if line.strip()]
    data = json.loads(text)
    if isinstance(data, dict) and "items" in data:
        return list(data["items"])
    if isinstance(data, list):
        return data
    raise SystemExit("unsupported input")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    rows = load_items(args.input)
    with open(args.out, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            flat = {k: r.get(k, "") for k in COLUMNS}
            flat["is_agency"] = str(bool(r.get("is_agency"))).upper()
            flat["has_direct_path"] = str(bool(r.get("has_direct_path"))).upper()
            w.writerow(flat)
    print(f"wrote {len(rows)} rows -> {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
