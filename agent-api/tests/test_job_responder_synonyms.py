"""Tests for skill-synonyms.json merge into semantic term index."""

from __future__ import annotations

import json
from pathlib import Path

import job_responder_semantic as sem

ROOT = Path(__file__).resolve().parents[2]
SYNONYM_PATH = ROOT / "data" / "job-responder" / "skill-synonyms.json"


def test_skill_synonyms_file_exists_and_valid():
    assert SYNONYM_PATH.is_file()
    doc = json.loads(SYNONYM_PATH.read_text(encoding="utf-8"))
    assert doc.get("version") == 1
    assert isinstance(doc.get("nodes"), list) and len(doc["nodes"]) >= 5
    for node in doc["nodes"]:
        assert node.get("id")
        assert isinstance(node.get("labels"), list) and node["labels"]
        # nullable ontology ids
        assert "esco_id" in node
        assert node.get("esco_id") is None or isinstance(node.get("esco_id"), str)


def test_merge_adds_new_labels_code_wins_on_conflict():
    base = {"seo": "ppc_seo_crm", "marketing": "marketing"}
    doc = {
        "version": 1,
        "nodes": [
            {
                "id": "skill.seo",
                "cluster": "ppc_seo_crm",
                "labels": ["поисковая оптимизация", "seo"],
                "esco_id": None,
            },
            {
                "id": "skill.x",
                "cluster": "other",
                "labels": ["marketing"],
                "esco_id": None,
            },
        ],
    }
    merged = sem.merge_synonym_graph_into_index(base, doc, code_wins=True)
    assert merged["поисковая оптимизация"] == "ppc_seo_crm"
    # code wins: marketing stays marketing, not remapped to other
    assert merged["marketing"] == "marketing"
    assert merged["seo"] == "ppc_seo_crm"


def test_reload_picks_up_json_labels():
    n = sem.reload_synonym_index(SYNONYM_PATH)
    assert n > 50
    assert sem.cluster_for_phrase("поисковая оптимизация") == "ppc_seo_crm"
    assert sem.cluster_for_phrase("инференс") == "ai_automation"
    assert sem.cluster_for_phrase("llm inference") == "ai_automation"
    assert sem.synonym_label_count() >= 10
