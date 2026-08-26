#!/usr/bin/env python3
"""Run Google/Yandex/Bing/DuckDuckGo SERP via Swoop SerpApi for 17 SEO/GEO keywords."""
from __future__ import annotations

import csv
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
AGENT_API = ROOT / "agent-api"
CSV_IN = ROOT / "docs/seo-geo-wordstat-keywords.csv"
CSV_OUT = ROOT / "docs/seo-geo-manual-fill-template.csv"
JSON_OUT = ROOT / "docs/seo-geo-serp-results.json"
SWOOP_BASE = os.environ.get("SWOOP_API_BASE", "https://swoop.autoro.tech").rstrip("/")

TARGETS = {
    "askona": "askona.ru/matrasy/deshevye-matrasy",
    "lamoda": "lamoda.ru/c/411/clothes-sportivnyebryuki",
}

DEFAULT_ENGINES = ["google", "yandex"]
SUPPORTED_ENGINES = {"google", "yandex", "bing", "duckduckgo"}
DEFAULT_DDG_LOCALES = ["ru-ru", "us-en"]


def parse_engines() -> list[str]:
    raw = os.environ.get("SERPAPI_ENGINES", ",".join(DEFAULT_ENGINES))
    engines = [e.strip().lower() for e in raw.split(",") if e.strip()]
    unknown = [e for e in engines if e not in SUPPORTED_ENGINES]
    if unknown:
        raise SystemExit(
            f"Unsupported SERPAPI_ENGINES: {unknown}. "
            f"Use: {', '.join(sorted(SUPPORTED_ENGINES))}. "
            "google_trends is not a SERP engine — run scripts/seo-geo-wordstat-trends-probe.py"
        )
    return engines or DEFAULT_ENGINES


SLEEP_SEC = float(os.environ.get("SERPAPI_SLEEP_SEC", "1.2"))

ENGINE_GEO: dict[str, dict[str, str]] = {
    "duckduckgo": {"kl": "ru-ru"},
}


def parse_ddg_locales() -> list[str]:
    raw = os.environ.get("SERPAPI_DDG_LOCALES", ",".join(DEFAULT_DDG_LOCALES))
    locales = [x.strip().lower() for x in raw.split(",") if x.strip()]
    return locales or DEFAULT_DDG_LOCALES


def ddg_locale_suffix(kl: str) -> str:
    if kl == "ru-ru":
        return "ru"
    if kl == "us-en":
        return "en"
    return kl.replace("-", "_")


def engine_geo(engine: str, ddg_kl: str | None = None) -> dict[str, str] | None:
    if engine == "duckduckgo":
        return {"kl": ddg_kl or "ru-ru"}
    return ENGINE_GEO.get(engine)


def use_local_serpapi() -> bool:
    return os.environ.get("SERPAPI_USE_LOCAL", "").strip().lower() in {"1", "true", "yes"}


def load_serpapi_key_local() -> str:
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

    raise SystemExit(
        "SerpAPI key not found: set SERPAPI_API_KEY, or configure serpapi_keys in Swoop / agent-api DB"
    )


def serpapi_search_local(
    api_key: str,
    query: str,
    engine: str,
    limit: int = 10,
    *,
    ddg_kl: str | None = None,
) -> dict[str, Any]:
    if str(AGENT_API) not in sys.path:
        sys.path.insert(0, str(AGENT_API))
    from swoop_serpapi import serpapi_search_raw  # noqa: WPS433

    geo = engine_geo(engine, ddg_kl=ddg_kl)
    raw = serpapi_search_raw(
        api_key,
        query,
        limit,
        engine=engine,
        geo=geo,
    )
    items = raw.get("items") if isinstance(raw.get("items"), list) else []
    return {
        "http": raw.get("http_code"),
        "ok": bool(raw.get("ok")),
        "items": items,
        "organic_results": raw.get("organic_results") or [],
        "search_metadata": raw.get("search_metadata"),
        "error": raw.get("error"),
        "detail": raw.get("error"),
        "source": "local_serpapi",
    }


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


def http_json(
    url: str,
    *,
    headers: dict[str, str],
    body: dict[str, Any] | None = None,
    timeout: int = 120,
) -> tuple[int, Any]:
    """Prefer curl on macOS where Python SSL store may be incomplete."""
    cmd = ["curl", "-sS", "-m", str(timeout), "-w", "\n__HTTP__%{http_code}"]
    for key, value in headers.items():
        cmd.extend(["-H", f"{key}: {value}"])
    if body is not None:
        cmd.extend(["-X", "POST", "-d", json.dumps(body, ensure_ascii=False)])
    cmd.append(url)
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        return 0, {"error": "curl not found"}
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


