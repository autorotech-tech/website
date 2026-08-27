#!/usr/bin/env python3
"""Import / sync lightweight ESCO skill ids into skill-synonyms.json.

Offline-first: default mode uses a local stub crosswalk (no network).
Optional --fetch tries the public ESCO API for label matches; failures fall back
to stub. Runtime generate/relevance never call this script or the network.

Usage:
  # Dry-run merge from stub (recommended first)
  python3 scripts/job-responder-esco-import.py --dry-run

  # Write esco_id into both synonym JSON paths
  python3 scripts/job-responder-esco-import.py --apply

  # Try live ESCO API (network), merge matches, keep nulls when unmatched
  python3 scripts/job-responder-esco-import.py --fetch --apply

ESCO refs:
  https://esco.ec.europa.eu/en/classification/skill_main
  https://esco.ec.europa.eu/en/use-esco/use-esco-services-api
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TARGETS = [
    ROOT / "agent-api" / "data" / "job-responder" / "skill-synonyms.json",
    ROOT / "data" / "job-responder" / "skill-synonyms.json",
]
STUB_PATH = ROOT / "agent-api" / "data" / "job-responder" / "esco-stub-crosswalk.json"

# Minimal curated URI stubs (stable ESCO concept URIs or documented placeholders).
# Real sync should replace via --fetch when network is available.
_BUILTIN_STUB: Dict[str, str] = {
    "seo": "http://data.europa.eu/esco/skill/S5.6.2",
    "search engine optimization": "http://data.europa.eu/esco/skill/S5.6.2",
    "ppc": "http://data.europa.eu/esco/skill/S5.6.1",
    "paid search": "http://data.europa.eu/esco/skill/S5.6.1",
    "content marketing": "http://data.europa.eu/esco/skill/S5.5.1",
    "copywriting": "http://data.europa.eu/esco/skill/S1.3.1",
    "automation": "http://data.europa.eu/esco/skill/S5.7.1",
    "saas": "http://data.europa.eu/esco/skill/S5.2.1",
    "blockchain": "http://data.europa.eu/esco/skill/S5.2.3",
    "performance marketing": "http://data.europa.eu/esco/skill/S5.6.0",
}


def _norm(s: str) -> str:
    return " ".join(str(s or "").strip().lower().replace("ё", "е").split())


def load_stub_map(path: Optional[Path] = None) -> Dict[str, str]:
    out = dict(_BUILTIN_STUB)
    p = path or STUB_PATH
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            mapping = data.get("label_to_esco") if isinstance(data, dict) else None
            if isinstance(mapping, dict):
                for k, v in mapping.items():
                    nk = _norm(str(k))
                    if nk and v:
                        out[nk] = str(v).strip()
        except Exception as exc:
            print(f"warn: stub file load failed: {exc}", file=sys.stderr)
    return out


def fetch_esco_for_label(label: str, *, timeout: float = 12.0) -> Optional[str]:
    """Best-effort ESCO API search. Returns concept URI or None."""
    q = urllib.parse.quote(label)
    # Public search endpoint used by ESCO portal (may change; stub is the fallback).
    url = (
        "https://ec.europa.eu/esco/api/search"
        f"?text={q}&language=en&type=skill&limit=1"
    )
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "autoro-hunt-esco-import/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError):
        return None
    except Exception:
        return None

    # Response shapes vary; try common paths
    candidates: List[Any] = []
    if isinstance(payload, dict):
        emb = payload.get("_embedded") or {}
        if isinstance(emb, dict):
            results = emb.get("results") or emb.get("skill") or []
            if isinstance(results, list):
                candidates.extend(results)
        if isinstance(payload.get("results"), list):
            candidates.extend(payload["results"])
    for row in candidates:
        if not isinstance(row, dict):
            continue
        uri = row.get("uri") or row.get("conceptUri") or (row.get("_links") or {}).get("self", {}).get("href")
        if uri:
            return str(uri)
    return None


def resolve_esco_id(
    labels: List[str],
    stub: Dict[str, str],
    *,
    fetch: bool,
) -> Tuple[Optional[str], str]:
    for lab in labels:
        n = _norm(lab)
        if not n:
            continue
        if n in stub:
            return stub[n], "stub"
        # substring soft match on stub keys
        for sk, uri in stub.items():
            if sk in n or n in sk:
                return uri, "stub_fuzzy"
    if fetch:
        for lab in labels:
            uri = fetch_esco_for_label(lab)
            if uri:
                return uri, "fetch"
    return None, "unmatched"


def merge_esco_into_doc(
    doc: Dict[str, Any],
    stub: Dict[str, str],
    *,
    fetch: bool,
    overwrite: bool,
) -> Dict[str, Any]:
    nodes = doc.get("nodes")
    if not isinstance(nodes, list):
        return doc
    filled = 0
    kept_null = 0
    for node in nodes:
        if not isinstance(node, dict):
            continue
        existing = node.get("esco_id")
        if existing and not overwrite:
            kept_null += 0
            continue
        labels = [str(x) for x in (node.get("labels") or [])]
        # Prefer English-ish first for API
        labels_sorted = sorted(labels, key=lambda s: (0 if all(ord(c) < 128 for c in s) else 1, s))
        uri, _how = resolve_esco_id(labels_sorted, stub, fetch=fetch)
        if uri:
            node["esco_id"] = uri
            filled += 1
        else:
            if "esco_id" not in node or overwrite:
                node["esco_id"] = None
            kept_null += 1
    doc["_esco_import"] = {
        "filled": filled,
        "unmatchedOrCleared": kept_null,
        "fetch": fetch,
        "overwrite": overwrite,
    }
    return doc


def write_targets(doc: Dict[str, Any], targets: List[Path], *, apply: bool) -> None:
    # Strip internal meta before write
    out = {k: v for k, v in doc.items() if not str(k).startswith("_")}
    text = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    for path in targets:
        if apply:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            print(f"wrote {path}")
        else:
            print(f"dry-run would write {path} ({len(text)} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description="ESCO → skill-synonyms.json import (offline-first)")
    ap.add_argument("--input", type=Path, default=None, help="Source synonyms JSON")
    ap.add_argument(
        "--target",
        action="append",
        type=Path,
        default=None,
        help="Output path (repeatable). Default: agent-api + repo data paths",
    )
    ap.add_argument("--stub", type=Path, default=STUB_PATH, help="Stub crosswalk JSON")
    ap.add_argument("--fetch", action="store_true", help="Try live ESCO API (network)")
    ap.add_argument("--overwrite", action="store_true", help="Replace non-null esco_id")
    ap.add_argument("--apply", action="store_true", help="Write files (default dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Explicit dry-run (default)")
    args = ap.parse_args()

    src = args.input or DEFAULT_TARGETS[0]
    if not src.is_file():
        raise SystemExit(f"missing synonyms file: {src}")
    doc = json.loads(src.read_text(encoding="utf-8"))
    if not isinstance(doc, dict) or not isinstance(doc.get("nodes"), list):
        raise SystemExit("invalid synonyms JSON: expected {version, nodes[]}")

    stub = load_stub_map(args.stub)
    merged = merge_esco_into_doc(doc, stub, fetch=bool(args.fetch), overwrite=bool(args.overwrite))
    meta = merged.get("_esco_import") or {}
    print(
        f"esco-import filled={meta.get('filled')} unmatched={meta.get('unmatchedOrCleared')} "
        f"fetch={meta.get('fetch')} stub_keys={len(stub)}"
    )
    targets = list(args.target) if args.target else list(DEFAULT_TARGETS)
    apply = bool(args.apply) and not bool(args.dry_run)
    write_targets(merged, targets, apply=apply)
    if not apply:
        print("hint: re-run with --apply to write skill-synonyms.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
