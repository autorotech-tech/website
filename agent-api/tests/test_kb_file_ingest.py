"""Tests for kb_file_ingest text extraction and caption hints."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kb_file_ingest import extract_text_from_bytes, parse_file_ingest_hints, sha256_hex


def test_extract_markdown():
    data = b"# Title\n\nBody text for KB."
    text, meta = extract_text_from_bytes("note.md", data, "text/markdown")
    assert "Body text" in text
    assert meta["method"] == "text"


def test_extract_json():
    payload = {"items": [{"id": 1, "name": "alpha"}]}
    data = json.dumps(payload).encode()
    text, meta = extract_text_from_bytes("data.json", data, "application/json")
    assert "alpha" in text
    assert meta["method"] == "json"


def test_parse_caption_hints():
    hints = parse_file_ingest_hints("#kb #development #dev-tools RFC auth refactor")
    assert hints["kind"] == "development"
    assert hints["category"] == "dev-tools"
    assert hints["title"] == "RFC auth refactor"


def test_sha256():
    assert len(sha256_hex(b"hello")) == 64
