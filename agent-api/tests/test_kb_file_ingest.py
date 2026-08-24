"""Tests for kb_file_ingest text extraction and caption hints."""

import io
import json
import sys
import zipfile
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kb_file_ingest import (
    extract_text_from_bytes,
    parse_file_ingest_hints,
    sanitize_extracted_text,
    sha256_hex,
)


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


def test_sanitize_strips_nul():
    assert "\x00" not in sanitize_extracted_text("hello\x00world")
    assert sanitize_extracted_text("hello\x00world") == "helloworld"


def test_pdf_nul_bytes_do_not_leak():
    data = (
        b"%PDF-1.4\n"
        b"(Hello Resume Portfolio Text Content Here)\n"
        b"(bad\x00binary fragment should be cleaned)\n"
        b"%%EOF"
    )
    text, meta = extract_text_from_bytes("cv.pdf", data, "application/pdf")
    assert "\x00" not in text
    assert "Hello Resume" in text
    assert meta["method"].startswith("pdf_")


def test_pdf_flate_stream_extract():
    payload = b"BT (Inflated CV content for Job Responder upload test) Tj ET"
    stream = zlib.compress(payload)
    data = b"%PDF-1.4\nstream\n" + stream + b"\nendstream\n%%EOF"
    text, meta = extract_text_from_bytes("resume.pdf", data, "application/pdf")
    assert "\x00" not in text
    assert "Inflated CV content" in text
    assert meta["method"] in {"pdf_flate", "pdf_pypdf", "pdf_literals"}


def test_docx_extract():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(
            "word/document.xml",
            (
                '<?xml version="1.0"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Docx resume experience block</w:t></w:r></w:p></w:body>"
                "</w:document>"
            ),
        )
        zf.writestr("[Content_Types].xml", "<Types></Types>")
    text, meta = extract_text_from_bytes(
        "cv.docx",
        buf.getvalue(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    assert "Docx resume" in text
    assert meta["method"] == "docx"
