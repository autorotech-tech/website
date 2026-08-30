"""
Fetcher: async HTML scraping and conversion to clean Markdown using trafilatura.
"""
import asyncio
import httpx
import trafilatura
from trafilatura.settings import use_config


# Trafilatura config: fast, no images
_config = use_config()
_config.set("DEFAULT", "TIMEOUT", "10")
_config.set("DEFAULT", "MAX_FILE_SIZE", "5000000")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AutoroBot/1.0; +https://autoro.tech)",
    "Accept": "text/html,application/xhtml+xml",
}


async def fetch_one(url: str) -> dict | None:
    """Fetch a single URL and extract clean text."""
    try:
        async with httpx.AsyncClient(
            timeout=12,
            headers=HEADERS,
            follow_redirects=True,
            limits=httpx.Limits(max_connections=20)
        ) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None
            
            html = resp.text
            # Extract clean text with trafilatura
            text = trafilatura.extract(
                html,
                url=url,
                config=_config,
                include_tables=True,
                include_links=False,
                output_format="markdown"
            )
            
            if not text or len(text.strip()) < 100:
                return None
            
            return {"url": url, "content": text[:8000]}  # Cap at 8k chars
    except Exception as e:
        print(f"[fetcher] Error fetching {url}: {e}")
        return None


async def fetch_all(search_results: list[dict], max_pages: int = 12) -> list[dict]:
    """Fetch top search results in parallel, return those with extracted content."""
    urls = [r["url"] for r in search_results[:max_pages] if r.get("url")]
    
    tasks = [fetch_one(url) for url in urls]
    fetched = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Build URL→snippet lookup from search results
    snippet_map = {r["url"]: r for r in search_results}
    
    combined = []
    for i, result in enumerate(fetched):
        if isinstance(result, dict) and result.get("content"):
            url = urls[i]
            meta = snippet_map.get(url, {})
            combined.append({
                "url": url,
                "title": meta.get("title", ""),
                "snippet": meta.get("snippet", ""),
                "content": result["content"],
                "source": meta.get("source", "web")
            })
    
    return combined


def chunk_document(doc: dict, chunk_size: int = 1000, overlap: int = 150) -> list[dict]:
    """Split document content into overlapping chunks."""
    content = doc["content"]
    chunks = []
    start = 0
    i = 0
    while start < len(content):
        end = min(start + chunk_size, len(content))
        chunks.append({
            **doc,
            "chunk_id": i,
            "content": content[start:end]
        })
        start += chunk_size - overlap
        i += 1
    return chunks
