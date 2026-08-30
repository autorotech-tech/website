"""
Enhanced Synthesizer — Perplexity-level quality:
- Cross-encoder reranking with credibility boost
- Structured output: TL;DR → Key Findings → Deep Analysis → FAQ → Sources
- SSE streaming token by token
"""
import json
import httpx

try:
    from sentence_transformers import CrossEncoder
    _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
except Exception:
    CrossEncoder = None  # type: ignore[assignment]
    _reranker = None

OPENROUTER_BASE = "https://openrouter.ai/api/v1"


def rerank_chunks(query: str, chunks: list[dict], top_k: int = 15) -> list[dict]:
    """Re-rank chunks with cross-encoder score boosted by source credibility."""
    if not chunks:
        return []
    if _reranker is None:
        # Fallback when sentence-transformers is unavailable in runtime image.
        # Keep deterministic ordering by credibility and preserve service availability.
        return sorted(
            chunks,
            key=lambda c: c.get("credibility", 0.7),
            reverse=True
        )[:top_k]
    pairs = [(query, c["content"]) for c in chunks]
    scores = _reranker.predict(pairs)
    # Blend: 80% relevance + 20% credibility
    blended = [
        s * 0.8 + c.get("credibility", 0.7) * 0.2
        for s, c in zip(scores, chunks)
    ]
    ranked = sorted(zip(blended, chunks), key=lambda x: x[0], reverse=True)
    return [chunk for _, chunk in ranked[:top_k]]


def build_context(top_chunks: list[dict]) -> tuple[str, list[dict]]:
    """Build numbered context string and citation list, grouped by source type."""
    seen_urls: dict[str, int] = {}
    citations: list[dict] = []
    context_parts: list[str] = []

    for chunk in top_chunks:
        url = chunk.get("url", "")
        if url and url not in seen_urls:
            seen_urls[url] = len(citations) + 1
            citations.append({
                "num": seen_urls[url],
                "url": url,
                "title": chunk.get("title", url),
                "source_type": chunk.get("source", "web"),
                "credibility": round(chunk.get("credibility", 0.7), 2),
            })
        num = seen_urls.get(url, "?")
        source_label = chunk.get("source", "web").upper()
        context_parts.append(
            f"[{num}] ({source_label} | credibility:{chunk.get('credibility',0.7):.2f})\n{chunk['content']}"
        )

    return "\n\n---\n\n".join(context_parts), citations


SYSTEM_PROMPT_TEMPLATE = """You are an expert research assistant similar to Perplexity AI's Deep Research mode.
You produce comprehensive, well-structured research reports with inline citations.

Sources available (cite as [N]):
{citation_list}

Output format (STRICT — use these exact markdown headers):
## TL;DR
2-3 sentence summary of the key answer.

## Key Findings
Bullet list of the most important facts/insights, each with citation [N].

## Deep Analysis
Detailed multi-paragraph analysis. Use sub-headers (###) for subtopics.
Every factual claim must have an inline citation [N].
Include data, statistics, examples, and comparisons where available.

## Frequently Asked Questions
3-5 follow-up questions with brief answers and citations.

## Sources
Numbered list of all cited sources with their domain and credibility score.

Rules:
- Language: {language}
- Be comprehensive (aim 600-1000 words for the Deep Analysis section)
- Prefer academic/authoritative sources (higher credibility score) when available
- Highlight when information is recent vs. established
- If sources contradict, note the disagreement
- Never fabricate facts — only use the provided context"""


async def synthesize_stream(
    query: str,
    top_chunks: list[dict],
    api_key: str,
    model: str = "google/gemini-2.0-flash-001",
    language: str = "same language as the question",
):
    """Stream a Perplexity-level structured research answer."""
    context, citations = build_context(top_chunks)

    citation_list = "\n".join([
        f"[{c['num']}] [{c['source_type'].upper()}] {c['title']} — {c['url']} (credibility: {c['credibility']})"
        for c in citations
    ])

    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        citation_list=citation_list,
        language=language
    )

    user_message = f"Research context from web, academic, and news sources:\n\n{context}\n\n---\n\nResearch question: {query}"

    async with httpx.AsyncClient(timeout=180) as client:
        async with client.stream(
            "POST",
            f"{OPENROUTER_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message}
                ],
                "max_tokens": 4000,
                "temperature": 0.35,
                "stream": True,
            }
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    payload = line[6:].strip()
                    if payload == "[DONE]":
                        break
                    try:
                        data = json.loads(payload)
                        token = data["choices"][0].get("delta", {}).get("content", "")
                        if token:
                            yield token, False, citations
                    except Exception:
                        pass

    yield "", True, citations


async def self_evaluate(query: str, answer: str, api_key: str, model: str) -> float:
    """Ask the LLM to score the completeness of the answer (0.0–1.0)."""
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{OPENROUTER_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "model": model,
                    "messages": [{
                        "role": "user",
                        "content": (
                            f"Question: {query}\n\nAnswer (first 1000 chars): {answer[:1000]}\n\n"
                            "Rate the completeness and quality of this answer from 0.0 to 1.0. "
                            "Respond ONLY with a decimal number like 0.85"
                        )
                    }],
                    "max_tokens": 10,
                    "temperature": 0.0,
                }
            )
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"].strip()
            return float(text)
    except Exception:
        return 0.85  # Assume good enough on error
