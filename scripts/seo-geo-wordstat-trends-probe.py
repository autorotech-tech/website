#!/usr/bin/env python3
"""Probe Wordstat alternatives: SerpAPI google_trends via Swoop (4 missing keywords)."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
JSON_OUT = ROOT / "docs/seo-geo-serp-results.json"
WORDSTAT_CSV = ROOT / "docs/seo-geo-wordstat-keywords.csv"
SWOOP_BASE = os.environ.get("SWOOP_API_BASE", "https://swoop.autoro.tech").rstrip("/")

TREND_KEYWORDS = [
    "дешевые матрасы askona",
    "дешевый матрас 160x200 купить",
    "матрас эконом класса askona",
    "женские спортивные штаны lamoda",
]


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
    raise SystemExit("VITE_BOOKMARKS_API_KEY not found")


def http_json(url: str, *, headers: dict[str, str], body: dict[str, Any]) -> tuple[int, Any]:
    cmd = [
        "curl",
        "-sS",
        "-m",
        "120",
        "-w",
        "\n__HTTP__%{http_code}",
        "-X",
        "POST",
        "-H",
        "Content-Type: application/json",
    ]
    for key, value in headers.items():
        cmd.extend(["-H", f"{key}: {value}"])
    cmd.extend(["-d", json.dumps(body, ensure_ascii=False), url])
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
        return code or proc.returncode or 0, {"error": (proc.stderr or "empty")[:800]}
    try:
        return code, json.loads(payload)
    except json.JSONDecodeError:
        return code, {"error": payload[:800]}


def main() -> None:
    api_key = load_api_key()
    results: list[dict[str, Any]] = []

    for idx, phrase in enumerate(TREND_KEYWORDS, 1):
        print(f"[{idx}/4] google_trends: {phrase}", flush=True)
        code, data = http_json(
            f"{SWOOP_BASE}/api/v1/web/search/serpapi",
            headers={"X-API-Key": api_key},
            body={"query": phrase, "engine": "google_trends", "limit": 10},
        )
        ok = isinstance(data, dict) and data.get("ok") and code == 200
        entry = {
            "keyword": phrase,
            "engine": "google_trends",
            "http": code,
            "ok": ok,
            "count": data.get("count") if isinstance(data, dict) else None,
            "detail": data.get("detail") if isinstance(data, dict) else str(data)[:400],
            "error": data.get("error") if isinstance(data, dict) else None,
            "search_metadata": data.get("search_metadata") if isinstance(data, dict) else None,
            "note": (
                "Google Trends returns interest index 0–100, not Wordstat monthly impressions. "
                "Swoop wrapper expects organic_results — often 502 for google_trends."
            ),
        }
        results.append(entry)
        time.sleep(1.5)

    payload = {
        "run_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "purpose": "Wordstat gap proxy attempt (4 keywords)",
        "verdict": {
            "yandex_wordstat_via_serpapi": False,
            "reason": (
                "SerpAPI has yandex engine for SERP only, not Wordstat. "
                "Yandex Wordstat API is separate: Yandex Cloud Search API v2 / Direct API."
            ),
            "google_trends_via_swoop": any(r.get("ok") for r in results),
            "google_trends_limitation": (
                "Trends = relative interest, geo=RU recommended; not comparable to Wordstat Moscow 213."
            ),
        },
        "results": results,
    }

    if JSON_OUT.exists():
        root = json.loads(JSON_OUT.read_text(encoding="utf-8"))
        if not isinstance(root, dict):
            root = {}
    else:
        root = {}
    root["google_trends_probe"] = payload
    JSON_OUT.write_text(json.dumps(root, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nWrote google_trends_probe → {JSON_OUT}", flush=True)
    if not any(r.get("ok") for r in results):
        print("All google_trends probes failed (expected: Swoop SerpAPI wrapper lacks trends payload).", file=sys.stderr)


if __name__ == "__main__":
    main()
