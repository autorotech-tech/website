import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("agent_main", ROOT / "main.py")
main = importlib.util.module_from_spec(spec)
sys.modules["agent_main"] = main
spec.loader.exec_module(main)


def test_strip_thinking_only_python_repr():
    raw = "[{'type': 'thinking', 'thinking': 'internal chain of thought'}]"
    assert main._normalize_llm_visible_content(raw) == ""


def test_extract_text_from_mixed_python_repr():
    raw = (
        "[{'type': 'thinking', 'thinking': 'hidden'}, "
        "{'type': 'text', 'text': 'Hello Phu Quoc'}]"
    )
    assert main._normalize_llm_visible_content(raw) == "Hello Phu Quoc"


def test_extract_text_from_list_blocks():
    content = [
        {"type": "thinking", "thinking": "hidden"},
        {"type": "text", "text": "Visible answer"},
    ]
    assert main._normalize_llm_visible_content(content) == "Visible answer"


def test_assistant_visible_text_ignores_reasoning_field():
    msg = {
        "content": "",
        "reasoning": "should not leak to telegram",
        "reasoning_content": "also hidden",
    }
    assert main._assistant_visible_text(msg) == ""


def test_plain_string_passthrough():
    assert main._normalize_llm_visible_content("Simple reply") == "Simple reply"
