"""Unit tests for bookmark tag/category normalization."""

import importlib.util
import sys
from pathlib import Path

import pytest

_API_ROOT = Path(__file__).resolve().parents[1]
_MAIN_PATH = _API_ROOT / "main.py"
_spec = importlib.util.spec_from_file_location("agent_api_main", _MAIN_PATH)
assert _spec and _spec.loader
_main = importlib.util.module_from_spec(_spec)
sys.modules["agent_api_main"] = _main
_spec.loader.exec_module(_main)

normalize_tags = _main.normalize_tags
normalize_category = _main.normalize_category
normalize_single_tag = _main.normalize_single_tag


@pytest.mark.parametrize(
    "raw,expected",
    [
        (["Agents", "TOOLS"], ["agent", "tool"]),
        (["LLMs", "embeddings"], ["llm", "embedding"]),
        (["  API ", "apis"], ["api"]),
        (["notes", "Bookmarks"], ["note", "bookmark"]),
        ([], []),
        (["postgres", "kubernetes"], ["postgres", "kubernetes"]),
    ],
)
def test_normalize_tags(raw, expected):
    assert normalize_tags(raw) == expected


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("AI-ML", "ai-ml"),
        ("dev_tools", "dev-tools"),
        ("Marketing", "marketing"),
        ("unknown-xyz", "general"),
        ("", "general"),
        ("prompt", "prompt"),
    ],
)
def test_normalize_category(raw, expected):
    assert normalize_category(raw) == expected


def test_normalize_single_tag_alias():
    schema = _main.get_tags_schema()
    aliases = schema.get("tag_aliases", {})
    assert normalize_single_tag("agents", aliases) == "agent"
