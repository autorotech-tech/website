"""Job Responder profile slots, dedupe hash, RAG cap."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import (
    JobResponderVacancyPayload,
    JobResponderVacancyStructured,
    cap_rag_items,
    extract_resume_profile,
    extract_urls_from_text,
    near_duplicate_hash,
    score_resume_vs_vacancy,
    strip_profile_wrapper,
    wrap_content_with_profile,
)


def test_profile_slots_and_links():
    text = (
        "Skills: Python, n8n, FastAPI\n"
        "Опыт: разработал RAG-пайплайн для откликов HH\n"
        "Образование: бакалавр информатики МГУ 2014\n"
        "Достижение: сертификат AWS\n"
        "https://github.com/example/job-responder\n"
    )
    profile = extract_resume_profile(text, title="CV", category="cv")
    assert "python" in [s.lower() for s in profile["skills"]] or "n8n" in profile["tools"]
    assert profile["experience_bullets"]
    assert profile["education"]
    assert profile["links"]
    assert profile["links"][0]["url"].startswith("http")


def test_near_duplicate_hash_ignores_wrapper_and_whitespace():
    a = "Hello   world\n\nPython"
    b = wrap_content_with_profile("Hello world Python", extract_resume_profile("Hello world Python"))[0]
    assert near_duplicate_hash(a) == near_duplicate_hash(strip_profile_wrapper(b))


def test_cap_rag_prefers_cv():
    rows = [
        {"id": 2, "kind": "job_experience", "updated_at": "2"},
        {"id": 1, "kind": "job_resume", "updated_at": "1"},
        {"id": 3, "kind": "job_experience", "updated_at": "3"},
    ]
    capped, truncated = cap_rag_items(rows, max_n=2)
    assert truncated is True
    assert capped[0]["kind"] == "job_resume"
    assert len(capped) == 2


def test_extract_urls_unique():
    urls = extract_urls_from_text("See https://a.example/x and https://a.example/x/")
    assert len(urls) == 1


def test_score_tools_deterministic():
    vacancy = JobResponderVacancyPayload(
        url="https://example.com/job",
        title="AI Video Creator",
        company="TestCo",
        description=(
            "Нужен опыт серийного ИИ-контента. Инструменты: LLM (ChatGPT, Claude, Gemini), "
            "ComfyUI, n8n. Формат удалённый."
        ),
        structured=JobResponderVacancyStructured(
            keySkills=["n8n", "ComfyUI", "LLM"],
            workFormat="удалённо",
            experience="3 года",
        ),
    )
    resume_rows = [
        {
            "id": 1,
            "title": "CV",
            "kind": "job_resume",
            "content_text": (
                "Skills: n8n, ComfyUI, ChatGPT, Claude, Gemini, Python. "
                "Опыт 4 года AI video automation. Remote / удалёнка."
            ),
            "ai_summary": "",
        }
    ]
    a = score_resume_vs_vacancy(vacancy, resume_rows)
    b = score_resume_vs_vacancy(vacancy, resume_rows)
    assert a["score"] == b["score"]
    assert a["score"] >= 60
    assert a["matchedTools"]
    assert any("n8n" in x or "comfyui" in x for x in a["matchedTools"])
    assert a["matched"]
    assert "rationale" in a


def test_score_empty_resume():
    vacancy = JobResponderVacancyPayload(
        url="https://example.com/job",
        title="Dev",
        description="Need Python and FastAPI developer remote",
    )
    out = score_resume_vs_vacancy(vacancy, [])
    assert out["score"] == 0
    assert out["missing"]
