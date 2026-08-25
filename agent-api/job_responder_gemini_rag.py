"""Job Responder: Gemini File Search RAG (NotebookLM-like grounding on Swoop gemini_keys)."""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

_LOG = logging.getLogger("job-responder.gemini-rag")

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
GEMINI_UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta"
DEFAULT_EMBEDDING_MODEL = "models/gemini-embedding-001"
DEFAULT_RAG_MODEL = os.environ.get("JOB_RESPONDER_GEMINI_RAG_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"

TAG_DOC_PREFIX = "gemini_rag_doc:"
TAG_HASH_PREFIX = "gemini_rag_hash:"

ENABLED = str(os.environ.get("JOB_RESPONDER_GEMINI_RAG", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}

UPLOAD_POLL_INTERVAL_SEC = 1.5
UPLOAD_POLL_MAX_SEC = 45.0
GENERATE_TIMEOUT_SEC = 28.0


def is_enabled() -> bool:
    return ENABLED


def tag_doc_name(doc_name: str) -> str:
    return f"{TAG_DOC_PREFIX}{doc_name}"


def tag_content_hash(content_hash: str) -> str:
    return f"{TAG_HASH_PREFIX}{content_hash}"


def parse_doc_from_tags(tags: Any) -> Optional[str]:
    for raw in tags or []:
        s = str(raw or "")
        if s.startswith(TAG_DOC_PREFIX):
            return s[len(TAG_DOC_PREFIX) :]
    return None


def parse_hash_from_tags(tags: Any) -> Optional[str]:
    for raw in tags or []:
        s = str(raw or "")
        if s.startswith(TAG_HASH_PREFIX):
            return s[len(TAG_HASH_PREFIX) :]
    return None


def ensure_schema(pg_connect: Callable[[], Any]) -> None:
    conn = pg_connect()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                create table if not exists public.job_responder_gemini_stores (
                  workspace_id bigint primary key,
                  store_name text not null,
                  embedding_model text not null default 'models/gemini-embedding-001',
                  doc_count integer not null default 0,
                  last_sync_at timestamptz,
                  created_at timestamptz not null default now(),
                  updated_at timestamptz not null default now()
                )
                """
            )
            cur.execute(
                """
                create index if not exists idx_jr_gemini_stores_updated
                on public.job_responder_gemini_stores(updated_at desc)
                """
            )
        conn.commit()
    except Exception as exc:
        conn.rollback()
        _LOG.warning("ensure_schema failed: %s", exc)
    finally:
        conn.close()


def _http_request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    body: Optional[bytes] = None,
    timeout: int = 60,
) -> Tuple[int, Optional[Dict[str, Any]], str]:
    hdrs = dict(headers or {})
    req = UrlRequest(url, data=body, headers=hdrs, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            code = int(resp.getcode() or 200)
            try:
                return code, json.loads(raw), raw
            except json.JSONDecodeError:
                return code, None, raw
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        return int(exc.code), parsed, raw
    except Exception as exc:
        _LOG.warning("HTTP %s failed %s: %s", method, url[:90], exc)
        return -1, None, str(exc)


def _http_post_json(url: str, payload: Dict[str, Any], timeout: int = 60) -> Tuple[int, Optional[Dict[str, Any]], str]:
    return _http_request(
        "POST",
        url,
        headers={"Content-Type": "application/json"},
        body=json.dumps(payload).encode("utf-8"),
        timeout=timeout,
    )


def _http_get_json(url: str, timeout: int = 30) -> Tuple[int, Optional[Dict[str, Any]], str]:
    return _http_request("GET", url, timeout=timeout)


def _gemini_key_pool() -> List[str]:
    from main import _gemini_chat_key_pool, load_swoop_llm_key_settings

    settings = load_swoop_llm_key_settings()
    return list(_gemini_chat_key_pool(settings))


def _first_working_key() -> Optional[str]:
    from main import _iter_keys_for_llm

    pool = _gemini_key_pool()
    for key in _iter_keys_for_llm("gemini_pool", pool):
        if str(key).startswith("AIza"):
            return str(key)
    return pool[0] if pool else None


def _store_row(cur, workspace_id: int) -> Optional[Dict[str, Any]]:
    cur.execute(
        """
        select workspace_id, store_name, embedding_model, doc_count, last_sync_at, updated_at
        from public.job_responder_gemini_stores
        where workspace_id = %s
        """,
        (workspace_id,),
    )
    return cur.fetchone()


def _upsert_store_row(
    cur,
    workspace_id: int,
    store_name: str,
    *,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    doc_count: Optional[int] = None,
    touch_sync: bool = False,
) -> None:
    cur.execute(
        """
        insert into public.job_responder_gemini_stores (
          workspace_id, store_name, embedding_model, doc_count, last_sync_at, updated_at
        ) values (%s, %s, %s, coalesce(%s, 0), case when %s then now() else null end, now())
        on conflict (workspace_id) do update set
          store_name = excluded.store_name,
          embedding_model = excluded.embedding_model,
          doc_count = coalesce(excluded.doc_count, public.job_responder_gemini_stores.doc_count),
          last_sync_at = case when %s then now() else public.job_responder_gemini_stores.last_sync_at end,
          updated_at = now()
        """,
        (
            workspace_id,
            store_name,
            embedding_model,
            doc_count,
            touch_sync,
            touch_sync,
        ),
    )


def create_store(api_key: str, display_name: str) -> Tuple[Optional[str], str]:
    url = f"{GEMINI_API_BASE}/fileSearchStores?key={quote(api_key, safe='')}"
    code, body, raw = _http_post_json(
        url,
        {"displayName": display_name[:120], "embeddingModel": DEFAULT_EMBEDDING_MODEL},
        timeout=30,
    )
    if code != 200 or not isinstance(body, dict):
        return None, raw[:300] or f"http_{code}"
    name = str(body.get("name") or "").strip()
    return name or None, "ok"


def ensure_store(pg_connect: Callable[[], Any], workspace_id: int) -> Tuple[Optional[str], str]:
    import psycopg2.extras

    ensure_schema(pg_connect)
    api_key = _first_working_key()
    if not api_key:
        return None, "no_gemini_keys"

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            row = _store_row(cur, workspace_id)
            if row and row.get("store_name"):
                return str(row["store_name"]), "cached"

            display = f"job-responder-ws-{workspace_id}"
            store_name, err = create_store(api_key, display)
            if not store_name:
                return None, err
            _upsert_store_row(cur, workspace_id, store_name)
        conn.commit()
        return store_name, "created"
    except Exception as exc:
        conn.rollback()
        return None, str(exc)
    finally:
        conn.close()


def _poll_operation(api_key: str, operation_name: str, deadline: float) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    if not operation_name:
        return False, None, "missing_operation"
    op_url = f"{GEMINI_API_BASE}/{operation_name.lstrip('/')}?key={quote(api_key, safe='')}"
    last_err = "timeout"
    while time.monotonic() < deadline:
        code, body, raw = _http_get_json(op_url, timeout=20)
        if code != 200 or not isinstance(body, dict):
            last_err = raw[:200] or f"http_{code}"
            time.sleep(UPLOAD_POLL_INTERVAL_SEC)
            continue
        if body.get("done"):
            if body.get("error"):
                return False, body, json.dumps(body.get("error"))[:300]
            return True, body, "ok"
        time.sleep(UPLOAD_POLL_INTERVAL_SEC)
    return False, None, last_err


def upload_bytes_to_store(
    api_key: str,
    store_name: str,
    data: bytes,
    *,
    display_name: str,
    mime_type: str = "text/plain",
    poll: bool = True,
) -> Tuple[Optional[str], str]:
    store_id = store_name.split("/")[-1] if store_name else ""
    if not store_id:
        return None, "bad_store_name"
    start_url = (
        f"{GEMINI_UPLOAD_BASE}/fileSearchStores/{quote(store_id, safe='')}:uploadToFileSearchStore"
        f"?key={quote(api_key, safe='')}"
    )
    meta = json.dumps({"displayName": display_name[:200], "mimeType": mime_type}).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": str(len(data)),
        "X-Goog-Upload-Header-Content-Type": mime_type,
    }
    upload_url = ""
    req = UrlRequest(start_url, data=meta, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=30) as resp:
            upload_url = str(resp.headers.get("X-Goog-Upload-URL") or resp.headers.get("x-goog-upload-url") or "")
    except HTTPError as exc:
        upload_url = str(exc.headers.get("X-Goog-Upload-URL") or exc.headers.get("x-goog-upload-url") or "")
        if not upload_url:
            err_body = exc.read().decode("utf-8", errors="replace")
            return None, err_body[:300]

    if not upload_url:
        return None, "missing_upload_url"

    upload_headers = {
        "Content-Length": str(len(data)),
        "X-Goog-Upload-Offset": "0",
        "X-Goog-Upload-Command": "upload, finalize",
    }
    code2, body2, raw2 = _http_request("POST", upload_url, headers=upload_headers, body=data, timeout=120)
    if code2 not in (200, 201):
        return None, raw2[:300] or f"upload_http_{code2}"

    operation_name = ""
    doc_name = ""
    if isinstance(body2, dict):
        operation_name = str(body2.get("name") or "")
        resp_block = body2.get("response") or {}
        if isinstance(resp_block, dict):
            doc_name = str(resp_block.get("name") or resp_block.get("documentName") or "")

    if poll and operation_name:
        ok, op_body, err = _poll_operation(api_key, operation_name, time.monotonic() + UPLOAD_POLL_MAX_SEC)
        if not ok:
            return None, err
        if isinstance(op_body, dict):
            resp_block = op_body.get("response") or {}
            if isinstance(resp_block, dict):
                doc_name = str(resp_block.get("name") or resp_block.get("documentName") or doc_name)

    if doc_name:
        return doc_name, "ok"
    if operation_name:
        return operation_name, "operation_only"
    return None, raw2[:200] or "no_document_name"


def upload_text_to_store(
    api_key: str,
    store_name: str,
    text: str,
    *,
    display_name: str,
    poll: bool = True,
) -> Tuple[Optional[str], str]:
    payload = (text or "").encode("utf-8")
    if not payload:
        return None, "empty_text"
    return upload_bytes_to_store(
        api_key,
        store_name,
        payload,
        display_name=display_name,
        mime_type="text/plain; charset=utf-8",
        poll=poll,
    )


def _merge_gemini_tags(existing: Any, doc_name: str, content_hash: str) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in existing or []:
        s = str(raw or "")
        if s.startswith(TAG_DOC_PREFIX) or s.startswith(TAG_HASH_PREFIX):
            continue
        if s and s not in seen:
            seen.add(s)
            out.append(s)
    if doc_name:
        t = tag_doc_name(doc_name)
        if t not in seen:
            out.append(t)
            seen.add(t)
    if content_hash:
        t = tag_content_hash(content_hash)
        if t not in seen:
            out.append(t)
            seen.add(t)
    return out


def sync_knowledge_item(
    pg_connect: Callable[[], Any],
    workspace_id: int,
    knowledge_item_id: int,
    *,
    poll: bool = False,
) -> Dict[str, Any]:
    if not is_enabled():
        return {"ok": False, "skipped": True, "reason": "disabled"}

    import psycopg2.extras

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select id, title, content_text, content_hash, tags
                from public.knowledge_items
                where id = %s and workspace_id = %s and source = 'job_responder'
                """,
                (knowledge_item_id, workspace_id),
            )
            row = cur.fetchone()
            if not row:
                return {"ok": False, "error": "not_found"}
            content_hash = str(row.get("content_hash") or "")
            tags = row.get("tags") or []
            if content_hash and parse_hash_from_tags(tags) == content_hash and parse_doc_from_tags(tags):
                return {
                    "ok": True,
                    "skipped": True,
                    "reason": "dedupe",
                    "documentName": parse_doc_from_tags(tags),
                }

            store_name, store_err = ensure_store(pg_connect, workspace_id)
            if not store_name:
                return {"ok": False, "error": store_err}

            api_key = _first_working_key()
            if not api_key:
                return {"ok": False, "error": "no_gemini_keys"}

            title = str(row.get("title") or f"source-{knowledge_item_id}")[:180]
            text = str(row.get("content_text") or "")
            if len(text) < 20:
                return {"ok": False, "error": "text_too_short"}

            doc_name, up_err = upload_text_to_store(
                api_key,
                store_name,
                text,
                display_name=f"ws{workspace_id}-{knowledge_item_id}-{title}"[:200],
                poll=poll,
            )
            if not doc_name:
                return {"ok": False, "error": up_err}

            new_tags = _merge_gemini_tags(tags, doc_name, content_hash)
            cur.execute(
                """
                update public.knowledge_items
                set tags = %s, updated_at = now()
                where id = %s and workspace_id = %s
                """,
                (psycopg2.extras.Json(new_tags), knowledge_item_id, workspace_id),
            )
            cur.execute(
                """
                select count(*)::int as c
                from public.knowledge_items
                where workspace_id = %s and source = 'job_responder'
                  and tags::text like %s
                """,
                (workspace_id, f"%{TAG_DOC_PREFIX}%"),
            )
            cnt_row = cur.fetchone() or {}
            doc_count = int(cnt_row.get("c") or 0)
            _upsert_store_row(cur, workspace_id, store_name, doc_count=doc_count, touch_sync=True)
        conn.commit()
        return {"ok": True, "documentName": doc_name, "storeName": store_name}
    except Exception as exc:
        conn.rollback()
        _LOG.exception("sync_knowledge_item failed kid=%s", knowledge_item_id)
        return {"ok": False, "error": str(exc)}
    finally:
        conn.close()


def sync_workspace(
    pg_connect: Callable[[], Any],
    workspace_id: int,
    *,
    poll: bool = True,
) -> Dict[str, Any]:
    if not is_enabled():
        return {"ok": False, "skipped": True, "reason": "disabled"}

    import psycopg2.extras

    ensure_schema(pg_connect)
    conn = pg_connect()
    synced = 0
    skipped = 0
    errors: List[str] = []
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                select id from public.knowledge_items
                where workspace_id = %s and source = 'job_responder'
                  and kind in ('job_resume', 'job_experience', 'job_skills')
                order by updated_at desc
                limit 80
                """,
                (workspace_id,),
            )
            ids = [int(r["id"]) for r in cur.fetchall() if r.get("id")]
        conn.commit()
    finally:
        conn.close()

    for kid in ids:
        res = sync_knowledge_item(pg_connect, workspace_id, kid, poll=poll)
        if res.get("skipped"):
            skipped += 1
        elif res.get("ok"):
            synced += 1
        else:
            errors.append(f"{kid}:{res.get('error')}")

    return {
        "ok": len(errors) == 0,
        "workspaceId": str(workspace_id),
        "synced": synced,
        "skipped": skipped,
        "errors": errors[:12],
        "total": len(ids),
    }


def get_status(pg_connect: Callable[[], Any], workspace_id: int) -> Dict[str, Any]:
    ensure_schema(pg_connect)
    import psycopg2.extras

    conn = pg_connect()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            row = _store_row(cur, workspace_id)
            cur.execute(
                """
                select count(*)::int as c
                from public.knowledge_items
                where workspace_id = %s and source = 'job_responder'
                  and tags::text like %s
                """,
                (workspace_id, f"%{TAG_DOC_PREFIX}%"),
            )
            tagged = int((cur.fetchone() or {}).get("c") or 0)
    finally:
        conn.close()

    has_keys = bool(_gemini_key_pool())
    ready = bool(row and row.get("store_name") and tagged > 0 and has_keys)
    return {
        "enabled": is_enabled(),
        "ready": ready,
        "hasGeminiKeys": has_keys,
        "workspaceId": str(workspace_id),
        "storeName": (row or {}).get("store_name"),
        "docCount": tagged,
        "storeDocCount": int((row or {}).get("doc_count") or 0),
        "lastSyncAt": row.get("last_sync_at").isoformat() if row and row.get("last_sync_at") else None,
        "model": DEFAULT_RAG_MODEL,
    }


def build_gemini_rag_user_prompt(
    vacancy: Any,
    mode: str,
    host: str,
    questions: Optional[List[Any]],
    cover_template: str = "",
    prompt_extra: str = "",
    host_labels: Optional[Dict[str, str]] = None,
) -> str:
    labels = host_labels or {}
    host_label = labels.get(host, host or "web")
    structured = None
    if getattr(vacancy, "structured", None) is not None:
        structured = vacancy.structured.model_dump(exclude_none=True)
    vacancy_block = json.dumps(
        {
            "host": host_label,
            "url": vacancy.url,
            "title": vacancy.title,
            "company": vacancy.company,
            "source": vacancy.source,
            "description": (vacancy.description or "")[:1600],
            "structured": structured,
        },
        ensure_ascii=False,
        indent=2,
    )
    parts = [
        f"SITE: {host_label}",
        f"VACANCY:\n{vacancy_block}",
        "RESUME CONTEXT: use File Search over the candidate documents in the bound store. "
        "Do not invent facts not supported by retrieved documents. "
        "When present in retrieved docs, include contacts and relevant portfolio/links in the output. "
        "If CUSTOM INSTRUCTIONS / PROFILE OVERRIDES conflict with retrieved docs, prefer the overrides.",
    ]
    if mode == "cover_letter" and cover_template:
        parts.append(f"COVER TEMPLATE (adapt, do not rewrite from scratch):\n{cover_template[:1200]}")
    if mode == "question_answers":
        from job_responder import normalize_questions

        qlist = normalize_questions(questions if questions is not None else vacancy.questions)
        parts.append("QUESTIONS:\n" + json.dumps(qlist, ensure_ascii=False, indent=2))
    extra = (prompt_extra or "").strip()
    if extra:
        parts.append(f"CUSTOM INSTRUCTIONS:\n{extra[:4000]}")
    return "\n\n".join(parts)


def generate_with_file_search(
    *,
    store_name: str,
    system_prompt: str,
    user_prompt: str,
    mode: str,
    model: Optional[str] = None,
    timeout_sec: float = GENERATE_TIMEOUT_SEC,
) -> Dict[str, Any]:
    from main import _gemini_native_generation_config, _iter_keys_for_llm

    model_use = (model or DEFAULT_RAG_MODEL).strip()
    pool = _gemini_key_pool()
    if not pool:
        return {"ok": False, "error": "no_gemini_keys"}

    payload_base: Dict[str, Any] = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "tools": [{"fileSearch": {"fileSearchStoreNames": [store_name]}}],
        "generationConfig": _gemini_native_generation_config(
            model_use,
            temperature=0.35,
            maxOutputTokens=1200 if mode == "question_answers" else 800,
        ),
    }
    if mode == "question_answers":
        payload_base["generationConfig"]["responseMimeType"] = "application/json"

    last_err = "unknown"
    for key in _iter_keys_for_llm("gemini_pool", pool):
        url = f"{GEMINI_API_BASE}/models/{quote(model_use, safe='')}:generateContent?key={quote(str(key), safe='')}"
        started = time.monotonic()
        code, body, raw = _http_post_json(url, payload_base, timeout=int(timeout_sec))
        elapsed = time.monotonic() - started
        if code != 200 or not isinstance(body, dict):
            last_err = raw[:300] or f"http_{code}"
            continue
        candidates = body.get("candidates") or []
        parts = (((candidates[0] or {}).get("content") or {}).get("parts")) or []
        text = ""
        for part in parts:
            if isinstance(part, dict) and part.get("text"):
                text = str(part["text"]).strip()
                break
        if not text:
            last_err = "empty_text"
            continue
        grounding = (candidates[0] or {}).get("groundingMetadata") or body.get("groundingMetadata")
        citations: List[str] = []
        if isinstance(grounding, dict):
            for chunk in grounding.get("groundingChunks") or grounding.get("grounding_chunks") or []:
                if isinstance(chunk, dict):
                    seg = chunk.get("segment") or chunk.get("retrievedContext") or chunk
                    title = str(seg.get("title") or seg.get("uri") or "")[:120]
                    if title:
                        citations.append(title)
        return {
            "ok": True,
            "text": text,
            "model": model_use,
            "provider": "gemini_file_search",
            "elapsedSec": round(elapsed, 2),
            "citations": citations[:12],
            "groundingMetadata": grounding,
        }
    return {"ok": False, "error": last_err, "provider": "gemini_file_search"}


def delete_document(api_key: str, document_name: str) -> Tuple[bool, str]:
    if not document_name or not document_name.startswith("fileSearchStores/"):
        return False, "bad_document_name"
    url = (
        f"{GEMINI_API_BASE}/{document_name.lstrip('/')}?key={quote(api_key, safe='')}&force=true"
    )
    code, _, raw = _http_request("DELETE", url, timeout=30)
    if code in (200, 204, 404):
        return True, "ok"
    return False, raw[:200] or f"http_{code}"


def smoke_test(pg_connect: Callable[[], Any], workspace_id: int = 1) -> Dict[str, Any]:
    """Create store, upload test doc, query, delete test doc. For deploy script."""
    if not is_enabled():
        return {"ok": False, "skipped": True, "reason": "JOB_RESPONDER_GEMINI_RAG disabled"}

    api_key = _first_working_key()
    if not api_key:
        return {"ok": False, "error": "no_gemini_keys"}

    timings: Dict[str, float] = {}
    t0 = time.monotonic()
    store_name, err = ensure_store(pg_connect, workspace_id)
    timings["ensureStoreSec"] = round(time.monotonic() - t0, 2)
    if not store_name:
        return {"ok": False, "error": err, "timings": timings}

    sample = (
        "Smoke CV: Vlad Holodin. Skills: Python, n8n, FastAPI, Gemini RAG. "
        "Built Job Responder cover letters for HH with File Search grounding."
    )
    t1 = time.monotonic()
    doc_name, up_err = upload_text_to_store(
        api_key,
        store_name,
        sample,
        display_name=f"jr-smoke-{int(time.time())}.txt",
        poll=True,
    )
    timings["uploadSec"] = round(time.monotonic() - t1, 2)
    if not doc_name:
        return {"ok": False, "error": up_err, "timings": timings}

    from job_responder import build_system_prompt

    t2 = time.monotonic()
    gen = generate_with_file_search(
        store_name=store_name,
        system_prompt=build_system_prompt("cover_letter", has_cover_template=False),
        user_prompt=(
            "VACANCY: n8n automation engineer at SmokeCo. Need Python and RAG.\n"
            "Write a short cover letter using facts from File Search documents only."
        ),
        mode="cover_letter",
        timeout_sec=25.0,
    )
    timings["generateSec"] = round(time.monotonic() - t2, 2)

    if doc_name.startswith("fileSearchStores/"):
        delete_document(api_key, doc_name)

    gen_ok = bool(gen.get("ok") and str(gen.get("text") or "").strip())
    return {
        "ok": gen_ok,
        "storeName": store_name,
        "documentName": doc_name,
        "textLen": len(str(gen.get("text") or "")),
        "elapsedSec": gen.get("elapsedSec"),
        "timings": timings,
        "error": None if gen_ok else gen.get("error"),
    }
