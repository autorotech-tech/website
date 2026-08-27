#!/usr/bin/env python3
"""Offline cross-encoder re-rank for Autoro Hunt vacancy score batches.

Does NOT run on Cloudflare generate hot path.

Usage:
  # Identity / degrade path (no sentence-transformers) — still validates I/O
  python3 scripts/job-responder-ce-rerank.py \\
    --profile-text "skills: google ads, tourism, n8n" \\
    --input /tmp/jr-scores.json --output /tmp/jr-scores-ce.json --force

  # With CE (optional heavy dep):
  pip install sentence-transformers
  JOB_RESPONDER_CE_RERANK=1 python3 scripts/job-responder-ce-rerank.py \\
    --profile-text "..." --input scores.json --output scores-ce.json --force

Input JSON shapes accepted:
  { "scores": [ { "id", "title", "description", "score" }, ... ] }
  or a bare list of score objects.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT_API = ROOT / "agent-api"
if str(AGENT_API) not in sys.path:
    sys.path.insert(0, str(AGENT_API))

from job_responder_cross_encoder import (  # noqa: E402
    ce_status,
    profile_text_for_ce,
    rerank_vacancy_batch,
)


def _load_items(path: Path) -> list:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("scores", "items", "vacancies"):
            if isinstance(data.get(key), list):
                return data[key]
    raise SystemExit(f"Unrecognized input JSON shape in {path}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Offline CE re-rank for JR vacancy batches")
    ap.add_argument("--input", "-i", type=Path, required=True, help="JSON with scores[]")
    ap.add_argument("--output", "-o", type=Path, required=True, help="Write re-ranked JSON")
    ap.add_argument("--profile-text", type=str, default="", help="Query side (compact profile)")
    ap.add_argument(
        "--profile-json",
        type=Path,
        default=None,
        help="Optional merged profile JSON (skills/tools/bullets)",
    )
    ap.add_argument("--force", action="store_true", help="Run even if JOB_RESPONDER_CE_RERANK is off")
    ap.add_argument("--blend", type=float, default=None, help="CE blend weight 0..1")
    ap.add_argument("--model", type=str, default=None, help="HF cross-encoder model id")
    args = ap.parse_args()

    items = _load_items(args.input)
    profile_text = (args.profile_text or "").strip()
    if args.profile_json and args.profile_json.is_file():
        profile = json.loads(args.profile_json.read_text(encoding="utf-8"))
        if not profile_text:
            profile_text = profile_text_for_ce(profile if isinstance(profile, dict) else {})
    if not profile_text:
        profile_text = "candidate profile"

    ranked, meta = rerank_vacancy_batch(
        profile_text,
        items,
        blend=args.blend,
        model_name=args.model,
        force=bool(args.force),
    )
    out = {
        "ok": True,
        "scores": ranked,
        "count": len(ranked),
        "ceMeta": meta,
        "ceStatus": ce_status(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    applied = meta.get("applied")
    print(
        f"ce-rerank wrote {args.output} count={len(ranked)} applied={applied} "
        f"reason={meta.get('reason')} deps={ce_status().get('depsAvailable')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
