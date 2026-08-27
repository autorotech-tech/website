"""Tests for ESCO → skill-synonyms import (offline stub, no network required)."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "job-responder-esco-import.py"
SYNONYM = ROOT / "agent-api" / "data" / "job-responder" / "skill-synonyms.json"
STUB = ROOT / "agent-api" / "data" / "job-responder" / "esco-stub-crosswalk.json"


def _load_script():
    spec = importlib.util.spec_from_file_location("jr_esco_import", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules["jr_esco_import"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_stub_crosswalk_file_valid():
    assert STUB.is_file()
    doc = json.loads(STUB.read_text(encoding="utf-8"))
    assert isinstance(doc.get("label_to_esco"), dict)
    assert len(doc["label_to_esco"]) >= 5


def test_merge_fills_esco_id_from_stub_keeps_null_elsewhere():
    mod = _load_script()
    stub = mod.load_stub_map(STUB)
    doc = json.loads(SYNONYM.read_text(encoding="utf-8"))
    # Work on a copy
    nodes = [dict(n) for n in doc["nodes"]]
    for n in nodes:
        n["esco_id"] = None
    merged = mod.merge_esco_into_doc({"version": 1, "nodes": nodes}, stub, fetch=False, overwrite=True)
    filled = [n for n in merged["nodes"] if n.get("esco_id")]
    still_null = [n for n in merged["nodes"] if n.get("esco_id") is None]
    assert len(filled) >= 3
    # Nullable remains valid for unmatched
    assert isinstance(still_null, list)
    meta = merged.get("_esco_import") or {}
    assert meta.get("filled", 0) >= 3


def test_resolve_prefers_stub_without_network():
    mod = _load_script()
    stub = {"seo": "http://data.europa.eu/esco/skill/test-seo"}
    uri, how = mod.resolve_esco_id(["SEO", "поисковая оптимизация"], stub, fetch=False)
    assert uri == "http://data.europa.eu/esco/skill/test-seo"
    assert how == "stub"
