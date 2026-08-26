"""
Deep Search Worker — FastAPI main application (Perplexity-level quality).
- 3 iterations with self-evaluation
- 25 pages fetched per iteration
- ArXiv + Brave News + SearXNG + Wikipedia
- Structured SSE streaming with status events
"""
import asyncio
import json
from datetime import datetime, UTC

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from settings import get_settings, get_openrouter_key, get_openrouter_model, get_brave_keys, DEFAULT_MODEL
from planner import plan_queries
from searcher import multi_search
from fetcher import fetch_all, chunk_document
from synthesizer import rerank_chunks, synthesize_stream, self_evaluate

app = FastAPI(title="Autoro Deep Search", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    # If omitted, we pick `service_settings.openrouter_default_model` (fallback to env DEFAULT_MODEL)
    model: str | None = None
    max_iterations: int = 3          # Up from 2
    target_confidence: float = 0.80  # Self-eval threshold
    language: str = "auto"


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0", "ts": datetime.now(UTC).isoformat()}


@app.post("/search")
async def deep_search(req: SearchRequest):
    async def event_stream():
        settings = await get_settings()
        or_key = await get_openrouter_key(settings)
        or_model = req.model or await get_openrouter_model(settings)
        brave_keys = await get_brave_keys(settings)

        if not or_key:
            yield _sse({"type": "error", "content": "OpenRouter API key not configured. Add it in Swoop → Settings → Provider API Keys."})
            return

        all_search_results: list[dict] = []
        all_chunks: list[dict] = []
        full_answer = ""
        final_citations: list[dict] = []

        try:
            for iteration in range(1, req.max_iterations + 1):
                iter_label = f"Iteration {iteration}/{req.max_iterations}"

                # ── Step 1: Plan sub-queries ─────────────────────────────
                yield _sse({"type": "status", "content": f"🔍 {iter_label}: Planning search queries..."})

                context_hint = f"\n\nAlready known:\n{full_answer[:400]}" if full_answer else ""
                queries = await plan_queries(
                    req.query + context_hint,
                    or_key,
                    or_model
                )
                yield _sse({"type": "queries", "queries": queries, "iteration": iteration})

                # ── Step 2: Multi-source search ──────────────────────────
                source_count = len({"searxng", "brave", "wikipedia", "arxiv", "news"})
                yield _sse({"type": "status",
                             "content": f"📡 {iter_label}: Searching {len(queries)} queries across {source_count} sources..."})

                new_results = await multi_search(queries, brave_keys)

                # Deduplicate against previous iterations
                existing_urls = {r["url"] for r in all_search_results}
                fresh_results = [r for r in new_results if r.get("url") not in existing_urls]
                all_search_results.extend(fresh_results)

                total_sources = len(all_search_results)
                yield _sse({"type": "status",
                             "content": f"📄 {iter_label}: Fetching top pages ({min(25, len(fresh_results))} new, {total_sources} total)..."})

                # ── Step 3: Fetch & chunk ────────────────────────────────
                fetched = await fetch_all(fresh_results, max_pages=25)

                # Fallback: use snippets when full text unavailable
                if not fetched:
                    fetched = [{
                        "url": r["url"], "title": r.get("title",""),
                        "snippet": r.get("snippet",""),
                        "content": r.get("snippet",""),
                        "source": r.get("source","web"),
                        "credibility": r.get("credibility", 0.7)
                    } for r in fresh_results[:20] if r.get("snippet")]

                for doc in fetched:
                    # Carry credibility from search result into chunks
                    sr = next((r for r in all_search_results if r.get("url") == doc.get("url")), {})
                    doc["credibility"] = sr.get("credibility", doc.get("credibility", 0.7))
                    all_chunks.extend(chunk_document(doc))

                yield _sse({"type": "status",
                             "content": f"🧠 {iter_label}: Re-ranking {len(all_chunks)} chunks from {len(fetched)} pages..."})

                # ── Step 4: Rerank & synthesize ──────────────────────────
                top_chunks = rerank_chunks(req.query, all_chunks, top_k=18)

                yield _sse({"type": "status", "content": f"✍️ {iter_label}: Generating structured research answer..."})
                yield _sse({"type": "answer_start", "iteration": iteration})

                iter_answer = ""
                async for token, is_final, citations in synthesize_stream(
                    req.query, top_chunks, or_key, or_model, req.language
                ):
                    if is_final:
                        final_citations = citations
                    else:
                        iter_answer += token
                        full_answer = iter_answer
                        yield _sse({"type": "token", "content": token})

                # ── Step 5: Self-evaluate confidence ────────────────────
                if iteration < req.max_iterations:
                    yield _sse({"type": "status", "content": f"🔎 Evaluating answer quality..."})
                    # keep evaluator consistent with synthesis model
                    # (OpenRouter requires explicit `model` per request)
                    # NOTE: self_evaluate takes `model` as parameter name
                    # but it's an OpenRouter model slug.
                    confidence = await self_evaluate(req.query, iter_answer, or_key, or_model)
                    yield _sse({"type": "confidence", "score": round(confidence, 2), "iteration": iteration})

                    if confidence >= req.target_confidence:
                        yield _sse({"type": "status",
                                    "content": f"✅ Confidence {confidence:.0%} — sufficient. Stopping early."})
                        break
                    else:
                        yield _sse({"type": "status",
                                    "content": f"♻️ Confidence {confidence:.0%} — searching for more information..."})

            # ── Final citations ──────────────────────────────────────────
            yield _sse({"type": "citations", "citations": final_citations})

            # Source stats
            source_types = {}
            for c in final_citations:
                t = c.get("source_type", "web")
                source_types[t] = source_types.get(t, 0) + 1

            yield _sse({
                "type": "done",
                "query": req.query,
                "total_sources": len(final_citations),
                "source_breakdown": source_types
            })

            asyncio.create_task(_save_history(req.query, full_answer, final_citations, req.model))

        except Exception as e:
            import traceback
            print(f"[deep_search] Error: {traceback.format_exc()}")
            yield _sse({"type": "error", "content": str(e)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/history")
async def get_history(limit: int = 20):
    from settings import get_supabase
    sb = get_supabase()
    if not sb:
        return {"history": []}
    try:
        result = (
            sb.table("deep_search_history")
            .select("id, query, model, created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"history": result.data or []}
    except Exception as e:
        return {"history": [], "error": str(e)}


@app.get("/history/{search_id}")
async def get_history_item(search_id: str):
    from settings import get_supabase
    sb = get_supabase()
    if not sb:
        raise HTTPException(404, "Supabase not configured")
    try:
        result = sb.table("deep_search_history").select("*").eq("id", search_id).single().execute()
        return result.data
    except Exception as e:
        raise HTTPException(404, str(e))


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _save_history(query: str, answer: str, citations: list, model: str):
    from settings import get_supabase
    sb = get_supabase()
    if not sb:
        return
    try:
        sb.table("deep_search_history").insert({
            "query": query,
            "answer": answer,
            "sources": citations,
            "model": model,
        }).execute()
    except Exception as e:
        print(f"[history] Save failed: {e}")
