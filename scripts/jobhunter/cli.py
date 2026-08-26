#!/usr/bin/env python3
"""CLI for Jobhunter HH pipeline (ingest / enrich / offer / apply / pipeline)."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from hh_client import (  # noqa: E402
    Filters,
    HhApiError,
    HhClient,
    Profile,
    pipeline_enrich,
    pipeline_ingest,
    pipeline_offers,
)


def load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_filters(path: str | None, host: str) -> Filters:
    if path:
        data = load_json(path) if path.endswith(".json") else _csv_first_row(path)
        if isinstance(data, list):
            data = data[0]
        return Filters.from_mapping(data)
    return Filters(host=host, area_id={"uz": 97, "kz": 40, "ru": 113}.get(host, 97))


def load_profile(path: str | None) -> Profile:
    if not path:
        return Profile()
    data = load_json(path) if path.endswith(".json") else _csv_first_row(path)
    if isinstance(data, list):
        data = next((r for r in data if str(r.get("active", "TRUE")).upper() in {"1", "TRUE", "YES"}), data[0])
    return Profile.from_mapping(data)


def _csv_first_row(path: str) -> Dict[str, Any]:
    with open(path, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"empty csv: {path}")
    return rows[0]


def _load_rows(path: str) -> List[Dict[str, Any]]:
    if path.endswith(".jsonl"):
        rows = []
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return rows
    data = load_json(path)
    if isinstance(data, dict) and "items" in data:
        return list(data["items"])
    if isinstance(data, list):
        return data
    raise SystemExit("unsupported input format")


def _write(path: str | None, payload: Any) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if path:
        Path(path).write_text(text + "\n", encoding="utf-8")
    print(text)


def cmd_ingest(args: argparse.Namespace) -> int:
    filters = load_filters(args.filters, args.host)
    existing = set(args.existing_keys.split(",")) if args.existing_keys else set()
    result = pipeline_ingest(filters, existing)
    if args.dry_run:
        result["dry_run"] = True
    _write(args.out, result)
    return 0 if not result.get("error_code") or result.get("count") else 2


def cmd_enrich(args: argparse.Namespace) -> int:
    filters = load_filters(args.filters, args.host)
    rows = _load_rows(args.input)
    out = pipeline_enrich(rows, filters, fetch_sites=not args.no_fetch_sites)
    _write(args.out, {"items": out, "count": len(out)})
    return 0


def cmd_offer(args: argparse.Namespace) -> int:
    profile = load_profile(args.profile)
    rows = _load_rows(args.input)
    out = pipeline_offers(rows, profile)
    _write(args.out, {"items": out, "count": len(out)})
    return 0


def cmd_apply(args: argparse.Namespace) -> int:
    profile = load_profile(args.profile)
    rows = _load_rows(args.input)
    client = HhClient()
    results = []
    applied = 0
    for row in rows:
        if str(row.get("status") or "") in {"skipped", "error"} and not args.force:
            results.append({**row, "apply_result": "skipped_status"})
            continue
        if str(row.get("route") or "") == "agency_skip" and not args.force:
            results.append({**row, "error_code": "agency_skip", "apply_result": "skipped_agency"})
            continue
        if str(row.get("approve", "")).upper() not in {"YES", "Y", "TRUE", "1"} and not args.force:
            results.append({**row, "error_code": "awaiting_approve", "apply_result": "skipped_no_approve"})
            continue
        if args.daily_cap and applied >= args.daily_cap:
            results.append({**row, "error_code": "rate_limit", "apply_result": "daily_cap"})
            continue
        resume_id = profile.resume_id_for(str(row.get("host") or "uz"))
        try:
            resp = client.apply(
                str(row.get("vacancy_id")),
                resume_id,
                str(row.get("cover_letter") or ""),
                dry_run=args.dry_run,
            )
            applied += 1
            results.append(
                {
                    **row,
                    "status": "awaiting_approve" if args.dry_run else "applied_hh",
                    "error_code": "",
                    "apply_result": resp,
                }
            )
        except HhApiError as e:
            results.append({**row, "status": "error", "error_code": e.error_code, "apply_result": e.body})
            if args.pause_on_block and e.error_code in {"blocked", "captcha", "rate_limit"}:
                break
    _write(args.out, {"items": results, "applied": applied, "dry_run": args.dry_run})
    return 0


def cmd_pipeline(args: argparse.Namespace) -> int:
    filters = load_filters(args.filters, args.host)
    profile = load_profile(args.profile)
    existing = set(args.existing_keys.split(",")) if args.existing_keys else set()
    ingested = pipeline_ingest(filters, existing)
    items = ingested.get("items") or []
    items = pipeline_enrich(items, filters, fetch_sites=not args.no_fetch_sites)
    items = pipeline_offers(items, profile)
    payload = {
        "source": ingested.get("source"),
        "ingest_error": ingested.get("error_code") or "",
        "count": len(items),
        "dry_run": True,
        "items": items,
    }
    _write(args.out, payload)
    return 0 if items or not ingested.get("error_code") else 2


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Jobhunter HH CLI")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_io(sp: argparse.ArgumentParser, need_input: bool = False) -> None:
        sp.add_argument("--host", default="uz", choices=["uz", "kz", "ru"])
        sp.add_argument("--filters", help="JSON or CSV filters path")
        sp.add_argument("--profile", help="JSON or CSV profile path")
        sp.add_argument("--out", help="Write JSON to path")
        if need_input:
            sp.add_argument("--input", required=True, help="JSON/JSONL with items")

    s = sub.add_parser("ingest", help="Search vacancies (HH API + Apify fallback)")
    add_io(s)
    s.add_argument("--existing-keys", default="", help="Comma host:id keys to skip")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(func=cmd_ingest)

    s = sub.add_parser("enrich", help="Classify + optional company site emails")
    add_io(s, need_input=True)
    s.add_argument("--no-fetch-sites", action="store_true")
    s.set_defaults(func=cmd_enrich)

    s = sub.add_parser("offer", help="Build A/B cover letters + email drafts")
    add_io(s, need_input=True)
    s.set_defaults(func=cmd_offer)

    s = sub.add_parser("apply", help="POST /negotiations (default dry-run)")
    add_io(s, need_input=True)
    s.add_argument("--dry-run", action="store_true", default=True)
    s.add_argument("--real", action="store_true", help="Actually call HH API")
    s.add_argument("--force", action="store_true", help="Ignore approve column")
    s.add_argument("--daily-cap", type=int, default=5)
    s.add_argument("--pause-on-block", action="store_true", default=True)
    s.set_defaults(func=lambda a: cmd_apply(_fix_apply_flags(a)))

    s = sub.add_parser("pipeline", help="ingest -> enrich -> offer (no send)")
    add_io(s)
    s.add_argument("--existing-keys", default="")
    s.add_argument("--no-fetch-sites", action="store_true")
    s.set_defaults(func=cmd_pipeline)

    return p


def _fix_apply_flags(args: argparse.Namespace) -> argparse.Namespace:
    if args.real:
        args.dry_run = False
    return args


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args) or 0)


if __name__ == "__main__":
    raise SystemExit(main())
