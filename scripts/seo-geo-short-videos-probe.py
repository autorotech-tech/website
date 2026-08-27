#!/usr/bin/env python3
"""Probe Google Short Videos (SerpAPI engine=google_short_videos) for SEO/GEO keywords."""
from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
AGENT_API = ROOT / "agent-api"
CSV_PATH = ROOT / "docs/seo-geo-manual-fill-template.csv"
JSON_OUT = ROOT / "docs/seo-geo-short-videos-results.json"
SWOOP_BASE = os.environ.get("SWOOP_API_BASE", "https://swoop.autoro.tech").rstrip("/")

# Representative mix: Askona HF/MF + Lamoda HF/MF/brand
PROBE_KEYWORDS: list[dict[str, str]] = [
    {"keyword": "дешевые матрасы", "page": "askona", "tier": "HF"},
    {"keyword": "матрасы купить", "page": "askona", "tier": "HF"},
    {"keyword": "дешевые матрасы askona", "page": "askona", "tier": "MF"},
    {"keyword": "женские спортивные брюки", "page": "lamoda", "tier": "HF"},
    {"keyword": "женские спортивные штаны lamoda", "page": "lamoda", "tier": "MF"},
]

BRAND_DOMAINS = {
    "askona": ("askona.ru", "askona"),
    "lamoda": ("lamoda.ru", "lamoda"),
}

SLEEP_SEC = float(os.environ.get("SERPAPI_SLEEP_SEC", "1.5"))


def load_api_key() -> str:
    env_path = ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("VITE_BOOKMARKS_API_KEY="):
                val = line.split("=", 1)[1].strip()
                if val:
                    return val
    alt = os.environ.get("VITE_BOOKMARKS_API_KEY") or os.environ.get("AGENT_API_KEY")
    if alt:
        return alt.strip()
    raise SystemExit("VITE_BOOKMARKS_API_KEY not found in .env or env")


def load_serpapi_key_local() -> str:
    """Load SerpAPI key from env or agent-api DB (same pattern as seo-geo-serp-serpapi-run.py)."""
    key = (os.environ.get("SERPAPI_API_KEY") or "").strip()
    if key:
        return key

    env_path = AGENT_API / ".env"
    pg_env: dict[str, str] = {}
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            if line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            pg_env[k.strip()] = v.strip()
    for env_key, val in pg_env.items():
        if env_key.startswith("PG") or env_key.startswith("BOOKMARKS_PG"):
            os.environ.setdefault(env_key, val)

    try:
        import psycopg2  # noqa: WPS433

        conn = psycopg2.connect(
            host=os.environ.get("PGHOST", "supabase-db"),
            port=int(os.environ.get("PGPORT", "5433")),
            dbname=os.environ.get("PGDATABASE", "postgres"),
            user=os.environ.get("PGUSER", "supabase_admin"),
            password=os.environ.get("PGPASSWORD", ""),
        )
        with conn.cursor() as cur:
            cur.execute("SELECT serpapi_keys FROM public.service_settings WHERE id=1 LIMIT 1")
            row = cur.fetchone()
        conn.close()
        if row and row[0]:
            keys_raw = row[0]
            if isinstance(keys_raw, str):
                keys_raw = json.loads(keys_raw)
            if isinstance(keys_raw, list):
                cleaned = [str(k).strip() for k in keys_raw if str(k).strip()]
                if cleaned:
                    return cleaned[0]
    except Exception as exc:
        print(f"load_serpapi_key_local: DB fallback failed: {exc}", file=sys.stderr)
    raise SystemExit("SerpAPI key not found: set SERPAPI_API_KEY or SERPAPI_USE_LOCAL with DB")


def load_serpapi_key() -> str:
    key = (os.environ.get("SERPAPI_API_KEY") or "").strip()
    if key:
        return key
    raise SystemExit("Set SERPAPI_API_KEY or SERPAPI_USE_LOCAL=1 with DB key")


def use_local_serpapi() -> bool:
    return os.environ.get("SERPAPI_USE_LOCAL", "").strip().lower() in {"1", "true", "yes"}


