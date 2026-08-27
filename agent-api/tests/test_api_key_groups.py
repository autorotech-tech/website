import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("agent_api_main", ROOT / "main.py")
main = importlib.util.module_from_spec(spec)
sys.modules["agent_api_main"] = main
spec.loader.exec_module(main)


GROUPS = [
    {
        "name": "Gemini Fast (Flash)",
        "keys": ["AIzaSyAAA", "AIzaSyBBB"],
    },
    {
        "name": "Groq Fast (Llama 3)",
        "provider": "groq",
        "keys": ["gsk_one", "gsk_two"],
    },
    {
        "name": "GLM Fast (Flash)",
        "provider": "glm",
        "keys": ["glm_key_1"],
    },
    {
        # provider intentionally empty — inferred from name for pool merge / rotation
        "name": "OpenRouter Fast",
        "keys": ["sk-or-v1-test"],
    },
]


def test_select_api_key_group_keys_gemini_infers_from_name():
    # Untagged \"Gemini Fast\" must still join gemini pool (name inference).
    keys = main._select_api_key_group_keys(GROUPS, desired_provider="gemini")
    assert keys == ["AIzaSyAAA", "AIzaSyBBB"]


def test_select_api_key_group_keys_gemini_with_tagged_group():
    groups = [
        {"name": "Gemini pool", "provider": "gemini", "keys": ["AIzaSyCCC"]},
        *GROUPS,
    ]
    keys = main._select_api_key_group_keys(groups, desired_provider="gemini")
    assert keys == ["AIzaSyCCC", "AIzaSyAAA", "AIzaSyBBB"]


def test_select_api_key_group_keys_openrouter_infers_from_name():
    keys = main._select_api_key_group_keys(GROUPS, desired_provider="openrouter")
    assert keys == ["sk-or-v1-test"]


def test_select_api_key_group_keys_anonymous_name_excluded_for_provider_filter():
    groups = [{"name": "Misc shared", "keys": ["shared_key"]}]
    assert main._select_api_key_group_keys(groups, desired_provider="openrouter") == []


def test_select_api_key_group_keys_untagged_fallback_only_without_provider_filter():
    keys = main._select_api_key_group_keys(GROUPS, desired_provider="")
    assert "gsk_one" in keys
    assert "AIzaSyAAA" in keys


def test_gemini_chat_key_pool_filters_non_aiza_keys():
    settings = {
        "gemini_keys": ["AIzaSyGOOD", "gsk_bad"],
        "gemini_api_key": "sk-or_bad",
    }
    pool = main._gemini_chat_key_pool(settings, group_gemini_keys=["AIzaSyGROUP", "glm_bad"])
    assert pool == ["AIzaSyGOOD", "AIzaSyGROUP"]
