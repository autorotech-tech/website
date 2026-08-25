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
    normalize_questions,
    parse_answers_json,
    score_resume_vs_vacancy,
    strip_profile_wrapper,
    wrap_content_with_profile,
)
from job_responder_semantic import build_semantic_grid, match_skills



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


def test_normalize_questions_mixed():
    qs = normalize_questions(
        [
            "Ваше имя",
            {"id": "42", "text": "Опыт AI?", "type": "paragraph", "options": []},
            {"text": "Ваше имя"},  # dup
            {"text": "Стек", "type": "multiple_choice", "options": ["n8n", "Python"]},
        ]
    )
    assert len(qs) == 3
    assert qs[0]["text"] == "Ваше имя"
    assert qs[1]["id"] == "42"
    assert qs[2]["options"] == ["n8n", "Python"]


def test_parse_answers_json_fence_and_hh():
    raw = '```json\n[{"question":"Q1","answer":"A — test → «ok»"}]\n```'
    ans = parse_answers_json(raw)
    assert ans is not None
    assert ans[0]["question"] == "Q1"
    assert ans[0]["answer"] == 'A - test -> "ok"'


def test_semantic_marketing_skills_not_false_missing():
    """HH phrases like 'b2c маркетинг' must match Growth/ROAS/GMV evidence."""
    vacancy = JobResponderVacancyPayload(
        url="https://hh.ru/vacancy/1",
        title="Маркетолог B2C",
        company="Shop",
        description="Ищем маркетолога",
        structured=JobResponderVacancyStructured(
            keySkills=[
                "b2c маркетинг",
                "анализ эффективности маркетинговых кампаний",
                "маркетинговые метрики",
                "маркетинговый анализ",
                "планирование бюджета",
            ],
            workFormat="удалённо",
        ),
    )
    resume_rows = [
        {
            "id": 1,
            "title": "CV Growth Marketing",
            "kind": "job_resume",
            "content_text": (
                "Skills: Growth Marketing, Performance Marketing, PPC, SEO, CRM. "
                "Metrics: GMV, GP, ROAS, CPA. Campaign analysis and A/B tests. "
                "Media budget planning. Remote."
            ),
            "ai_summary": "",
        }
    ]
    out = score_resume_vs_vacancy(vacancy, resume_rows)
    missing_joined = " ".join(out.get("missing") or []).lower()
    assert "b2c" not in missing_joined
    assert "маркетинговые метрики" not in missing_joined
    assert "планирование бюджета" not in missing_joined
    assert out["score"] >= 50
    assert out.get("semanticMatches") or any("семантика" in m.lower() for m in (out.get("matched") or []))
    assert out.get("semanticGrid", {}).get("clusterCount", 0) >= 1


def test_semantic_grid_evidence_from_blob():
    profile = {
        "skills": ["growth marketing", "ppc", "seo"],
        "tools": [],
        "roles": ["marketer"],
        "domains": ["marketing"],
        "experience_bullets": ["Grew GMV and ROAS via paid acquisition"],
        "source_titles": ["CV"],
        "source_count": 1,
        "_text_blob": "growth marketing ppc seo crm gmv gp roas media budget campaign analysis remote",
    }
    grid = build_semantic_grid(profile)
    assert "marketing" in grid["clusters"]
    assert "marketing_metrics" in grid["clusters"]
    hits, miss = match_skills(
        ["b2c маркетинг", "маркетинговые метрики", "планирование бюджета", "quantum physics"],
        grid,
        resume_blob=profile["_text_blob"],
        resume_exact=profile["skills"],
    )
    assert len(hits) >= 3
    assert any("quantum" in m.lower() for m in miss)
