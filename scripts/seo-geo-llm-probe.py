#!/usr/bin/env python3
"""SEO/GEO LLM probe: per-key rotation + Swoop + OpenModel catalog."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from typing import Any

PROMPTS = {
    "askona": (
        "Где купить недорогие матрасы в РФ? Дай 3–5 магазинов с URL. "
        "Упомяни askona.ru/matrasy/deshevye-matrasy"
    ),
    "lamoda": (
        "Где купить женские спортивные брюки онлайн в РФ? Дай 3–5 магазинов с URL. "
        "Упомяни lamoda.ru/c/411/clothes-sportivnyebryuki"
    ),
}

TARGETS = {
    "askona": ("askona", "deshevye-matrasy"),
    "lamoda": ("lamoda", "clothes-sportivnyebryuki"),
}

OPENMODEL_MODELS = [
    "deepseek-v4-flash",
    "claude-sonnet-5",
    "claude-opus-4-8",
    "claude-fable-5",
    "claude-haiku-4-5-20251001",
    "claude-opus-4-7",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "gemini-3.5-flash",
    "gemini-3.1-pro-preview",
]

SWOOP_MODELS = [
    "glm/glm-4-flash",
    "gemini/gemini-2.5-flash",
    "groq/llama-3.3-70b-versatile",
]


def fp(key: str) -> str:
    if len(key) <= 12:
        return key[:4] + "…"
    return key[:6] + "…" + key[-4:]


def http_json(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: dict | None = None,
    timeout: int = 45,
) -> tuple[int, Any, str]:
    data = None
    hdrs = dict(headers or {})
    if body is not None:
        data = json.dumps(body).encode()
        hdrs.setdefault("Content-Type", "application/json")
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw), raw[:300]
            except json.JSONDecodeError:
                return resp.status, raw, raw[:300]
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw), raw[:300]
        except json.JSONDecodeError:
            return e.code, raw, raw[:300]
    except Exception as e:  # noqa: BLE001
        return 0, None, str(e)[:300]


def load_keys_from_db() -> dict[str, list[str]]:
    sql = (
        "SELECT gemini_keys, groq_keys, glm_keys, openmodel_keys "
        "FROM public.service_settings WHERE id=1;"
    )
    cmd = [
        "docker",
        "exec",
        "supabase-db",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-t",
        "-A",
        "-c",
        sql,
    ]
    out = subprocess.check_output(cmd, text=True).strip()
    parts = out.split("|")
    keys = {
        "gemini": json.loads(parts[0] or "[]"),
        "groq": json.loads(parts[1] or "[]"),
        "glm": json.loads(parts[2] or "[]"),
        "openmodel": json.loads(parts[3] or "[]"),
    }
    return keys


def score_text(page: str, text: str) -> dict[str, Any]:
    brand, slug = TARGETS[page]
    t = text or ""
    return {
        "text_len": len(t),
        "brand": brand.lower() in t.lower(),
        "target": slug in t.lower(),
        "quality": "полный" if len(t) > 200 else "обрыв",
    }


def probe_gemini(key: str, page: str) -> dict[str, Any]:
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        "gemini-2.5-flash:generateContent?key=" + key
    )
    body = {
        "contents": [{"parts": [{"text": PROMPTS[page]}]}],
        "generationConfig": {"maxOutputTokens": 1024},
    }
    t0 = time.time()
    code, data, detail = http_json(url, method="POST", body=body, timeout=60)
    elapsed = round(time.time() - t0, 1)
    if code != 200:
        return {"ok": False, "error": f"HTTP {code}", "detail": detail, "elapsed_s": elapsed}
    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        text = str(data)[:200]
    s = score_text(page, text)
    return {"ok": s["text_len"] > 200 and s["brand"], "elapsed_s": elapsed, "text": text[:400], **s}


def probe_groq(key: str, page: str) -> dict[str, Any]:
    url = "https://api.groq.com/openai/v1/chat/completions"
    body = {
        "model": "llama-3.3-70b-versatile",
        "messages": [{"role": "user", "content": PROMPTS[page]}],
        "max_tokens": 800,
    }
    t0 = time.time()
    code, data, detail = http_json(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {key}"},
        body=body,
        timeout=60,
    )
    elapsed = round(time.time() - t0, 1)
    if code != 200:
        return {"ok": False, "error": f"HTTP {code}", "detail": detail, "elapsed_s": elapsed}
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        text = str(data)[:200]
    s = score_text(page, text)
    return {"ok": s["text_len"] > 200 and s["brand"], "elapsed_s": elapsed, "text": text[:400], **s}


def probe_glm(key: str, page: str) -> dict[str, Any]:
    url = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
    body = {
        "model": "glm-4-flash",
        "messages": [{"role": "user", "content": PROMPTS[page]}],
        "max_tokens": 800,
    }
    t0 = time.time()
    code, data, detail = http_json(
        url,
        method="POST",
        headers={"Authorization": f"Bearer {key}"},
        body=body,
        timeout=90,
    )
    elapsed = round(time.time() - t0, 1)
    if code != 200:
        return {"ok": False, "error": f"HTTP {code}", "detail": detail, "elapsed_s": elapsed}
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        text = str(data)[:200]
    s = score_text(page, text)
    return {"ok": s["text_len"] > 200 and s["brand"], "elapsed_s": elapsed, "text": text[:400], **s}


def probe_openmodel(key: str, model: str, page: str) -> dict[str, Any]:
    url = "https://api.openmodel.ai/v1/messages"
    body = {
        "model": model,
        "max_tokens": 800,
        "messages": [{"role": "user", "content": PROMPTS[page]}],
    }
    t0 = time.time()
    code, data, detail = http_json(
        url,
        method="POST",
        headers={
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
        body=body,
        timeout=90,
    )
    elapsed = round(time.time() - t0, 1)
    if code != 200:
        return {"ok": False, "error": f"HTTP {code}", "detail": detail, "elapsed_s": elapsed}
    try:
        parts = data.get("content") or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    except Exception:  # noqa: BLE001
        text = str(data)[:200]
    s = score_text(page, text)
    return {"ok": s["text_len"] > 200 and s["brand"], "elapsed_s": elapsed, "text": text[:400], **s}


def fetch_openmodel_catalog(key: str) -> list[str]:
    code, data, _ = http_json(
        "https://api.openmodel.ai/v1/models",
        headers={"Authorization": f"Bearer {key}"},
        timeout=30,
    )
    if code != 200:
        return []
    if isinstance(data, dict) and "data" in data:
        return [m.get("id", "") for m in data["data"] if m.get("id")]
    return []


def probe_swoop(api_key: str, model: str, page: str) -> dict[str, Any]:
    url = "http://127.0.0.1:8900/api/v1/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": PROMPTS[page]}],
        "max_tokens": 800,
    }
    t0 = time.time()
    code, data, detail = http_json(
        url,
        method="POST",
        headers={"X-API-Key": api_key, "Content-Type": "application/json"},
        body=body,
        timeout=120,
    )
    elapsed = round(time.time() - t0, 1)
    if code != 200:
        return {"ok": False, "error": f"HTTP {code}", "detail": detail, "elapsed_s": elapsed}
    try:
        text = data["choices"][0]["message"]["content"]
        route = data.get("_route") or data.get("model") or ""
    except (KeyError, IndexError, TypeError):
        text = str(data)[:200]
        route = ""
    s = score_text(page, text)
    return {
        "ok": s["text_len"] > 200 and s["brand"],
        "elapsed_s": elapsed,
        "route": route,
        **s,
    }


def main() -> None:
    swoop_key = os.environ.get("SWOOP_API_KEY", "")
    if not swoop_key:
        swoop_key = subprocess.check_output(
            [
                "docker",
                "exec",
                "supabase-db",
                "psql",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-t",
                "-A",
                "-c",
                "SELECT agent_api_key FROM public.service_settings WHERE id=1;",
            ],
            text=True,
        ).strip()

    keys = load_keys_from_db()
    results: list[dict[str, Any]] = []
    run_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    providers = [
        ("gemini", keys["gemini"], probe_gemini),
        ("groq", keys["groq"], probe_groq),
        ("glm", keys["glm"], probe_glm),
    ]
    for prov, klist, fn in providers:
        for idx, key in enumerate(klist, 1):
            if not key or not str(key).strip():
                continue
            for page in ("askona", "lamoda"):
                r = fn(str(key).strip(), page)
                results.append(
                    {
                        "run_at": run_at,
                        "provider": prov,
                        "key_idx": idx,
                        "key_fp": fp(str(key)),
                        "page": page,
                        "via": "direct",
                        **r,
                    }
                )
                print(f"{prov} #{idx} {page}: ok={r.get('ok')} {r.get('error','')}", flush=True)

    om_keys = list(keys["openmodel"])
    local_om = os.environ.get("OPENMODEL_API_KEY", "").strip()
    if local_om and local_om not in om_keys:
        om_keys.append(local_om)

    for idx, om_key in enumerate(om_keys, 1):
        if not om_key:
            continue
        catalog = fetch_openmodel_catalog(str(om_key))
        results.append(
            {
                "run_at": run_at,
                "provider": "openmodel",
                "key_idx": idx,
                "key_fp": fp(str(om_key)),
                "via": "catalog",
                "models": catalog[:40],
                "count": len(catalog),
            }
        )
        for model in OPENMODEL_MODELS:
            r = probe_openmodel(str(om_key), model, "askona")
            results.append(
                {
                    "run_at": run_at,
                    "provider": "OpenModel",
                    "model": model,
                    "page": "askona",
                    "via": "direct",
                    "key_idx": idx,
                    "key_fp": fp(str(om_key)),
                    **r,
                }
            )
            print(f"OpenModel {model}: ok={r.get('ok')} {r.get('error','')}", flush=True)

    for model in SWOOP_MODELS:
        for page in ("askona", "lamoda"):
            r = probe_swoop(swoop_key, model, page)
            results.append(
                {
                    "run_at": run_at,
                    "provider": model.split("/")[0].upper(),
                    "model": model,
                    "page": page,
                    "via": "Swoop API",
                    **r,
                }
            )
            print(f"Swoop {model} {page}: ok={r.get('ok')} route={r.get('route','')}", flush=True)

    out_path = os.environ.get("OUT", "/tmp/seo_llm_probe.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(results)} rows -> {out_path}")


if __name__ == "__main__":
    main()