def norm_url(url: str) -> str:
    u = (url or "").lower().strip()
    u = re.sub(r"^https?://", "", u)
    u = u.rstrip("/")
    return u


def short_path(url: str, host: str) -> str:
    n = norm_url(url)
    if host in n:
        idx = n.find(host)
        path = n[idx + len(host) :]
        return path[:48] or "/"
    return n[:48]


def analyze_serp(items: list[dict[str, Any]], page: str) -> tuple[str, str]:
    """Return (position_label, competing_notes)."""
    slug = TARGETS[page]
    host = "askona.ru" if page == "askona" else "lamoda.ru"
    brand_hits: list[str] = []
    target_pos: int | None = None

    for i, item in enumerate(items, 1):
        url = norm_url(str(item.get("url") or item.get("link") or ""))
        if not url:
            continue
        if slug in url:
            target_pos = i
            break
        if host in url:
            brand = "Askona" if page == "askona" else "Lamoda"
            brand_hits.append(f"{brand} #{i} {short_path(url, host)}")

    if target_pos is not None:
        if target_pos <= 10:
            return str(target_pos), ""
        return ">10", "; ".join(brand_hits[:2])

    if brand_hits:
        return ">10", "; ".join(brand_hits[:3])
    return "нет", ""


def swoop_serpapi(
    api_key: str,
    query: str,
    engine: str,
    *,
    ddg_kl: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"query": query, "engine": engine, "limit": 10}
    geo = engine_geo(engine, ddg_kl=ddg_kl)
    if geo:
        body["geo"] = geo
    code, data = http_json(
        f"{SWOOP_BASE}/api/v1/web/search/serpapi",
        headers={"Content-Type": "application/json", "X-API-Key": api_key},
        body=body,
        timeout=120,
    )
    if not isinstance(data, dict):
        return {"http": code, "ok": False, "error": str(data)[:400], "items": []}
    return {"http": code, **data, "source": "swoop"}


def load_existing_csv() -> dict[str, dict[str, str]]:
    if not CSV_OUT.exists():
        return {}
    with CSV_OUT.open(encoding="utf-8") as f:
        return {row["keyword"]: row for row in csv.DictReader(f)}


