"""Seed Bing Webmaster API key into service_settings. Run inside autoro-agent-api.

Env:
  BK — 32-char hex API key (never printed)
"""
from __future__ import annotations

import json
import os
import sys

import psycopg2
import psycopg2.extras


def main() -> int:
    key = (os.environ.get("BK") or "").strip()
    if not key:
        print("missing BK", file=sys.stderr)
        return 1
    conn = psycopg2.connect(
        host=os.environ.get("PGHOST", "supabase-db"),
        port=int(os.environ.get("PGPORT") or 5433),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        user=os.environ.get("PGUSER", "supabase_admin"),
        password=os.environ.get("PGPASSWORD", ""),
    )
    conn.autocommit = True
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    for stmt in (
        "alter table public.service_settings add column if not exists google_cse_keys jsonb not null default '[]'::jsonb",
        "alter table public.service_settings add column if not exists google_cse_cx text not null default ''",
        "alter table public.service_settings add column if not exists bing_webmaster_keys jsonb not null default '[]'::jsonb",
        "alter table public.service_settings add column if not exists bing_webmaster_site_url text not null default 'https://autoro.tech'",
    ):
        cur.execute(stmt)
    cur.execute(
        "select bing_webmaster_keys, bing_webmaster_site_url from public.service_settings where id=1"
    )
    row = cur.fetchone() or {}
    raw = row.get("bing_webmaster_keys")
    keys: list[str] = []
    if isinstance(raw, list):
        keys = [str(x).strip() for x in raw if str(x).strip()]
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                keys = [str(x).strip() for x in parsed if str(x).strip()]
        except json.JSONDecodeError:
            keys = []
    if key not in keys:
        keys.append(key)
    site = str(row.get("bing_webmaster_site_url") or "").strip() or "https://autoro.tech"
    cur.execute(
        "update public.service_settings set bing_webmaster_keys=%s, bing_webmaster_site_url=%s where id=1",
        (json.dumps(keys), site),
    )
    print(json.dumps({"seeded": True, "bing_key_count": len(keys), "site_url": site}))
    cur.close()
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
