"""
Enhanced Searcher: SearXNG + Brave + Wikipedia + ArXiv + News
Targets 30+ sources per query for Perplexity-level coverage.
"""
import asyncio
import httpx
from datetime import datetime, UTC


HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; AutoroBot/1.0; +https://autoro.tech)",
}

SEARXNG_URL = None  # Set from settings.py at runtime


def _ensure_searxng_url():
    import settings as s
    return s.SEARXNG_URL


# ─── Individual source fetchers ─────────────────────────────────────────────

async def search_searxng(query: str, client: httpx.AsyncClient, num: int = 15) -> list[dict]:
    url = _ensure_searxng_url()
    try:
        r = await client.get(
            f"{url}/search",
            params={"q": query, "format": "json", "language": "auto", "time_range": "year"},
            timeout=12
        )
        r.raise_for_status()
        return [
            {"title": x.get("title",""), "url": x.get("url",""),
             "snippet": x.get("content",""), "source": "searxng",
             "credibility": _credibility(x.get("url",""))}
            for x in r.json().get("results", [])[:num] if x.get("url")
        ]
    except Exception as e:
        print(f"[searcher] SearXNG error: {e}")
        return []


def _brave_key_list(brave_keys: list[str] | str) -> list[str]:
    if isinstance(brave_keys, str):
        return [brave_keys.strip()] if brave_keys.strip() else []
    return [str(k).strip() for k in brave_keys if k and str(k).strip()]


async def search_brave(query: str, client: httpx.AsyncClient, brave_keys: list[str] | str, num: int = 10) -> list[dict]:
    keys = _brave_key_list(brave_keys)
    if not keys:
        return []
    for brave_key in keys:
        try:
            r = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                headers={"Accept": "application/json", "X-Subscription-Token": brave_key},
                params={"q": query, "count": num, "safesearch": "off", "freshness": "py"},
                timeout=12
            )
            if r.status_code in (401, 403, 429) or r.status_code >= 500:
                print(f"[searcher] Brave web HTTP {r.status_code}, next key")
                continue
            r.raise_for_status()
            return [
                {"title": x.get("title",""), "url": x.get("url",""),
                 "snippet": x.get("description",""), "source": "brave",
                 "credibility": _credibility(x.get("url",""))}
                for x in r.json().get("web", {}).get("results", [])[:num] if x.get("url")
            ]
        except httpx.HTTPStatusError as e:
            code = e.response.status_code if e.response else 0
            if code in (401, 403, 429) or code >= 500:
                print(f"[searcher] Brave web HTTP {code}, next key")
                continue
            print(f"[searcher] Brave error: {e}")
        except Exception as e:
            print(f"[searcher] Brave error: {e}")
    return []


async def search_wikipedia(query: str, client: httpx.AsyncClient, num: int = 3) -> list[dict]:
    try:
        r = await client.get(
            "https://en.wikipedia.org/w/api.php",
            params={"action":"query","list":"search","srsearch":query,
                    "srlimit":num,"format":"json","srprop":"snippet"},
            timeout=10
        )
        r.raise_for_status()
        return [
            {"title": x.get("title",""),
             "url": f"https://en.wikipedia.org/?curid={x.get('pageid')}",
             "snippet": x.get("snippet","").replace('<span class="searchmatch">','').replace('</span>',''),
             "source": "wikipedia", "credibility": 0.95}
            for x in r.json().get("query",{}).get("search",[])
        ]
    except Exception as e:
        print(f"[searcher] Wikipedia error: {e}")
        return []