def load_json_root() -> dict[str, Any]:
    if not JSON_OUT.exists():
        return {}
    raw = json.loads(JSON_OUT.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return {"tavily_run": raw}
    if isinstance(raw, dict):
        return raw
    return {}


def merge_notes(existing: str, engine: str, extra: str) -> str:
    tag = f"SerpAPI {engine}:"
    if extra and tag not in (existing or ""):
        piece = f"{tag} {extra}"
        return f"{existing}; {piece}".strip("; ") if existing else piece
    return existing or ""


def main() -> None:
    api_key = load_api_key()
    serpapi_key_local = ""
    if use_local_serpapi():
        serpapi_key_local = load_serpapi_key_local()
        print("SERPAPI_USE_LOCAL=1 → direct SerpAPI with agent-api geo defaults", flush=True)
    keywords: list[dict[str, str]] = []
    with CSV_IN.open(encoding="utf-8") as f:
        for row in csv.DictReader(f):
            keywords.append(row)

    existing_rows = load_existing_csv()
    serpapi_results: list[dict[str, Any]] = []
    rows_out: list[dict[str, str]] = []
    failures: list[str] = []
    engines = parse_engines()
    filled_google = 0
    filled_yandex = 0
    filled_bing = 0
    filled_dduck_ru = 0
    filled_dduck_en = 0
    ddg_locales = parse_ddg_locales() if "duckduckgo" in engines else []

    fieldnames = [
        "keyword",
        "tier",
        "page",
        "wordstat_ws",
        "wordstat_phrase",
        "wordstat_exact",
        "google_pos",
        "yandex_pos",
        "bing_pos",
        "duckduckgo_pos_ru",
        "duckduckgo_pos_en",
        "brave_pos",
        "tavily_target",
        "chatgpt_search_brand",
        "chatgpt_search_target",
        "gemini_app_brand",
        "gemini_app_target",
        "notes",
    ]

    for idx, kw in enumerate(keywords, 1):
        keyword = kw["keyword"]
        page = kw["page"]
        prior = existing_rows.get(keyword, {})
        row = {fn: prior.get(fn, "") for fn in fieldnames}
        if not row.get("duckduckgo_pos_ru") and prior.get("duckduckgo_pos"):
            row["duckduckgo_pos_ru"] = prior["duckduckgo_pos"]
        row["keyword"] = keyword
        row["tier"] = kw.get("tier", prior.get("tier", ""))
        row["page"] = page
        row["wordstat_ws"] = kw.get("wordstat_demand", prior.get("wordstat_ws", ""))
        if not row["notes"]:
            row["notes"] = kw.get("notes", "")

        print(f"[{idx}/17] {keyword}", flush=True)
        entry: dict[str, Any] = {
            "keyword": keyword,
            "page": page,
            "engines": {},
        }

        for engine in engines:
            ddg_runs = ddg_locales if engine == "duckduckgo" else [None]
            for ddg_kl in ddg_runs:
                label = engine if ddg_kl is None else f"{engine} ({ddg_kl})"
                print(f"  → {label}", flush=True)
                if use_local_serpapi():
                    resp = serpapi_search_local(
                        serpapi_key_local, keyword, engine, ddg_kl=ddg_kl
                    )
                else:
                    resp = swoop_serpapi(api_key, keyword, engine, ddg_kl=ddg_kl)
                items = resp.get("items") if isinstance(resp.get("items"), list) else []
                pos, compete = analyze_serp(items, page)
                ok = bool(resp.get("ok")) and resp.get("http") == 200

                engine_key = engine
                if engine == "duckduckgo" and ddg_kl:
                    engine_key = f"duckduckgo_{ddg_locale_suffix(ddg_kl)}"

                entry["engines"][engine_key] = {
                    "ok": ok,
                    "http": resp.get("http"),
                    "position": pos,
                    "competing": compete,
                    "count": len(items),
                    "source": resp.get("source"),
                    "geo": engine_geo(engine, ddg_kl=ddg_kl),
                    "top10": [
                        {"pos": i + 1, "url": x.get("url")}
                        for i, x in enumerate(items[:10])
                        if isinstance(x, dict)
                    ],
                    "organic_results": resp.get("organic_results") if ok else [],
                    "search_metadata": resp.get("search_metadata"),
                    "error": resp.get("error") or resp.get("detail"),
                }

                if engine == "google":
                    row["google_pos"] = pos if ok else row.get("google_pos", "")
                    if ok and row["google_pos"]:
                        filled_google += 1
                elif engine == "yandex":
                    row["yandex_pos"] = pos if ok else row.get("yandex_pos", "")
                    if ok and row["yandex_pos"]:
                        filled_yandex += 1
                elif engine == "bing":
                    # Optional refresh; keep prior Brave snapshot when SerpApi returns empty.
                    if ok and pos and pos != "нет":
                        row["bing_pos"] = pos
                        filled_bing += 1
                elif engine == "duckduckgo" and ddg_kl:
                    suffix = ddg_locale_suffix(ddg_kl)
                    col = f"duckduckgo_pos_{suffix}"
                    row[col] = pos if ok else row.get(col, "")
                    if ok and row[col]:
                        if suffix == "ru":
                            filled_dduck_ru += 1
                        elif suffix == "en":
                            filled_dduck_en += 1

                if compete:
                    row["notes"] = merge_notes(row.get("notes", ""), label, compete)
                if not ok:
                    err = str(resp.get("detail") or resp.get("error") or resp.get("http"))
                    failures.append(f"{keyword}/{label}: {err}")

                time.sleep(SLEEP_SEC)

        serpapi_results.append(entry)
        rows_out.append(row)

    json_root = load_json_root()
    json_root["serpapi_run"] = {
        "run_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "region": (
            "Moscow/RU where supported: Google location=Moscow, Russia gl=ru; "
            "Yandex lr=213; Bing cc=RU mkt=ru-RU; "
            f"DuckDuckGo kl={','.join(ddg_locales) if ddg_locales else 'ru-ru,us-en'}"
        ),
        "engines": engines,
        "duckduckgo_locales": ddg_locales,
        "endpoint": (
            "local serpapi.com via agent-api/swoop_serpapi.py"
            if use_local_serpapi()
            else f"{SWOOP_BASE}/api/v1/web/search/serpapi"
        ),
        "queries": len(keywords) * (
            sum(1 for e in engines if e != "duckduckgo")
            + (len(ddg_locales) if "duckduckgo" in engines else 0)
        ),
        "results": serpapi_results,
        "failures": failures,
    }
    JSON_OUT.write_text(json.dumps(json_root, ensure_ascii=False, indent=2), encoding="utf-8")

    with CSV_OUT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows_out)

    print(
        f"\nDone: google_pos {filled_google}/17, yandex_pos {filled_yandex}/17, "
        f"bing_pos {filled_bing}/17, duckduckgo_pos_ru {filled_dduck_ru}/17, "
        f"duckduckgo_pos_en {filled_dduck_en}/17, failures {len(failures)}",
        flush=True,
    )
    print(f"Wrote {JSON_OUT} and {CSV_OUT}", flush=True)
    if failures:
        print("Failures:", file=sys.stderr)
        for fline in failures[:10]:
            print(f"  - {fline}", file=sys.stderr)


if __name__ == "__main__":
    main()