def http_json(url: str, *, timeout: int = 120) -> tuple[int, Any]:
    cmd = ["curl", "-sS", "-m", str(timeout), "-w", "\n__HTTP__%{http_code}", url]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    raw = proc.stdout or proc.stderr or ""
    if "__HTTP__" in raw:
        payload, _, status_tail = raw.rpartition("\n__HTTP__")
        try:
            code = int(status_tail.strip())
        except ValueError:
            code = 0
    else:
        payload, code = raw, 0
    payload = payload.strip()
    if not payload:
        return code or proc.returncode or 0, {"error": (proc.stderr or "empty response")[:800]}
    try:
        return code, json.loads(payload)
    except json.JSONDecodeError:
        return code, {"error": payload[:800]}


def search_direct_serpapi(api_key: str, query: str, limit: int = 12) -> dict[str, Any]:
    params = {
        "engine": "google_short_videos",
        "q": query,
        "api_key": api_key,
        "google_domain": "google.ru",
        "gl": "ru",
        "hl": "ru",
        "location": "Moscow, Russia",
        "device": "desktop",
    }
    from urllib.parse import urlencode

    url = f"https://serpapi.com/search.json?{urlencode(params)}"
    code, body = http_json(url)
    if not isinstance(body, dict):
        return {"ok": False, "error": str(body), "http_code": code}
    videos = body.get("short_video_results") if isinstance(body.get("short_video_results"), list) else []
    err = body.get("error")
    ok = code == 200 and not err and bool(videos)
    return {
        "ok": ok,
        "http_code": code,
        "short_video_results": videos[:limit],
        "search_information": body.get("search_information"),
        "search_metadata": body.get("search_metadata"),
        "error": err,
    }


def search_local(api_key: str, query: str, limit: int = 12) -> dict[str, Any]:
    if str(AGENT_API) not in sys.path:
        sys.path.insert(0, str(AGENT_API))
    from swoop_serpapi import serpapi_search_raw  # noqa: WPS433

    return serpapi_search_raw(api_key, query, limit, engine="google_short_videos")


