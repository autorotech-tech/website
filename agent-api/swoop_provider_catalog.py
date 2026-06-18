"""
Live provider model catalogs + tier-aware model resolution for agent-api.
DeerFlow sync reuses collect_live_provider_models (deploy copy of this module).
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen

logger = logging.getLogger("autoro-agent-api")


def _catalog_msg(fmt: str, *args: Any) -> None:
    msg = fmt % args if args else fmt
    logger.info(msg)
    print(msg, flush=True)


MAX_MODELS_PER_PROVIDER = 20
HTTP_TIMEOUT = 25
_CATALOG_CACHE_TTL_SEC = 900.0
_CATALOG_CACHE: Dict[str, Any] = {"ts": 0.0, "catalogs": None}
_OPENROUTER_META_CACHE_TTL_SEC = float(os.environ.get("OPENROUTER_META_CACHE_TTL_SEC", "86400"))
_OPENROUTER_META_CACHE: Dict[str, Any] = {"ts": 0.0, "models": None}
OPENROUTER_CATALOG_REFRESH_SEC = float(os.environ.get("OPENROUTER_CATALOG_REFRESH_SEC", "21600"))

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
GROQ_BASE = "https://api.groq.com/openai/v1"
GLM_BASE = "https://open.bigmodel.cn/api/paas/v4"

_GEMINI_SKIP = re.compile(
    r"(embed|embedding|aqa|imagen|tts|native-audio|live|computer-use|robotics|nano-banana|deep-research)",
    re.I,
)
_OPENAI_CHAT_PREFIXES = ("gpt-", "o1", "o3", "o4", "chatgpt")
_GLM_FALLBACK_MODELS = [
    "glm-5.1",
    "glm-4.7",
    "glm-4.7-flash",
    "glm-4.6",
    "glm-4-flash",
    "glm-4v-flash",
    "glm-4v-plus",
    "glm-4-plus",
    "glm-4-air",
    "glm-4-long",
]

_PROVIDER_ENV_FALLBACK: Dict[str, Tuple[str, str]] = {
    "gemini": ("BOOKMARKS_GEMINI_CHAT_MODEL", "gemini-3.5-flash"),
    "glm": ("BOOKMARKS_GLM_CHAT_MODEL", "glm-4.7"),
    "groq": ("BOOKMARKS_GROQ_CHAT_MODEL", "llama-3.3-70b-versatile"),
    "openai": ("BOOKMARKS_AI_MODEL", "gpt-4o-mini"),
}

_TIER_POSITIVE: Dict[str, Tuple[str, ...]] = {
    "fast": (r"flash", r"mini", r"haiku", r"instant", r"lite", r"-8b", r"small", r"turbo"),
    "reasoning": (r"pro", r"opus", r"\bo1", r"\bo3", r"\bo4", r"thinking", r"reason", r"plus", r"glm-5", r"glm-4\.7"),
    "code": (r"code", r"codex", r"devstral", r"coder", r"deepseek"),
    "vision": (r"vision", r"4v", r"gpt-4o", r"scout", r"multimodal", r"llama-4"),
    "general": (r"flash", r"gpt-4o", r"gemini-\d"),
}

_TIER_NEGATIVE: Dict[str, Tuple[str, ...]] = {
    "fast": (r"pro", r"opus", r"\bo1", r"\bo3", r"preview", r"image", r"embed", r"deep-research"),
    "reasoning": (r"mini", r"haiku", r"embed", r"whisper"),
    "code": (r"embed", r"whisper", r"tts"),
    "vision": (r"embed", r"whisper", r"tts", r"instruct"),
    "general": (r"embed", r"whisper", r"tts", r"deep-research"),
}


def _first_key(keys: Any) -> str:
    if not isinstance(keys, list):
        return ""
    for item in keys:
        s = str(item or "").strip()
        if s:
            return s
    return ""


def _http_get_json(url: str, headers: Optional[Dict[str, str]] = None) -> Tuple[int, Any]:
    req = Request(url, headers=headers or {}, method="GET")
    try:
        with urlopen(req, timeout=HTTP_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            code = int(resp.getcode() or 200)
            try:
                return code, json.loads(raw)
            except json.JSONDecodeError:
                return code, None
    except HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return int(exc.code), json.loads(raw)
        except json.JSONDecodeError:
            return int(exc.code), None
    except Exception:
        return -1, None


def _version_sort_key(model_id: str) -> Tuple[int, ...]:
    nums = [int(x) for x in re.findall(r"\d+", model_id)]
    return tuple(nums or [0])


def _gemini_sort_key(model_id: str) -> Tuple[int, Tuple[int, ...], str]:
    core = bool(re.match(r"^gemini-\d+\.\d+(-flash|-pro)?$", model_id))
    preview_penalty = 1 if ("preview" in model_id or "experimental" in model_id) else 0
    image_penalty = 1 if "image" in model_id else 0
    tier = 1 if core and not preview_penalty and not image_penalty else 0
    return (tier, _version_sort_key(model_id), model_id)


def _dedupe_keep_order(items: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for item in items:
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def fetch_gemini_models(api_key: str) -> List[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    code, body = _http_get_json(
        f"https://generativelanguage.googleapis.com/v1beta/models?key={key}"
    )
    if code != 200 or not isinstance(body, dict):
        return []
    models: List[str] = []
    for item in body.get("models") or []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        mid = name.replace("models/", "", 1) if name.startswith("models/") else name
        if not mid or _GEMINI_SKIP.search(mid):
            continue
        methods = item.get("supportedGenerationMethods") or []
        if "generateContent" not in methods:
            continue
        models.append(mid)
    models.sort(key=_gemini_sort_key, reverse=True)
    return models[:MAX_MODELS_PER_PROVIDER]


def _openrouter_item_is_chat_model(item: Dict[str, Any]) -> bool:
    mid = str(item.get("id") or "").strip()
    if not mid:
        return False
    arch = item.get("architecture") if isinstance(item.get("architecture"), dict) else {}
    outputs = arch.get("output_modalities") if isinstance(arch.get("output_modalities"), list) else []
    if outputs and "text" not in outputs:
        return False
    if any(x in mid.lower() for x in ("embed", "moderation", "whisper", "dall-e")):
        return False
    return True


def _is_free_openrouter_model(meta: Dict[str, Any]) -> bool:
    mid = str(meta.get("id") or "").lower()
    if ":free" in mid or mid.endswith("/free"):
        return True
    pricing = meta.get("pricing") if isinstance(meta.get("pricing"), dict) else {}
    try:
        prompt = float(pricing.get("prompt") or 0)
        completion = float(pricing.get("completion") or 0)
        return prompt == 0 and completion == 0
    except (TypeError, ValueError):
        return False


def _parse_openrouter_model_meta(item: Dict[str, Any]) -> Dict[str, Any]:
    mid = str(item.get("id") or "").strip()
    pricing_raw = item.get("pricing") if isinstance(item.get("pricing"), dict) else {}
    meta = {
        "id": mid,
        "name": str(item.get("name") or mid),
        "description": str(item.get("description") or "")[:280],
        "context_length": int(item.get("context_length") or 0),
        "pricing": {
            "prompt": str(pricing_raw.get("prompt") or "0"),
            "completion": str(pricing_raw.get("completion") or "0"),
        },
        "created": int(item.get("created") or 0),
    }
    meta["is_free"] = _is_free_openrouter_model(meta)
    return meta


def fetch_openrouter_catalog_meta(api_key: str = "") -> List[Dict[str, Any]]:
    """Полный каталог OpenRouter (публичный /models; ключ опционален)."""
    headers: Dict[str, str] = {"Accept": "application/json"}
    key = (api_key or "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    code, body = _http_get_json(f"{OPENROUTER_BASE}/models", headers=headers)
    if code != 200 or not isinstance(body, dict):
        return []
    ranked: List[Tuple[int, Dict[str, Any]]] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict) or not _openrouter_item_is_chat_model(item):
            continue
        meta = _parse_openrouter_model_meta(item)
        ranked.append((int(meta.get("created") or 0), meta))
    ranked.sort(key=lambda x: (x[0], str(x[1].get("id") or "")), reverse=True)
    return [meta for _, meta in ranked]


def get_cached_openrouter_meta(settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    now = time.monotonic()
    cached = _OPENROUTER_META_CACHE.get("models")
    if cached is not None and (now - float(_OPENROUTER_META_CACHE.get("ts") or 0)) < _OPENROUTER_META_CACHE_TTL_SEC:
        return cached
    api_key = ""
    if settings:
        api_key = _first_key(settings.get("openrouter_keys")) or _first_key(settings.get("openrouter_qwen_keys"))
    try:
        models = fetch_openrouter_catalog_meta(api_key)
    except Exception as exc:
        logger.warning("fetch_openrouter_catalog_meta failed: %s", exc)
        models = list(cached or [])
    _OPENROUTER_META_CACHE["ts"] = now
    _OPENROUTER_META_CACHE["models"] = models
    return models


def invalidate_openrouter_meta_cache() -> None:
    _OPENROUTER_META_CACHE["ts"] = 0.0
    _OPENROUTER_META_CACHE["models"] = None


def invalidate_provider_catalog_cache() -> None:
    _CATALOG_CACHE["ts"] = 0.0
    _CATALOG_CACHE["catalogs"] = None


def refresh_openrouter_catalog(settings: Optional[Dict[str, Any]] = None) -> Dict[str, int]:
    """Принудительно обновить кэш OpenRouter + live provider catalogs."""
    invalidate_openrouter_meta_cache()
    invalidate_provider_catalog_cache()
    if settings is None:
        settings = {}
    models = get_cached_openrouter_meta(settings)
    try:
        get_cached_provider_catalogs(settings)
    except Exception as exc:
        logger.warning("refresh provider catalogs failed: %s", exc)
    free_total = sum(1 for m in models if m.get("is_free"))
    return {"total": len(models), "free_total": free_total}


def search_openrouter_models(
    models: List[Dict[str, Any]],
    query: str,
    *,
    limit: int = 50,
    free_only: bool = False,
) -> List[Dict[str, Any]]:
    pool = [m for m in models if m.get("is_free")] if free_only else models
    q = (query or "").strip().lower()
    if not q:
        return pool[: max(1, limit)]
    out: List[Dict[str, Any]] = []
    for item in pool:
        mid = str(item.get("id") or "").lower()
        name = str(item.get("name") or "").lower()
        if q in mid or q in name:
            out.append(item)
            if len(out) >= limit:
                break
    return out


def format_openrouter_price(per_token: str) -> str:
    try:
        value = float(per_token)
    except (TypeError, ValueError):
        return "?"
    if value == 0:
        return "Free"
    per_million = value * 1_000_000
    if per_million < 0.01:
        return "<$0.01"
    if per_million < 1:
        return f"${per_million:.2f}"
    return f"${per_million:.0f}" if per_million >= 10 else f"${per_million:.2f}"


def format_openrouter_context(length: int) -> str:
    if length >= 1_000_000:
        return f"{length / 1_000_000:.1f}M"
    if length >= 1000:
        return f"{round(length / 1000)}K"
    return str(length or "?")


def fetch_openrouter_models(api_key: str) -> List[str]:
    meta = fetch_openrouter_catalog_meta(api_key)
    return [str(m.get("id") or "").strip() for m in meta if m.get("id")][:MAX_MODELS_PER_PROVIDER]


def fetch_groq_models(api_key: str) -> List[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    code, body = _http_get_json(
        f"{GROQ_BASE}/models",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    if code != 200 or not isinstance(body, dict):
        return []
    models: List[str] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if mid:
            models.append(mid)
    models.sort(reverse=True)
    return models[:MAX_MODELS_PER_PROVIDER]


def fetch_openai_models(api_key: str) -> List[str]:
    key = (api_key or "").strip()
    if not key:
        return []
    code, body = _http_get_json(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    if code != 200 or not isinstance(body, dict):
        return []
    models: List[str] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if not mid:
            continue
        if not any(mid.startswith(p) for p in _OPENAI_CHAT_PREFIXES):
            continue
        if any(x in mid for x in ("instruct", "realtime", "audio", "transcribe", "search")):
            continue
        models.append(mid)
    models.sort(reverse=True)
    return models[:MAX_MODELS_PER_PROVIDER]


def fetch_glm_models(api_key: str) -> List[str]:
    key = (api_key or "").strip()
    if key:
        code, body = _http_get_json(
            f"{GLM_BASE}/models",
            headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
        )
        if code == 200 and isinstance(body, dict):
            data = body.get("data")
            if isinstance(data, list) and data:
                models: List[str] = []
                for item in data:
                    if isinstance(item, dict):
                        mid = str(item.get("id") or "").strip()
                    else:
                        mid = str(item or "").strip()
                    if mid and mid.startswith("glm"):
                        models.append(mid)
                if models:
                    models.sort(key=lambda m: (_version_sort_key(m), m), reverse=True)
                    return models[:MAX_MODELS_PER_PROVIDER]
    return list(_GLM_FALLBACK_MODELS)


def fetch_lmarena_models(api_key: str, base_url: str) -> List[str]:
    key = (api_key or "").strip()
    base = (base_url or "").strip().rstrip("/") or "http://127.0.0.1:8000/api/v1"
    if not key:
        return []
    code, body = _http_get_json(
        f"{base}/models",
        headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    if code != 200 or not isinstance(body, dict):
        return []
    models: List[str] = []
    for item in body.get("data") or []:
        if not isinstance(item, dict):
            continue
        mid = str(item.get("id") or "").strip()
        if mid:
            models.append(mid)
    models.sort(reverse=True)
    return models[:MAX_MODELS_PER_PROVIDER]


def _catalog_vals_from_swoop_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "GEMINI": list(settings.get("gemini_keys") or []),
        "OPENROUTER": list(settings.get("openrouter_keys") or []),
        "OPENROUTER_QWEN": list(settings.get("openrouter_qwen_keys") or []),
        "OPENROUTER_QWEN_MODEL": str(settings.get("openrouter_qwen_model") or "").strip(),
        "GROQ": list(settings.get("groq_keys") or []),
        "GLM": list(settings.get("glm_keys") or []),
        "OPENAI": list(settings.get("openai_keys") or []),
        "LMARENA": list(settings.get("lmarena_keys") or []),
        "LMARENA_BASE": str(settings.get("lmarena_base_url") or "").strip(),
    }


def collect_live_provider_models(vals: Dict[str, Any]) -> Dict[str, List[str]]:
    """provider -> model ids from live APIs (DeerFlow sync + agent-api)."""
    out: Dict[str, List[str]] = {}

    gemini_key = _first_key(vals.get("GEMINI"))
    if gemini_key:
        live = fetch_gemini_models(gemini_key)
        if live:
            out["gemini"] = live
            _catalog_msg("catalog: gemini %s models (e.g. %s)", len(live), live[0])

    or_key = _first_key(vals.get("OPENROUTER"))
    if or_key:
        live = fetch_openrouter_models(or_key)
        if live:
            out["openrouter"] = live
            _catalog_msg("catalog: openrouter %s models (e.g. %s)", len(live), live[0])

    qwen_key = _first_key(vals.get("OPENROUTER_QWEN"))
    qwen_model = str(vals.get("OPENROUTER_QWEN_MODEL") or "").strip()
    if qwen_key or or_key:
        pool_key = qwen_key or or_key
        live = fetch_openrouter_models(pool_key)
        qwen_live = [m for m in live if m.startswith("qwen/") or (qwen_model and m == qwen_model)]
        if qwen_model and qwen_model not in qwen_live:
            qwen_live.insert(0, qwen_model)
        if qwen_live:
            out["openrouter_qwen"] = _dedupe_keep_order(qwen_live)[:MAX_MODELS_PER_PROVIDER]
            _catalog_msg("catalog: openrouter_qwen %s models", len(out["openrouter_qwen"]))

    groq_key = _first_key(vals.get("GROQ"))
    if groq_key:
        live = fetch_groq_models(groq_key)
        if live:
            out["groq"] = live
            _catalog_msg("catalog: groq %s models (e.g. %s)", len(live), live[0])

    glm_key = _first_key(vals.get("GLM"))
    if glm_key:
        live = fetch_glm_models(glm_key)
        if live:
            out["glm"] = live
            _catalog_msg("catalog: glm %s models (e.g. %s)", len(live), live[0])

    openai_key = _first_key(vals.get("OPENAI"))
    if openai_key:
        live = fetch_openai_models(openai_key)
        if live:
            out["openai"] = live
            _catalog_msg("catalog: openai %s models (e.g. %s)", len(live), live[0])

    lm_key = _first_key(vals.get("LMARENA"))
    if lm_key:
        live = fetch_lmarena_models(lm_key, str(vals.get("LMARENA_BASE") or ""))
        if live:
            out["lmarena"] = live
            _catalog_msg("catalog: lmarena %s models (e.g. %s)", len(live), live[0])

    return out


def fetch_provider_catalogs(settings: Dict[str, Any]) -> Dict[str, List[str]]:
    vals = _catalog_vals_from_swoop_settings(settings)
    legacy_gemini = str(settings.get("gemini_api_key") or "").strip()
    if legacy_gemini and not vals.get("GEMINI"):
        vals["GEMINI"] = [legacy_gemini]
    return collect_live_provider_models(vals)


def get_cached_provider_catalogs(settings: Dict[str, Any]) -> Dict[str, List[str]]:
    now = time.monotonic()
    cached = _CATALOG_CACHE.get("catalogs")
    if cached is not None and (now - float(_CATALOG_CACHE.get("ts") or 0)) < _CATALOG_CACHE_TTL_SEC:
        return cached
    try:
        catalogs = fetch_provider_catalogs(settings)
    except Exception as exc:
        logger.warning("fetch_provider_catalogs failed: %s", exc)
        catalogs = {}
    _CATALOG_CACHE["ts"] = now
    _CATALOG_CACHE["catalogs"] = catalogs
    return catalogs


def _score_model_for_tier(model_id: str, tier: str, provider: str) -> int:
    mid = (model_id or "").strip().lower()
    if not mid:
        return -999
    score = sum(_version_sort_key(mid))
    pos = _TIER_POSITIVE.get(tier, _TIER_POSITIVE["general"])
    neg = _TIER_NEGATIVE.get(tier, _TIER_NEGATIVE["general"])
    for pat in pos:
        if re.search(pat, mid):
            score += 50
    for pat in neg:
        if re.search(pat, mid):
            score -= 30
    if tier == "vision" and provider == "glm" and "4v" in mid:
        score += 80
    if tier == "fast" and provider == "groq" and "llama" in mid:
        score += 20
    if tier == "reasoning" and provider == "openrouter" and any(x in mid for x in ("claude", "opus", "o3", "gemini-3")):
        score += 25
    return score


def pick_models_for_tier(
    catalog: List[str],
    tier: str,
    provider: str,
    *,
    limit: int = 1,
) -> List[str]:
    if not catalog:
        return []
    ranked = sorted(
        catalog,
        key=lambda m: (_score_model_for_tier(m, tier, provider), m),
        reverse=True,
    )
    out: List[str] = []
    for model in ranked:
        if model not in out:
            out.append(model)
        if len(out) >= max(1, limit):
            break
    return out


def pick_model_for_tier(catalog: List[str], tier: str, provider: str) -> str:
    picked = pick_models_for_tier(catalog, tier, provider, limit=1)
    return picked[0] if picked else ""


def _static_fallback(provider: str, settings: Dict[str, Any]) -> str:
    prov = provider.lower()
    if prov == "openrouter":
        return str(settings.get("openrouter_default_model") or "").strip() or "openai/gpt-4o-mini"
    if prov == "openrouter-qwen":
        return str(settings.get("openrouter_qwen_model") or "").strip() or "qwen/qwen3.6-plus-preview:free"
    if prov == "lmarena":
        return str(settings.get("lmarena_default_model") or "").strip()
    env_key, default = _PROVIDER_ENV_FALLBACK.get(prov, ("", ""))
    if env_key:
        return os.environ.get(env_key, default).strip() or default
    return default


def resolve_model_for_provider(
    provider: str,
    tier: str,
    explicit_model: str,
    settings: Dict[str, Any],
    *,
    catalogs: Optional[Dict[str, List[str]]] = None,
) -> str:
    explicit = (explicit_model or "").strip()
    if explicit:
        return explicit
    prov = str(provider or "").strip().lower()
    tier_norm = (tier or "general").strip().lower()
    if tier_norm not in _TIER_POSITIVE:
        tier_norm = "general"

    routing = settings.get("agent_llm_routing")
    if isinstance(routing, dict):
        tier_models = routing.get("tier_models")
        if isinstance(tier_models, dict):
            cat_key_early = prov
            if prov == "openrouter-qwen":
                cat_key_early = "openrouter_qwen"
            prov_map = tier_models.get(prov) or tier_models.get(cat_key_early)
            if isinstance(prov_map, dict):
                pinned = str(prov_map.get(tier_norm) or "").strip()
                if pinned:
                    logger.debug(
                        "resolved model tier=%s provider=%s -> %s (tier_models)",
                        tier_norm,
                        prov,
                        pinned,
                    )
                    return pinned

    cats = catalogs if catalogs is not None else get_cached_provider_catalogs(settings)
    cat_key = prov
    if prov == "openrouter-qwen":
        cat_key = "openrouter_qwen"
    catalog = list(cats.get(cat_key) or [])

    if prov == "openrouter" and tier_norm == "vision":
        vision_or = [m for m in (cats.get("openrouter") or []) if re.search(r"gemini|gpt-4o|vision|4v", m, re.I)]
        if vision_or:
            catalog = vision_or + catalog

    picked = pick_model_for_tier(catalog, tier_norm, prov)
    if picked:
        logger.debug("resolved model tier=%s provider=%s -> %s (catalog)", tier_norm, prov, picked)
        return picked

    fallback = _static_fallback(prov, settings)
    if fallback:
        logger.debug("resolved model tier=%s provider=%s -> %s (fallback)", tier_norm, prov, fallback)
        return fallback

    if catalog:
        return catalog[0]
    return ""


def _owned_by_for_model(model_id: str, provider: str) -> str:
    mid = model_id.lower()
    if "/" in model_id:
        return model_id.split("/", 1)[0]
    if mid.startswith("glm"):
        return "glm"
    if mid.startswith("gemini"):
        return "gemini"
    if mid.startswith("llama") or mid.startswith("meta-"):
        return "groq"
    if mid.startswith("gpt-") or mid.startswith("o1") or mid.startswith("o3") or mid.startswith("o4"):
        return "openai"
    return provider or "swoop"


def build_openai_models_list(settings: Dict[str, Any]) -> List[Dict[str, Any]]:
    """OpenAI-compatible /v1/models payload from live catalogs."""
    catalogs = get_cached_provider_catalogs(settings)
    created = int(time.time())
    out: List[Dict[str, Any]] = [
        {"id": "routed-model", "object": "model", "created": created, "owned_by": "swoop"},
    ]
    seen: set[str] = set()
    for provider, models in catalogs.items():
        for mid in models:
            if not mid or mid in seen:
                continue
            seen.add(mid)
            out.append(
                {
                    "id": mid,
                    "object": "model",
                    "created": created,
                    "owned_by": _owned_by_for_model(mid, provider),
                }
            )
    pinned = [
        str(settings.get("openrouter_default_model") or "").strip(),
        str(settings.get("openrouter_qwen_model") or "").strip(),
        str(settings.get("lmarena_default_model") or "").strip(),
    ]
    for mid in pinned:
        if mid and mid not in seen:
            seen.add(mid)
            out.append({"id": mid, "object": "model", "created": created, "owned_by": "swoop"})
    return out
