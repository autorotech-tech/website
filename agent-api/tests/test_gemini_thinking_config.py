import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("agent_main", ROOT / "main.py")
main = importlib.util.module_from_spec(spec)
sys.modules["agent_main"] = main
spec.loader.exec_module(main)


def test_gemini_model_uses_thinking():
    assert main._gemini_model_uses_thinking("gemini-2.5-flash")
    assert main._gemini_model_uses_thinking("gemini-3.5-flash")
    assert not main._gemini_model_uses_thinking("gemini-2.0-flash")


def test_gemini_native_generation_config_disables_thinking():
    cfg = main._gemini_native_generation_config("gemini-2.5-flash", maxOutputTokens=512)
    assert cfg["thinkingConfig"] == {"thinkingBudget": 0}
    assert cfg["maxOutputTokens"] == 512


def test_gemini_openai_extra_body():
    extra = main._gemini_openai_extra_body("gemini-2.5-flash")
    assert extra == {"google": {"thinking_config": {"thinking_budget": 0}}}
