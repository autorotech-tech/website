"""Job Responder: Resume RAG slice + HH cover letter / question generation."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

from fastapi import Header, HTTPException, Request
from pydantic import BaseModel, Field

RESUME_KINDS = ("job_resume", "job_experience", "job_skills")
RESUME_SOURCE = "job_responder"
RESUME_TAGS = ["job-responder", "hh"]
PRIMARY_CV_KIND = "job_resume"

HOST_LABELS = {"ru": "hh.ru", "kz": "hh.kz", "uz": "hh.uz"}


def hh_format_text(text: str) -> str:
    if not text:
        return ""
    t = text
    t = t.replace("—", "-").replace("–", "-")
    t = t.replace("→", "->").replace("⇒", "->")
    t = t.replace("«", '"').replace("»", '"')
    t = t.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"')
    for bad in (
        "Я хотел бы выразить заинтересованность",
        "Пишу, чтобы выразить свой интерес",
        "В современном быстро меняющемся мире",
        "Как высокомотивированный профессионал",
    ):
        t = t.replace(bad, "")
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def require_job_responder_user_auth(auth_ctx: Dict[str, Any]) -> None:
    mode = str(auth_ctx.get("auth_mode") or "")
    if mode in ("dev_bypass", "supabase_user", "bootstrap_token"):
        return
    raise HTTPException(
        status_code=403,
        detail="Job Responder requires user login (email/password JWT). Service API keys are not allowed.",
    )


class JobResponderVacancyPayload(BaseModel):
    url: Optional[str] = Field(default=None, max_length=4000)
    title: str = Field(..., min_length=1, max_length=1000)
    company: Optional[str] = Field(default=None, max_length=500)
    description: str = Field(..., min_length=1, max_length=50000)
    questions: List[str] = Field(default_factory=list)


class JobResponderGeneratePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    mode: Literal["cover_letter", "question_answers"] = "cover_letter"
    host: Literal["ru", "kz", "uz"] = "ru"
    vacancy: JobResponderVacancyPayload
    locale: str = Field(default="ru", max_length=16)


class JobResponderResumeCapturePayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=1000)
    text: str = Field(..., min_length=20, max_length=200000)
    kind: str = Field(default="job_resume", max_length=64)
    category: str = Field(default="cv", max_length=128)


class JobResponderResumeSearchPayload(BaseModel):
    workspaceId: str = Field(..., min_length=1, max_length=64)
    query: str = Field(..., min_length=1, max_length=4000)
    limit: int = Field(default=12, ge=1, le=50)


def build_resume_search_query(vacancy: JobResponderVacancyPayload) -> str:
    parts = [vacancy.title.strip()]
    if vacancy.company:
        parts.append(vacancy.company.strip())
    desc = re.sub(r"\s+", " ", vacancy.description or "").strip()
    if desc:
        parts.append(desc[:1200])
    return " | ".join(p for p in parts if p)


def build_system_prompt(mode: str) -> str:
    base = """Ты помощник кандидата при отклике на вакансии на HeadHunter.

Правила:
- Пиши от первого лица кандидата.
- Используй ТОЛЬКО факты из блока RESUME CONTEXT. Если факта нет - не выдумывай.
- Без AI-slop: без "страстно увлечен", "синергия", "динамичная команда", "уникальная возможность".
- Формат HH: короткое тире "-", стрелки "->", кавычки ASCII ".
- Язык: русский (если вакансия явно на другом языке - можно на языке вакансии).
- Не используй markdown-заголовки и списки с буллетами - plain text для поля HH.
"""
    if mode == "question_answers":
        return (
            base
            + """
Режим: ответы на вопросы работодателя.
Верни ТОЛЬКО валидный JSON-массив:
[{"question":"...","answer":"..."}]
По одному объекту на каждый вопрос из списка QUESTIONS. Ответы 1-4 предложения, конкретно."""
        )
    return (
        base
        + """