async def search_arxiv(query: str, client: httpx.AsyncClient, num: int = 5) -> list[dict]:
    """ArXiv API — academic papers, free, no key needed."""
    try:
        r = await client.get(
            "https://export.arxiv.org/api/query",
            params={"search_query": f"all:{query}", "max_results": num,
                    "sortBy": "relevance", "sortOrder": "descending"},
            timeout=15
        )
        r.raise_for_status()
        results = []
        import xml.etree.ElementTree as ET
        root = ET.fromstring(r.text)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = entry.findtext("atom:title", namespaces=ns) or ""
            summary = entry.findtext("atom:summary", namespaces=ns) or ""
            arxiv_id = (entry.findtext("atom:id", namespaces=ns) or "").strip()
            # Convert abs URL to PDF viewing URL
            url = arxiv_id.replace("http://arxiv.org/abs/", "https://arxiv.org/abs/")
            results.append({
                "title": title.strip().replace("\n", " "),
                "url": url,
                "snippet": summary.strip()[:400].replace("\n", " "),
                "source": "arxiv",
                "credibility": 0.98  # peer-reviewed
            })
        return results
    except Exception as e:
        print(f"[searcher] ArXiv error: {e}")
        return []


async def search_news(query: str, client: httpx.AsyncClient, brave_keys: list[str] | str, num: int = 5) -> list[dict]:
    """Brave News search for recent events."""
    keys = _brave_key_list(brave_keys)
    if not keys:
        return []
    for brave_key in keys:
        try:
            r = await client.get(
                "https://api.search.brave.com/res/v1/news/search",
                headers={"Accept": "application/json", "X-Subscription-Token": brave_key},
                params={"q": query, "count": num},
                timeout=12
            )
            if r.status_code in (401, 403, 429) or r.status_code >= 500:
                print(f"[searcher] Brave news HTTP {r.status_code}, next key")
                continue
            r.raise_for_status()
            return [
                {"title": x.get("title",""), "url": x.get("url",""),
                 "snippet": x.get("description",""), "source": "news",
                 "credibility": _credibility(x.get("url",""))}
                for x in r.json().get("results", [])[:num] if x.get("url")
            ]
        except httpx.HTTPStatusError as e:
            code = e.response.status_code if e.response else 0
            if code in (401, 403, 429) or code >= 500:
                print(f"[searcher] Brave news HTTP {code}, next key")
                continue
            print(f"[searcher] News error: {e}")
        except Exception as e:
            print(f"[searcher] News error: {e}")
    return []


# ─── Credibility scoring ─────────────────────────────────────────────────────

HIGH_CREDIBILITY_DOMAINS = {
    "wikipedia.org": 0.95, "arxiv.org": 0.98, "nature.com": 0.97,
    "sciencedirect.com": 0.96, "pubmed.ncbi.nlm.nih.gov": 0.97,
    "scholar.google.com": 0.93, "reuters.com": 0.90, "bbc.com": 0.88,
    "nytimes.com": 0.87, "theguardian.com": 0.86, "github.com": 0.85,
    "stackoverflow.com": 0.83, "medium.com": 0.65, "reddit.com": 0.55,
}

def _credibility(url: str) -> float:
    for domain, score in HIGH_CREDIBILITY_DOMAINS.items():
        if domain in url:
            return score
    # HTTPS gets slight boost
    return 0.72 if url.startswith("https://") else 0.60


# ─── Main parallel search ────────────────────────────────────────────────────

async def multi_search(queries: list[str], brave_keys: list[str] | str = "") -> list[dict]:
    """
    Run all queries across all sources in parallel.
    Returns deduplicated, credibility-sorted results (up to 50).
    """
    async with httpx.AsyncClient(headers=HEADERS, follow_redirects=True) as client:
        tasks = []
        for q in queries:
            tasks += [
                search_searxng(q, client, num=12),
                search_brave(q, client, brave_keys, num=8),
                search_wikipedia(q, client, num=3),
                search_arxiv(q, client, num=4),
                search_news(q, client, brave_keys, num=4),
            ]

        all_nested = await asyncio.gather(*tasks, return_exceptions=True)

    # Deduplicate by URL, keep best credibility
    seen: dict[str, dict] = {}
    for bucket in all_nested:
        if isinstance(bucket, list):
            for r in bucket:
                url = r.get("url", "")
                if not url:
                    continue
                existing = seen.get(url)
                if not existing or r.get("credibility", 0) > existing.get("credibility", 0):
                    seen[url] = r

    # Sort: credibility first, then arxiv/wikipedia on top
    ordered = sorted(seen.values(), key=lambda x: x.get("credibility", 0), reverse=True)
    return ordered[:60]  # More headroom before reranking
