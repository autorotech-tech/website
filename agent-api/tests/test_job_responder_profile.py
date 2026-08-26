"""Job Responder profile slots, dedupe hash, RAG cap."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from job_responder import (
    JobResponderVacancyPayload,
    JobResponderVacancyStructured,
    cap_rag_items,
    collect_generate_contacts,
    collect_generate_links,
    ensure_contacts_in_cover_letter,
    ensure_links_in_cover_letter,
    extract_contacts_from_cover_template,
    extract_contacts_from_rag_edits,
    extract_labeled_links_from_text,
    extract_resume_profile,
    extract_urls_from_text,
    finalize_cover_letter_contacts_and_links,
    format_contacts_block,
    format_structured_overrides_document,
    merge_profiles_from_rows,
    near_duplicate_hash,
    normalize_profile_overrides,
    normalize_questions,
    parse_answers_json,
    parse_telegram_handle,
    sanitize_vacancy_skills,
    score_resume_vs_vacancy,
    strip_embellished_language_claims,
    strip_empty_markdown_headings,
    strip_profile_wrapper,
    validate_and_rewrite_cover_letter_v1,
    vacancy_to_match_blob,
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


_SMOKE_LINKS_BLOCK = """## Ссылки
резюме: https://autoro.tech/resume/
youtube: https://www.youtube.com/@iq_boosted
LinkedIn: https://www.linkedin.com/in/vlad-autoro-tech/
профиль на форуме по интернет маркетингу: https://www.blackhatworld.com/members/vlad_x.1811065/
видео-демо процессов e-commerce: https://youtu.be/v2_zmJrlMks
видео-демо о тестирование гипотезы: https://youtu.be/AJtcYfItspM
"""


def test_extract_labeled_links_five_urls():
    links = extract_labeled_links_from_text(_SMOKE_LINKS_BLOCK)
    urls = {lk["url"] for lk in links}
    assert "https://autoro.tech/resume/" in urls
    assert "https://www.youtube.com/@iq_boosted" in urls
    assert "https://www.linkedin.com/in/vlad-autoro-tech/" in urls
    assert "https://www.blackhatworld.com/members/vlad_x.1811065/" in urls
    assert "https://youtu.be/v2_zmJrlMks" in urls
    assert "https://youtu.be/AJtcYfItspM" in urls
    assert not any("example.com" in u or "jr-smoke" in u for u in urls)
    assert any(lk.get("label") == "LinkedIn" for lk in links)


def test_ensure_links_in_letter_from_overrides_and_instructions():
    overrides = extract_contacts_from_rag_edits(_SMOKE_LINKS_BLOCK)
    assert overrides.get("резюме") or any("autoro.tech/resume" in str(v) for v in overrides.values())
    links = collect_generate_links(
        cover_template="[CONTACTS]\nTelegram: @autoro_tech\nEmail: autoro.tech@gmail.com\n",
        overrides=overrides,
        merged={"rag_edits": _SMOKE_LINKS_BLOCK},
        prompt_extra=_SMOKE_LINKS_BLOCK,
    )
    urls = [lk["url"] for lk in links]
    for need in (
        "https://autoro.tech/resume/",
        "https://www.youtube.com/@iq_boosted",
        "https://www.linkedin.com/in/vlad-autoro-tech/",
        "https://www.blackhatworld.com/members/vlad_x.1811065/",
        "https://youtu.be/v2_zmJrlMks",
        "https://youtu.be/AJtcYfItspM",
    ):
        assert need in urls
    letter = "# ОТКЛИК\n\nПривет.\n\n## Контакты\n- Telegram: @iq_boosted\n- Ссылка: https://linkedin.com/in/x\n"
    contacts = collect_generate_contacts(
        cover_template="[CONTACTS]\nTelegram: @autoro_tech\nEmail: a@b.com\n",
        overrides=overrides,
        merged={},
    )
    out = finalize_cover_letter_contacts_and_links(letter, contacts=contacts, links=links)
    assert "## Ссылки" in out
    assert "## Контакты" in out
    assert "@autoro_tech" in out
    assert "Ссылка:" not in out.split("## Контакты")[-1].split("##")[0]
    for need in (
        "https://autoro.tech/resume/",
        "https://www.youtube.com/@iq_boosted",
        "https://www.linkedin.com/in/vlad-autoro-tech/",
        "https://www.blackhatworld.com/members/vlad_x.1811065/",
        "https://youtu.be/v2_zmJrlMks",
        "https://youtu.be/AJtcYfItspM",
    ):
        assert need in out
    assert "jr-smoke" not in out
    assert "example.com" not in out


def test_links_from_prompt_extra_only():
    links = collect_generate_links(prompt_extra=_SMOKE_LINKS_BLOCK)
    assert len(links) >= 5
    out = ensure_links_in_cover_letter("Текст письма без ссылок.", links)
    assert out.count("https://autoro.tech/resume/") == 1
    assert "## Ссылки" in out


def test_structured_overrides_document_keeps_links_section():
    parsed = extract_contacts_from_rag_edits(_SMOKE_LINKS_BLOCK)
    doc = format_structured_overrides_document(_SMOKE_LINKS_BLOCK, parsed)
    assert "## Ссылки" in doc
    assert "autoro.tech/resume" in doc
    assert "youtu.be/v2_zmJrlMks" in doc


_YOUTUBE_FOOTER_DUMP = """
## Ссылки
Ссылка: https://youtu.be/AJtcYfItspM
Ссылка: https://youtu.be/
Ссылка: https://www.youtube.com/about/
Ссылка: https://www.youtube.com/about/press/
Ссылка: https://www.youtube.com/about/copyright/
Ссылка: https://www.youtube.com/creators/
Ссылка: https://www.youtube.com/ads/
Ссылка: https://developers.google.com/youtube
Ссылка: https://www.youtube.com/t/terms
Ссылка: https://www.youtube.com/about/policies/
https://www.youtube.com/about/press/
"""


def test_reject_youtube_footer_crawl_links():
    """Cover letter must never append YouTube about/footer crawl URLs."""
    from job_responder import is_junk_profile_link_url, is_relevant_link_url

    junk = [
        "https://youtu.be/",
        "https://www.youtube.com/about/",
        "https://www.youtube.com/about/press/",
        "https://www.youtube.com/about/copyright/",
        "https://www.youtube.com/creators/",
        "https://www.youtube.com/ads/",
        "https://developers.google.com/youtube",
        "https://www.youtube.com/t/terms",
        "https://www.youtube.com/about/policies/",
    ]
    for u in junk:
        assert is_junk_profile_link_url(u), u
        assert not is_relevant_link_url(u), u

    # Polluted profile.links (empty titles = crawl dump) must not enter ## Ссылки
    polluted = {
        "links": [{"url": u, "title": ""} for u in junk]
        + [{"url": "https://www.youtube.com/about/", "title": "About"}]
        + [{"url": "https://youtu.be/AJtcYfItspM", "title": "Ссылка"}],
        "rag_edits": _SMOKE_LINKS_BLOCK,
    }
    links = collect_generate_links(
        cover_template=_SMOKE_LINKS_BLOCK,
        overrides=extract_contacts_from_rag_edits(_SMOKE_LINKS_BLOCK),
        merged=polluted,
        prompt_extra="",
    )
    urls = [lk["url"] for lk in links]
    for need in (
        "https://autoro.tech/resume/",
        "https://www.youtube.com/@iq_boosted",
        "https://www.blackhatworld.com/members/vlad_x.1811065/",
        "https://youtu.be/v2_zmJrlMks",
        "https://youtu.be/AJtcYfItspM",
    ):
        assert need in urls
    for bad in junk:
        assert bad not in urls
    assert "youtube.com/about" not in " ".join(urls)
    assert "developers.google.com" not in " ".join(urls)

    dirty_letter = (
        "# ОТКЛИК\n\nHi\n\n## Ссылки\n"
        + "\n".join(f"Ссылка: {u}" for u in junk)
    )
    out = ensure_links_in_cover_letter(dirty_letter, links)
    assert "## Ссылки" in out
    assert "autoro.tech/resume" in out
    section = out.split("## Ссылки")[-1]
    assert "youtube.com/about" not in section
    assert "developers.google.com" not in section
    assert "https://youtu.be/\n" not in section and "https://youtu.be/ " not in section
    # Labels preserved
    assert "резюме:" in section.lower() or "резюме:" in section
    assert "youtube:" in section.lower()
    for need in (
        "https://autoro.tech/resume/",
        "https://www.youtube.com/@iq_boosted",
        "https://youtu.be/v2_zmJrlMks",
        "https://youtu.be/AJtcYfItspM",
    ):
        assert need in section


def test_bare_urls_not_harvested_from_blob():
    blob = "See also https://www.youtube.com/about/press/ and https://developers.google.com/youtube"
    assert extract_labeled_links_from_text(blob) == []
    from job_responder import extract_urls_from_text

    extracted = extract_urls_from_text(blob)
    assert extracted == []


def test_youtube_at_handle_never_becomes_telegram():
    assert parse_telegram_handle("https://www.youtube.com/@iq_boosted") == ""
    assert parse_telegram_handle("@autoro_tech") == "@autoro_tech"
    assert parse_telegram_handle("https://t.me/autoro_tech") == "@autoro_tech"
    blob = (
        "[CONTACTS]\nTelegram: @autoro_tech\nEmail: autoro.tech@gmail.com\n\n"
        + _SMOKE_LINKS_BLOCK
    )
    parsed = extract_contacts_from_rag_edits(blob)
    assert parsed.get("telegram") == "@autoro_tech"
    contacts = collect_generate_contacts(cover_template=blob, overrides=parsed, merged={})
    assert contacts.get("telegram") == "@autoro_tech"
    assert "iq_boosted" not in (contacts.get("telegram") or "")
    letter = (
        "# ОТКЛИК\n\nHi\n\n## Контакты\n- Telegram: @iq_boosted\n- Email: x@y.com\n"
        "- Ссылка: https://www.linkedin.com/in/vlad-autoro-tech/\n"
    )
    links = collect_generate_links(cover_template=blob, overrides=parsed, merged={})
    out, meta = validate_and_rewrite_cover_letter_v1(letter, contacts=contacts, links=links)
    assert "- Telegram: @autoro_tech" in out
    assert "@iq_boosted" not in out.split("## Контакты")[-1].split("## Ссылки")[0]
    assert "Ссылка:" not in out.split("## Контакты")[-1].split("## Ссылки")[0]
    assert "LinkedIn: https://www.linkedin.com/in/vlad-autoro-tech/" in out
    assert "видео-демо о тестирование гипотезы" in out
    assert "https://youtu.be/AJtcYfItspM" in out
    assert meta.get("rewroteContacts") and meta.get("rewroteLinks")
    block = format_contacts_block(contacts)
    assert "LinkedIn" not in block
    assert "Ссылка" not in block


def test_sanitize_hh_chrome_skills():
    junk = [
        "2рабочие часы: 8формат работы: удалённосейчас эту вакансию смотр с amocrm",
        "2рабочие часы: 8формат работы: удалённосейчас эту вакансию смотрят 14 человеко 8",
        "bitrix24. опыт работы с manychat или аналогичными платформами автоматизации. баз",
        "прямо сейчас трансформируют бизнес. опыт ежедневной ра не указанопыт работы: 1–3",
        "amoCRM",
        "Bitrix24",
    ]
    clean = sanitize_vacancy_skills(junk)
    joined = " ".join(clean).lower()
    assert "смотр" not in joined
    assert "челове" not in joined
    assert "рабочие" not in joined
    assert "формат" not in joined
    assert any("amocrm" in s.lower() for s in clean)
    assert any("bitrix" in s.lower() for s in clean)
    assert any("manychat" in s.lower() for s in clean)
    vac = JobResponderVacancyPayload(
        url="https://hh.ru/vacancy/136608322",
        title="Growth",
        description="Нужен опыт с amoCRM и Bitrix24 и ManyChat",
        structured=JobResponderVacancyStructured(keySkills=junk, workFormat="удалённо"),
    )
    prof = vacancy_to_match_blob(vac)
    miss_blob = " ".join(prof.get("skills") or []).lower()
    assert "смотр" not in miss_blob
    assert "челове" not in miss_blob
    out = score_resume_vs_vacancy(vac, [])
    missing_joined = " ".join(out.get("missing") or []).lower()
    assert "смотр" not in missing_joined
    assert "рабочие часы" not in missing_joined


def test_strip_cefr_embellish_when_profile_says_proficient():
    letter = (
        "3. **English Proficiency (C1-C2)** - Свободно владею английским на продвинутом уровне, "
        "что необходимо для переговоров."
    )
    profile = "Языки: Русский (Native), Английский (Proficient)"
    out, fixes = strip_embellished_language_claims(letter, profile)
    assert "C1" not in out and "C2" not in out
    assert "Свободно владею" not in out
    assert "Proficient" in out
    assert fixes
