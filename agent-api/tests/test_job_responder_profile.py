"""Job Responder profile slots, dedupe hash, RAG cap."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import (
    JobResponderVacancyPayload,
    JobResponderVacancyStructured,
    cap_rag_items,
    collect_generate_contacts,
    ensure_contacts_in_cover_letter,
    extract_contacts_from_cover_template,
    extract_contacts_from_rag_edits,
    extract_resume_profile,
    extract_urls_from_text,
    format_structured_overrides_document,
    merge_profiles_from_rows,
    near_duplicate_hash,
    normalize_profile_overrides,
    normalize_questions,
    parse_answers_json,
    score_resume_vs_vacancy,
    strip_empty_markdown_headings,
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


def test_extract_contacts_from_freeform_russian():
    text = "Поменяй контакты в базе Telegram: @autoro_tech ->\nemail: autoro.tech@gmail.com"
    parsed = extract_contacts_from_rag_edits(text)
    assert parsed.get("telegram") == "@autoro_tech"
    assert parsed.get("email") == "autoro.tech@gmail.com"
    assert normalize_profile_overrides(text) == parsed
    doc = format_structured_overrides_document(text, parsed)
    assert "telegram: @autoro_tech" in doc
    merged = merge_profiles_from_rows(
        [
            {
                "id": 1,
                "title": "CV",
                "kind": "job_resume",
                "content_text": "Telegram https://t.me/old_handle\nemail old@x.com",
                "ai_summary": "",
            },
            {
                "id": 2,
                "title": "Overrides",
                "kind": "job_profile_overrides",
                "category": "overrides",
                "content_text": doc,
                "ai_summary": "",
            },
        ]
    )
    assert merged.get("telegram") == "@autoro_tech"
    assert merged.get("email") == "autoro.tech@gmail.com"


def test_ensure_contacts_appended_from_template():
    template = """[COVER_TEMPLATE]
Приветствие: Здравствуйте!
CTA: Готов обсудить.

[CONTACTS]
Telegram: @autoro_tech
Email: autoro.tech@gmail.com
"""
    contacts = extract_contacts_from_cover_template(template)
    assert contacts["telegram"] == "@autoro_tech"
    assert contacts["email"] == "autoro.tech@gmail.com"
    letter = "Здравствуйте!\n\nПодхожу по стеку.\n\n##\n"
    out = ensure_contacts_in_cover_letter(letter, contacts)
    assert "##" not in out.split("Контакты")[0] or "Контакты" in out
    assert "@autoro_tech" in out
    assert "autoro.tech@gmail.com" in out
    assert "## Контакты" in out
    # Idempotent
    out2 = ensure_contacts_in_cover_letter(out, contacts)
    assert out2.count("@autoro_tech") == 1


def test_ensure_contacts_strips_experience_and_smoke_url():
    """## Контакты must not keep experience bullets or jr-smoke URLs."""
    dirty = """# ОТКЛИК

## СОПРОВОДИТЕЛЬНОЕ ПИСЬМО
Привет.

## Контакты
- ai/agentic: агенты и RAG
- маркетинг: performance
- e-commerce: Shopify
- Portfolio: https://example.com/jr-smoke
- Telegram: @wrong_bot
- Email: wrong@x.com
"""
    contacts = collect_generate_contacts(
        cover_template="[CONTACTS]\nTelegram: @autoro_tech\nEmail: autoro.tech@gmail.com\n",
        overrides={},
        merged={
            "links": [{"url": "https://example.com/jr-smoke", "title": "portfolio"}],
            "experience_bullets": ["ai/agentic", "маркетинг"],
        },
    )
    assert "link" not in contacts or "jr-smoke" not in str(contacts.get("link") or "")
    assert "portfolio" not in contacts or "jr-smoke" not in str(contacts.get("portfolio") or "")
    assert contacts.get("telegram") == "@autoro_tech"
    assert contacts.get("email") == "autoro.tech@gmail.com"
    out = ensure_contacts_in_cover_letter(dirty, contacts)
    assert "jr-smoke" not in out
    assert "example.com" not in out
    assert "ai/agentic" not in out.split("## Контакты")[-1]
    assert "маркетинг" not in out.split("## Контакты")[-1]
    assert "e-commerce" not in out.split("## Контакты")[-1]
    section = out.split("## Контакты")[-1]
    assert "@autoro_tech" in section
    assert "autoro.tech@gmail.com" in section
    assert section.count("\n- ") == 2


def test_collect_contacts_ignores_non_contact_overrides():
    contacts = collect_generate_contacts(
        overrides={
            "telegram": "@autoro_tech",
            "email": "autoro.tech@gmail.com",
            "опыт": "10 лет ai/agentic",
            "skills": "python, n8n",
        },
        merged={"links": [{"url": "https://example.com/jr-smoke", "title": "portfolio"}]},
    )
    assert set(contacts.keys()) == {"telegram", "email"}
    assert "jr-smoke" not in str(contacts)


def test_collect_generate_contacts_priority_template_over_overrides():
    contacts = collect_generate_contacts(
        cover_template="[CONTACTS]\nTelegram: @from_template\nEmail: t@x.com",
        overrides={"telegram": "@from_override", "email": "o@x.com"},
        merged={"telegram": "@from_profile", "email": "p@x.com"},
    )
    assert contacts["telegram"] == "@from_template"
    assert contacts["email"] == "t@x.com"


def test_strip_empty_headings():
    assert strip_empty_markdown_headings("Hi\n\n##\n") == "Hi"
    assert strip_empty_markdown_headings("Hi\n## Контакты\n") == "Hi"


def test_semantic_hh_phrases_without_english_acronyms():
    """HH skill names must match Growth/Performance CV even without ROAS/GMV tokens."""
    vacancy = JobResponderVacancyPayload(
        url="https://hh.ru/vacancy/1",
        title="Маркетолог",
        company="X",
        description="Нужен маркетинг",
        structured=JobResponderVacancyStructured(
            keySkills=[
                "анализ эффективности маркетинговых кампаний",
                "маркетинговые метрики",
                "маркетинговый анализ",
                "планирование бюджета",
            ],
        ),
    )
    resume_rows = [
        {
            "id": 1,
            "title": "CV Performance",
            "kind": "job_resume",
            "content_text": (
                "Маркетолог, performance-маркетинг, digital. "
                "Работал с кампаниями и метриками, планирование."
            ),
            "ai_summary": "",
        }
    ]
    out = score_resume_vs_vacancy(vacancy, resume_rows)
    missing_joined = " ".join(out.get("missing") or []).lower()
    for phrase in (
        "анализ эффективности маркетинговых кампаний",
        "маркетинговые метрики",
        "маркетинговый анализ",
        "планирование бюджета",
    ):
        assert phrase not in missing_joined
    assert out.get("matchedSemantic") or out.get("semanticMatches")
    assert out.get("semanticGrid", {}).get("clusterCount", 0) >= 3