def search_swoop(api_key: str, query: str, limit: int = 12) -> dict[str, Any]:
    import subprocess

    body = json.dumps({"query": query, "engine": "google_short_videos", "limit": limit})
    cmd = [
        "curl",
        "-sS",
        "-m",
        "120",
        "-w",
        "\n__HTTP__%{http_code}",
        "-X",
        "POST",
        f"{SWOOP_BASE}/api/v1/web/search/serpapi",
        "-H",
        f"X-API-Key: {api_key}",
        "-H",
        "Content-Type: application/json",
        "-d",
        body,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    raw = proc.stdout or ""
    if "__HTTP__" not in raw:
        return {"ok": False, "error": raw or proc.stderr, "http_code": proc.returncode}
    payload, _, code_str = raw.rpartition("\n__HTTP__")
    try:
        parsed = json.loads(payload)
    except json.JSONDecodeError:
        return {"ok": False, "error": payload[:400], "http_code": int(code_str or 0)}
    if isinstance(parsed, dict):
        parsed["http_code"] = int(code_str or 0)
        return parsed
    return {"ok": False, "error": "invalid_json", "http_code": int(code_str or 0)}


def brand_in_videos(page: str, videos: list[dict[str, Any]]) -> tuple[bool, str]:
    domain, brand = BRAND_DOMAINS.get(page, ("", ""))
    if not domain:
        return False, "нет"
    for row in videos:
        link = str(row.get("link") or row.get("url") or "").lower()
        title = str(row.get("title") or "").lower()
        channel = str(row.get("channel") or "").lower()
        if domain in link or brand in link or brand in title or brand in channel:
            return True, "да"
    return False, "нет"


def summarize_entry(kw: dict[str, str], resp: dict[str, Any]) -> dict[str, Any]:
    videos = resp.get("short_video_results") or []
    if not videos and resp.get("items"):
        videos = [
            {
                "link": i.get("url"),
                "title": i.get("title"),
                "source": i.get("source"),
                "channel": i.get("channel"),
                "duration": i.get("duration"),
                "position": i.get("position"),
            }
            for i in resp.get("items", [])
            if isinstance(i, dict)
        ]
    present = bool(videos)
    brand_hit, brand_label = brand_in_videos(kw["page"], videos)
    top_sources = sorted({str(v.get("source") or "?") for v in videos[:6]})
    sample = [
        {
            "pos": v.get("position"),
            "title": (v.get("title") or "")[:80],
            "link": v.get("link") or v.get("url"),
            "source": v.get("source"),
            "channel": v.get("channel"),
        }
        for v in videos[:3]
    ]
    return {
        "keyword": kw["keyword"],
        "page": kw["page"],
        "tier": kw["tier"],
        "ok": bool(resp.get("ok") or present),
        "count": len(videos),
        "short_videos_present": "да" if present else "нет",
        "brand_in_short_videos": brand_label if present else "—",
        "brand_match": brand_hit,
        "top_sources": top_sources,
        "search_information": resp.get("search_information"),
        "google_short_videos_url": (
            (resp.get("search_metadata") or {}).get("google_short_videos_url")
            if isinstance(resp.get("search_metadata"), dict)
            else None
        ),
        "sample": sample,
        "error": resp.get("error") or resp.get("detail"),
    }


def update_csv(summaries: list[dict[str, Any]]) -> None:
    if not CSV_PATH.exists():
        return
    rows: list[dict[str, str]] = []
    with CSV_PATH.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        fieldnames = list(reader.fieldnames or [])
        for col in ("short_videos_present", "brand_in_short_videos"):
            if col not in fieldnames:
                fieldnames.append(col)
        for row in reader:
            rows.append(dict(row))

    by_kw = {s["keyword"]: s for s in summaries}
    for row in rows:
        kw = row.get("keyword", "")
        if kw not in by_kw:
            continue
        s = by_kw[kw]
        row["short_videos_present"] = s["short_videos_present"]
        row["brand_in_short_videos"] = s["brand_in_short_videos"]

    with CSV_PATH.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    swoop_key = load_api_key()
    serp_key = ""
    if use_local_serpapi():
        serp_key = load_serpapi_key_local()
    else:
        try:
            serp_key = load_serpapi_key()
        except SystemExit:
            serp_key = ""

    results: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []

    for idx, kw in enumerate(PROBE_KEYWORDS):
        query = kw["keyword"]
        print(f"[{idx + 1}/{len(PROBE_KEYWORDS)}] {query} …", flush=True)
        if use_local_serpapi() and serp_key:
            resp = search_direct_serpapi(serp_key, query)
        elif serp_key:
            resp = search_direct_serpapi(serp_key, query)
        else:
            resp = search_swoop(swoop_key, query)
        entry = summarize_entry(kw, resp)
        entry["raw_ok"] = resp.get("ok")
        results.append({"request": kw, "response": resp})
        summaries.append(entry)
        print(
            f"  → videos={entry['count']} brand={entry['brand_in_short_videos']} "
            f"sources={entry['top_sources'][:3]}",
            flush=True,
        )
        if idx + 1 < len(PROBE_KEYWORDS):
            time.sleep(SLEEP_SEC)

    payload = {
        "probe_run": {
            "at": datetime.now(timezone.utc).isoformat(),
            "engine": "google_short_videos",
            "geo": {"google_domain": "google.ru", "gl": "ru", "hl": "ru", "location": "Moscow, Russia"},
            "keywords_tested": len(PROBE_KEYWORDS),
            "mode": "direct_serpapi_curl" if serp_key else "swoop_endpoint",
            "script": "scripts/seo-geo-short-videos-probe.py",
        },
        "summaries": summaries,
        "results": results,
    }
    JSON_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    update_csv(summaries)
    print(f"\nWrote {JSON_OUT}", flush=True)


if __name__ == "__main__":
    main()
