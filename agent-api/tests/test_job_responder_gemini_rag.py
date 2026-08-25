"""Unit tests for Gemini File Search RAG helpers."""

from job_responder_gemini_rag import (
    parse_doc_from_tags,
    parse_hash_from_tags,
    tag_content_hash,
    tag_doc_name,
    _merge_gemini_tags,
)


def test_tag_roundtrip():
    doc = "fileSearchStores/ws1/documents/abc"
    h = "deadbeef"
    tags = _merge_gemini_tags(["cv"], doc, h)
    assert tag_doc_name(doc) in tags
    assert tag_content_hash(h) in tags
    assert parse_doc_from_tags(tags) == doc
    assert parse_hash_from_tags(tags) == h


def test_merge_replaces_old_gemini_tags():
    old_doc = tag_doc_name("fileSearchStores/old/documents/x")
    tags = _merge_gemini_tags([old_doc, "notes"], "fileSearchStores/new/documents/y", "hash2")
    assert old_doc not in tags
    assert tag_doc_name("fileSearchStores/new/documents/y") in tags
    assert "notes" in tags
