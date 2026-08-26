# Патч DeerFlow: Tavily web_search / extract с ротацией SWOOP_TAVILY_KEYS; fallback Brave.
# Путь: backend/packages/harness/deerflow/community/tavily/tools.py
# Ключи: админка Swoop → sync_swoop_models.py → SWOOP_TAVILY_KEYS, TAVILY_API_KEY (первый ключ).

import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from langchain.tools import tool
from tavily import TavilyClient

from deerflow.config import get_app_config

_PLACEHOLDER_KEYS = frozenset({"", "your-tavily-api-key"})


def _first_brave_key() -> str | None:
    raw = os.getenv("SWOOP_BRAVE_KEYS", "[]")
    try:
        keys = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(keys, list):
        return None
    for k in keys:
        s = str(k).strip()
        if s:
            return s
    return None


def _brave_web_search(query: str, max_results: int) -> str:
    key = _first_brave_key()
    if not key:
        return json.dumps(
            [
                {
                    "error": True,
                    "message": "Нет ключей Tavily (SWOOP_TAVILY_KEYS) и Brave (SWOOP_BRAVE_KEYS). Задайте в админке Swoop.",
                }
            ],
            indent=2,
            ensure_ascii=False,
        )
    params = urlencode(
        {"q": query, "count": max(1, min(max_results, 20)), "safesearch": "moderate"}
    )
    req = Request(
        f"https://api.search.brave.com/res/v1/web/search?{params}",
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": key,
            "User-Agent": "DeerFlow/1.0 (autoro.tech)",
        },
        method="GET",
    )
    try:
        with urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except HTTPError as e:
        return json.dumps(
            [{"error": True, "message": f"Brave Search HTTP {e.code}: {e.reason}"}],
            indent=2,
            ensure_ascii=False,
        )
    except (URLError, TimeoutError, json.JSONDecodeError) as e:
        return json.dumps(
            [{"error": True, "message": f"Brave Search failed: {e!s}"}],
            indent=2,
            ensure_ascii=False,
        )

    normalized = []
    for result in data.get("web", {}).get("results", [])[:max_results]:
        url = result.get("url")
        if not url:
            continue
        normalized.append(
            {
                "title": result.get("title", ""),
                "url": url,
                "snippet": result.get("description", ""),
            }
        )
    if not normalized:
        return json.dumps([], indent=2, ensure_ascii=False)
    return json.dumps(normalized, indent=2, ensure_ascii=False)


def _normalize_key(k: object) -> str | None:
    if k is None:
        return None
    s = str(k).strip()
    if not s or s in _PLACEHOLDER_KEYS:
        return None
    return s


def _all_tavily_keys() -> list[str]:
    """Порядок: ключ из config.yaml → SWOOP_TAVILY_KEYS → TAVILY_API_KEY."""
    out: list[str] = []
    seen: set[str] = set()

    def add(k: str | None) -> None:
        if not k or k in seen:
            return
        seen.add(k)
        out.append(k)

    config = get_app_config().get_tool_config("web_search")
    if config is not None and "api_key" in config.model_extra:
        add(_normalize_key(config.model_extra.get("api_key")))

    raw = os.getenv("SWOOP_TAVILY_KEYS", "[]")
    try:
        arr = json.loads(raw)
        if isinstance(arr, list):
            for x in arr:
                add(_normalize_key(x))
    except json.JSONDecodeError:
        pass

    add(_normalize_key(os.getenv("TAVILY_API_KEY")))
    return out


def _tavily_key_error_retryable_msg(msg: str) -> bool:
    m = msg.lower()
    needles = (
        "invalid api key",
        "api key",
        "unauthorized",
        "401",
        "403",
        "forbidden",
        "429",
        "rate limit",
        "quota",
        "exceeded",
        "credit",
        "payment",
        "authentication",
    )
    return any(n in m for n in needles)


def _tavily_key_error_retryable(exc: BaseException) -> bool:
    return _tavily_key_error_retryable_msg(str(exc))


@tool("web_search", parse_docstring=True)
def web_search_tool(query: str) -> str:
    """Search the web.

    Args:
        query: The query to search for.
    """
    config = get_app_config().get_tool_config("web_search")
    max_results = 5
    if config is not None and "max_results" in config.model_extra:
        max_results = config.model_extra.get("max_results")

    keys = _all_tavily_keys()
    if not keys:
        return _brave_web_search(query, max_results)

    last_err: BaseException | None = None
    for api_key in keys:
        try:
            client = TavilyClient(api_key=api_key)
            res = client.search(query, max_results=max_results)
            normalized_results = [
                {
                    "title": result["title"],
                    "url": result["url"],
                    "snippet": result["content"],
                }
                for result in res["results"]
            ]
            return json.dumps(normalized_results, indent=2, ensure_ascii=False)
        except Exception as e:  # noqa: BLE001
            last_err = e
            if _tavily_key_error_retryable(e):
                continue
            return json.dumps(
                [{"error": True, "message": str(e)}],
                indent=2,
                ensure_ascii=False,
            )

    if last_err is not None:
        # Все Tavily-ключи отклонены — Brave как запасной канал
        return _brave_web_search(query, max_results)
    return _brave_web_search(query, max_results)


@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(url: str) -> str:
    """Fetch the contents of a web page at a given URL.
    Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.
    This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.
    Do NOT add www. to URLs that do NOT have them.
    URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.

    Args:
        url: The URL to fetch the contents of.
    """
    keys = _all_tavily_keys()
    if not keys:
        return (
            "Error: Tavily extract needs keys in SWOOP_TAVILY_KEYS (админка Swoop) или TAVILY_API_KEY. "
            "Либо используйте web_fetch на базе Jina из конфигурации."
        )

    last_err: BaseException | None = None
    for api_key in keys:
        try:
            client = TavilyClient(api_key=api_key)
            res = client.extract([url])
            if "failed_results" in res and len(res["failed_results"]) > 0:
                err_txt = str(res["failed_results"][0].get("error", ""))
                if _tavily_key_error_retryable_msg(err_txt):
                    last_err = RuntimeError(err_txt)
                    continue
                return f"Error: {res['failed_results'][0]['error']}"
            if "results" in res and len(res["results"]) > 0:
                result = res["results"][0]
                return f"# {result['title']}\n\n{result['raw_content'][:4096]}"
            return "Error: No results found"
        except Exception as e:  # noqa: BLE001
            last_err = e
            if _tavily_key_error_retryable(e):
                continue
            return f"Error: {e!s}"

    return f"Error: все ключи Tavily исчерпаны: {last_err!s}" if last_err else "Error: extract failed"
