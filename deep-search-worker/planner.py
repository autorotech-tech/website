"""
Planner: decomposes user query into 3-5 focused search sub-queries using OpenRouter LLM.
"""
import json
import httpx
from typing import AsyncGenerator

OPENROUTER_BASE = "https://openrouter.ai/api/v1"


async def plan_queries(query: str, api_key: str, model: str = "google/gemini-2.0-flash-001") -> list[str]:
    """Break a complex question into 3-5 search sub-queries."""
    prompt = f"""You are a search query planner. Given a user's question, decompose it into 3-5 
focused search queries that together will help answer it comprehensively.

User question: {query}

Respond ONLY with a JSON array of strings, example:
["query 1", "query 2", "query 3"]

Keep queries concise and specific. Mix different angles (definition, examples, latest news, comparisons)."""

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{OPENROUTER_BASE}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 512,
                "temperature": 0.3,
            }
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"].strip()
        
        # Extract JSON array from response
        start = content.find("[")
        end = content.rfind("]") + 1
        if start >= 0 and end > start:
            queries = json.loads(content[start:end])
            return [q for q in queries if isinstance(q, str)][:5]
        
        # Fallback: just use original query
        return [query]