Режим: сопроводительное письмо (cover letter).
Длина: 800-1400 символов.
Структура: приветствие -> 1-2 релевантных кейса под требования -> стек/формат -> CTA -> имя (если есть в RESUME CONTEXT).
Верни ТОЛЬКО текст письма, без пояснений."""
    )


def build_user_prompt(
    vacancy: JobResponderVacancyPayload,
    rag_items: List[Dict[str, Any]],
    mode: str,
    host: str,
    questions: Optional[List[str]] = None,
) -> str:
    host_label = HOST_LABELS.get(host, "hh.ru")
    ctx_lines = []
    for idx, item in enumerate(rag_items, start=1):
        title = str(item.get("title") or f"Source {idx}")
        category = str(item.get("category") or "")
        kind = str(item.get("kind") or "")
        summary = str(item.get("summary") or item.get("ai_summary") or "")
        body = str(item.get("content_text") or "")[:2500]
        ctx_lines.append(
            f"[source {idx}] title={title!r} kind={kind} category={category}\n"
            f"summary: {summary}\n"
            f"text: {body}"
        )
    resume_context = "\n\n".join(ctx_lines) if ctx_lines else "(empty - do not invent facts)"

    vacancy_block = json.dumps(
        {
            "host": host_label,
            "url": vacancy.url,
            "title": vacancy.title,
            "company": vacancy.company,
            "description": vacancy.description[:8000],
        },
        ensure_ascii=False,
        indent=2,
    )

    parts = [
        f"SITE: {host_label}",
        f"VACANCY:\n{vacancy_block}",
        f"RESUME CONTEXT:\n{resume_context}",
    ]
    if mode == "question_answers":
        qlist = questions or vacancy.questions or []
        parts.append("QUESTIONS:\n" + json.dumps(qlist, ensure_ascii=False, indent=2))
    return "\n\n".join(parts)


def register_job_responder_routes(app, deps: Dict[str, Any]) -> None:
    verify_bookmarks_access = deps["verify_bookmarks_access"]
    verify_workspace_membership = deps["verify_workspace_membership"]
    pg_connect = deps["pg_connect"]
    get_openai_embedding = deps["get_openai_embedding"]
    build_vector_literal = deps["build_vector_literal"]
    bookmarks_vector_dim = deps["bookmarks_vector_dim"]
    has_any_bookmark_llm_keys = deps["has_any_bookmark_llm_keys"]
    openai_chat_completions_generic = deps["openai_chat_completions_generic"]
    build_knowledge_content_hash = deps["build_knowledge_content_hash"]
    resolve_knowledge_obsidian_note_path = deps["resolve_knowledge_obsidian_note_path"]
    normalize_kind = deps["normalize_kind"]
    truncate_text = deps["truncate_text"]
    psycopg2 = deps["psycopg2"]

    def _parse_workspace_id(raw: str) -> int:
        try:
            return int(raw)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="workspaceId must be numeric") from exc

    def _resume_kind_norm(kind: str) -> str:
        raw = str(kind or PRIMARY_CV_KIND).strip().lower()
        if raw in RESUME_KINDS:
            return raw
        return normalize_kind(raw, default=PRIMARY_CV_KIND)

    def _resume_search_rows(cur, workspace_id: int, query: str, limit: int) -> Tuple[str, List[Dict[str, Any]]]:
        emb = get_openai_embedding(query)
        if emb and len(emb) == bookmarks_vector_dim:
            vec = build_vector_literal(emb)
            cur.execute(
                """
                select
                  k.id,
                  k.source,
                  k.title,
                  k.url,
                  k.ai_summary,
                  k.category,
                  k.tags,
                  k.status,
                  k.note_path,
                  k.kind,
                  k.content_text,
                  (v.embedding <-> %s::vector) as distance
                from public.knowledge_items k
                join public.knowledge_vectors v on v.knowledge_item_id = k.id
                where k.workspace_id = %s
                  and k.source = %s
                  and k.kind = any(%s)
                order by v.embedding <-> %s::vector asc
                limit %s
                """,
                (vec, workspace_id, RESUME_SOURCE, list(RESUME_KINDS), vec, limit),
            )
            rows = cur.fetchall()
            if rows:
                return "semantic", rows

        like = f"%{query.strip().lower()}%"
        cur.execute(
            """
            select
              k.id,
              k.source,
              k.title,
              k.url,
              k.ai_summary,
              k.category,
              k.tags,
              k.status,
              k.note_path,
              k.kind,
              k.content_text,
              null::float8 as distance
            from public.knowledge_items k
            where k.workspace_id = %s
              and k.source = %s
              and k.kind = any(%s)
              and (
                lower(coalesce(k.title, '')) like %s
                or lower(coalesce(k.content_text, '')) like %s
                or lower(coalesce(k.ai_summary, '')) like %s
              )
            order by k.updated_at desc
            limit %s
            """,
            (workspace_id, RESUME_SOURCE, list(RESUME_KINDS), like, like, like, limit),
        )
        return "keyword", cur.fetchall()

    @app.get("/api/v1/job-responder/resume/status")
    async def job_responder_resume_status(
        workspaceId: str,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
        require_job_responder_user_auth(auth_ctx)
        workspace_id = _parse_workspace_id(workspaceId)
        verify_workspace_membership(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    select
                      count(*)::int as total,
                      count(*) filter (where kind = %s)::int as primary_cv_count,
                      max(updated_at) as last_updated
                    from public.knowledge_items
                    where workspace_id = %s and source = %s and kind = any(%s)
                    """,
                    (PRIMARY_CV_KIND, workspace_id, RESUME_SOURCE, list(RESUME_KINDS)),
                )
                row = cur.fetchone() or {}
            return {
                "workspaceId": str(workspace_id),
                "count": int(row.get("total") or 0),
                "primaryCvCount": int(row.get("primary_cv_count") or 0),
                "hasPrimaryCv": int(row.get("primary_cv_count") or 0) > 0,
                "lastUpdated": row.get("last_updated").isoformat() if row.get("last_updated") else None,
            }
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/capture")
    async def job_responder_resume_capture(
        payload: JobResponderResumeCapturePayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
        require_job_responder_user_auth(auth_ctx)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        verify_workspace_membership(auth_ctx, workspace_id)

        kind_norm = _resume_kind_norm(payload.kind)
        category = truncate_text(str(payload.category or "cv").strip().lower(), 128) or "cv"
        title = truncate_text(payload.title.strip(), 1000)
        text = str(payload.text or "").strip()
        tags = list(dict.fromkeys([*RESUME_TAGS, category]))[:12]
        content_hash = build_knowledge_content_hash(RESUME_SOURCE, "", text)
        note_path = truncate_text(
            resolve_knowledge_obsidian_note_path(
                workspace_id,
                content_hash,
                None,
                kind=kind_norm,
            ),
            4000,
        )

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    insert into public.knowledge_items (
                      workspace_id, source, title, url, canonical_url,
                      content_text, category, tags, content_hash, status, note_path, kind
                    ) values (%s, %s, %s, null, null, %s, %s, %s, %s, 'to_process', %s, %s)
                    on conflict (workspace_id, content_hash)
                    do update set
                      updated_at = now(),
                      last_seen_at = now(),
                      seen_count = public.knowledge_items.seen_count + 1,
                      title = excluded.title,
                      content_text = case
                        when length(coalesce(excluded.content_text, '')) > length(coalesce(public.knowledge_items.content_text, ''))
                        then excluded.content_text
                        else public.knowledge_items.content_text
                      end,
                      category = excluded.category,
                      tags = excluded.tags,
                      kind = excluded.kind,
                      note_path = coalesce(excluded.note_path, public.knowledge_items.note_path)
                    returning id, seen_count
                    """,
                    (
                        workspace_id,
                        RESUME_SOURCE,
                        title,
                        text,
                        category,
                        psycopg2.extras.Json(tags),
                        content_hash,
                        note_path,
                        kind_norm,
                    ),
                )
                row = cur.fetchone() or {}
                kid = int(row["id"]) if row.get("id") is not None else None

                embed_source = "\n".join(p for p in (title, text[:4000]) if p)[:8000]
                vec = get_openai_embedding(embed_source)
                embedded = False
                if vec and len(vec) == bookmarks_vector_dim and kid:
                    cur.execute(
                        """
                        insert into public.knowledge_vectors (knowledge_item_id, embedding, embedding_model, embedded_at, updated_at)
                        values (%s, %s::vector, %s, now(), now())
                        on conflict (knowledge_item_id)
                        do update set
                          embedding = excluded.embedding,
                          embedding_model = excluded.embedding_model,
                          embedded_at = now(),
                          updated_at = now()
                        """,
                        (kid, build_vector_literal(vec), "job-responder-embed"),
                    )
                    embedded = True
            conn.commit()
            return {
                "ok": True,
                "knowledgeItemId": kid,
                "kind": kind_norm,
                "embedded": embedded,
                "contentHash": content_hash,
            }
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/resume/search")
    async def job_responder_resume_search(
        payload: JobResponderResumeSearchPayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
        require_job_responder_user_auth(auth_ctx)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        verify_workspace_membership(auth_ctx, workspace_id)

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                mode, rows = _resume_search_rows(cur, workspace_id, payload.query, payload.limit)
            items = [
                {
                    "knowledgeItemId": int(r["id"]),
                    "title": r.get("title"),
                    "kind": r.get("kind"),
                    "category": r.get("category"),
                    "summary": r.get("ai_summary"),
                    "distance": float(r["distance"]) if r.get("distance") is not None else None,
                }
                for r in rows
            ]
            return {"mode": mode, "query": payload.query, "items": items}
        finally:
            conn.close()

    @app.post("/api/v1/job-responder/generate")
    async def job_responder_generate(
        payload: JobResponderGeneratePayload,
        request: Request,
        x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        auth_ctx = verify_bookmarks_access(request, x_api_key, authorization)
        require_job_responder_user_auth(auth_ctx)
        workspace_id = _parse_workspace_id(payload.workspaceId)
        verify_workspace_membership(auth_ctx, workspace_id)

        if not has_any_bookmark_llm_keys():
            raise HTTPException(
                status_code=503,
                detail="LLM keys are not configured in Swoop service_settings.",
            )

        conn = pg_connect()
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    select count(*)::int as c
                    from public.knowledge_items
                    where workspace_id = %s and source = %s and kind = %s
                    """,
                    (workspace_id, RESUME_SOURCE, PRIMARY_CV_KIND),
                )
                cv_row = cur.fetchone() or {}
                if int(cv_row.get("c") or 0) < 1:
                    raise HTTPException(
                        status_code=422,
                        detail="Upload a primary resume first (job_responder/resume/capture with kind=job_resume).",
                    )

                search_q = build_resume_search_query(payload.vacancy)
                _, rag_rows = _resume_search_rows(cur, workspace_id, search_q, 12)
        finally:
            conn.close()

        rag_items = [dict(r) for r in rag_rows]
        mode = payload.mode
        system_prompt = build_system_prompt(mode)
        user_prompt = build_user_prompt(
            payload.vacancy,
            rag_items,
            mode,
            payload.host,
            payload.vacancy.questions,
        )

        chat_result = openai_chat_completions_generic(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.35,
            tier_override="general",
            max_tokens_override=1800 if mode == "question_answers" else 1200,
        )
        raw_text = str(chat_result.content or "").strip()
        if not raw_text:
            raise HTTPException(status_code=502, detail="LLM returned empty response")

        answers = None
        if mode == "question_answers":
            try:
                parsed = json.loads(raw_text)
                if isinstance(parsed, list):
                    answers = parsed
                    raw_text = "\n\n".join(
                        f"Q: {a.get('question', '')}\nA: {hh_format_text(str(a.get('answer') or ''))}"
                        for a in parsed
                        if isinstance(a, dict)
                    )
            except json.JSONDecodeError:
                raw_text = hh_format_text(raw_text)
        else:
            raw_text = hh_format_text(raw_text)

        sources = [
            {
                "knowledgeItemId": int(r.get("id")),
                "title": r.get("title"),
                "kind": r.get("kind"),
                "distance": float(r["distance"]) if r.get("distance") is not None else None,
            }
            for r in rag_items[:8]
        ]

        return {
            "text": raw_text,
            "answers": answers,
            "sources": sources,
            "model": chat_result.model_resolved,
            "provider": chat_result.provider_used,
            "host": payload.host,
            "mode": mode,
        }
