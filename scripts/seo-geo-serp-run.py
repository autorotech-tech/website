#!/usr/bin/env python3
"""Run SERP via Swoop web/search (raw) for 17 SEO/GEO keywords."""
from __future__ import annotations

import csv
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CSV_IN = ROOT / "docs/seo-geo-wordstat-keywords.csv"
CSV_OUT = ROOT / "docs/seo-geo-manual-fill-template.csv"
JSON_OUT = ROOT / "docs/seo-geo-serp-results.json"

TARGETS = {
    "askona": "askona.ru/matrasy/deshevye-matrasy",
    "lamoda": "lamoda.ru/c/411/clothes-sportivnyebryuki",
}


def load_api_key() -> str:
    env_path = ROOT / ".env"
    for line in env_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("VITE_BOOKMARKS_API_KEY="):
            return line.split("=", 1)[1].strip()
    raise SystemExit("VITE_BOOKMARKS_API_KEY not found")


def http_json(url: str, *, headers: dict[str, str], body: dict | None = None, timeout: int = 90) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"error": raw[:500]}


def norm_url(url: str) -> str:
    u = (url or "").lower().strip()
    u = re.sub(r"^https?://", "", u)
    u = u.rstrip("/")
    return u


def find_pos(items: list[dict], host: str, target_slug: str | None = None) -> str:
    for i, item in enumerate(items, 1):
        url = norm_url(str(item.get("url") or ""))
        if host not in url:
            continue
        if target_slug and target_slug in url:
            return f"target #{i}"
        if not target_slug:
            path = url.split("/", 1)[-1] if "/" in url else url
            return f"{host.split('.')[0]} #{i} ({path[:40]})"
    return ""


def find_tavily_target(items: list[dict], page: str) -> str:
    slug = TARGETS[page]
    for item in items:
        url = norm_url(str(item.get("url") or ""))
        if slug in url:
            return "да"
    host = "askona.ru" if page == "askona" else "lamoda.ru"
    for item in items:
        url = norm_url(str(item.get("url") or ""))
        if host in url:
            return "бренд, не target"
    return "нет"


def swoop_search(api_key: str, query: str) -> dict[str, Any]:
    code, data = http_json(
        "https://swoop.autoro.tech/api/v1/web/search",
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        body={"query": query, "limit": 10, "mode": "raw"},
        timeout=120,
    )
    return {"http": code, **(data if isinstance(data, dict) else {"error": data})}


def main() -> None:
    api_key = load_api_key()
    keywords: list[dict[str, str]] = []
    with CSV_IN.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            keywords.append(row)

    results: list[dict[str, Any]] = []
    rows_out: list[dict[str, str]] = []

    for idx, kw in enumerate(keywords, 1):
        keyword = kw["keyword"]
        page = kw["page"]
        print(f"[{idx}/17] {keyword}", flush=True)
        resp = swoop_search(api_key, keyword)
        items = resp.get("items") if isinstance(resp.get("items"), list) else []
        brave = [i for i in items if isinstance(i, dict) and i.get("sourceProvider") == "brave"]
        tavily = [i for i in items if isinstance(i, dict) and i.get("sourceProvider") == "tavily"]

        host = "askona.ru" if page == "askona" else "lamoda.ru"
        target_slug = TARGETS[page]
        brave_pos = find_pos(brave, host, target_slug)
        if not brave_pos:
            brave_pos = find_pos(brave, host, None) or "нет"
        tavily_target = find_tavily_target(tavily, page)

        entry = {
            "keyword": keyword,
            "page": page,
            "providersUsed": resp.get("providersUsed"),
            "brave_count": len(brave),
            "tavily_count": len(tavily),
            "brave_pos": brave_pos,
            "tavily_target": tavily_target,
            "brave_top5": [{"pos": i + 1, "url": x.get("url")} for i, x in enumerate(brave[:5])],
            "tavily_top5": [{"pos": i + 1, "url": x.get("url")} for i, x in enumerate(tavily[:5])],
        }
        results.append(entry)

        rows_out.append(
            {
                "keyword": keyword,
                "tier": kw.get("tier", ""),
                "page": page,
                "wordstat_ws": kw.get("wordstat_demand", ""),
                "wordstat_phrase": "",
                "wordstat_exact": "",
                "google_pos": "",
                "yandex_pos": "",
                "bing_pos": brave_pos.replace("target", "target Brave").replace("askona", "Askona").replace("lamoda", "Lamoda") if brave_pos else "",
                "brave_pos": brave_pos,
                "tavily_target": tavily_target,
                "chatgpt_search_brand": "",
                "chatgpt_search_target": "",
                "gemini_app_brand": "",
                "gemini_app_target": "",
                "notes": kw.get("notes", ""),
            }
        )
        time.sleep(1.2)

    JSON_OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    fieldnames = [
        "keyword", "tier", "page", "wordstat_ws", "wordstat_phrase", "wordstat_exact",
        "google_pos", "yandex_pos", "bing_pos", "brave_pos", "tavily_target",
        "chatgpt_search_brand", "chatgpt_search_target", "gemini_app_brand", "gemini_app_target", "notes",
    ]
    with CSV_OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows_out)
    print(f"Wrote {JSON_OUT} and {CSV_OUT}")


if __name__ == "__main__":
    main()
