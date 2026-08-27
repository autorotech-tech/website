#!/usr/bin/env python3
"""Offline fixture pipeline: normalize HH-like JSON -> enrich -> offer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from hh_client import Filters, Profile, normalize_vacancy, pipeline_enrich, pipeline_offers  # noqa: E402


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--input",
        default=str(ROOT / "fixtures" / "sample_hh_items.json"),
    )
    p.add_argument("--host", default="uz")
    p.add_argument("--out", default="")
    p.add_argument("--fetch-sites", action="store_true")
    args = p.parse_args()
    raw = json.loads(Path(args.input).read_text(encoding="utf-8"))
    rows = [normalize_vacancy(x, args.host) for x in raw]
    rows = pipeline_enrich(rows, Filters(host=args.host), fetch_sites=args.fetch_sites)
    rows = pipeline_offers(rows, Profile())
    payload = {"count": len(rows), "items": rows}
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
