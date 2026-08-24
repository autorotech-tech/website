"""
Медиа-возможности для Hermes: vision/OCR, разбор постов по URL, транскрипция аудио/видео.
Ключи LLM — из Swoop (load_swoop_llm_key_settings), как у остального agent-api.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from html import unescape
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

logger = logging.getLogger("autoro-agent-api")

_MAX_DOWNLOAD_BYTES = 24 * 1024 * 1024
_USER_AGENT = "AutoroAgentAPI/1.0 (+https://autoro.tech)"

# Провайдеры, поддерживающие multimodal (image_url в messages).
_VISION_PROVIDERS = frozenset({"glm", "gemini", "openrouter", "openai", "groq"})

_VISION_FALLBACK_LIMIT = 3


def _http_get(url: str, timeout: int = 45, max_bytes: Optional[int] = None) -> Tuple[bytes, str, int]:
    cap = max_bytes if max_bytes is not None else _MAX_DOWNLOAD_BYTES
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = str(resp.headers.get("Content-Type") or "")
            chunks: List[bytes] = []
            total = 0
            while True:
                part = resp.read(65536)
                if not part:
                    break
                total += len(part)
                if total > cap:
                    raise ValueError(f"Download exceeds {cap} bytes")
                chunks.append(part)
            return b"".join(chunks), ctype, int(getattr(resp, "status", 200) or 200)
    except urllib.error.HTTPError as e:
        body = e.read()[:500].decode("utf-8", errors="replace")
        raise ValueError(f"HTTP {e.code}: {body}") from e
    except Exception as exc:
        raise ValueError(str(exc)) from exc


def _detect_social_platform(url: str) -> str:
    host = (urlparse(url).netloc or "").lower().replace("www.", "")
    if not host:
        return "unknown"
    rules = (
        ("instagram", ("instagram.com",)),
        ("tiktok", ("tiktok.com",)),
        ("youtube", ("youtube.com", "youtu.be")),
        ("twitter", ("twitter.com", "x.com")),
        ("facebook", ("facebook.com", "fb.com")),
        ("vk", ("vk.com",)),
        ("telegram", ("t.me", "telegram.me")),
        ("linkedin", ("linkedin.com",)),
        ("threads", ("threads.net",)),
    )
    for name, hosts in rules:
        if any(h in host for h in hosts):
            return name
    return "web"


def _extract_og_meta(html: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for prop, key in (
        (r'property=["\']og:title["\'][^>]*content=["\']([^"\']+)', "title"),
        (r'property=["\']og:description["\'][^>]*content=["\']([^"\']+)', "description"),
        (r'name=["\']description["\'][^>]*content=["\']([^"\']+)', "description"),
        (r'property=["\']og:image["\'][^>]*content=["\']([^"\']+)', "image"),
        (r'property=["\']og:url["\'][^>]*content=["\']([^"\']+)', "canonical"),
    ):
        m = re.search(prop, html, re.I | re.S)
        if m and key not in out:
            out[key] = unescape(m.group(1).strip())
    if "title" not in out:
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
        if m:
            out["title"] = unescape(m.group(1).strip())
    return out


def social_parse_post_url(url: str) -> Dict[str, Any]:
    raw = (url or "").strip()
    if not raw.startswith(("http://", "https://")):
        return {"ok": False, "error": "url must start with http:// or https://"}
    platform = _detect_social_platform(raw)
    try:
        body, ctype, code = _http_get(raw, timeout=40, max_bytes=2 * 1024 * 1024)
    except ValueError as exc:
        return {"ok": False, "url": raw, "platform": platform, "error": str(exc)}
    text = body.decode("utf-8", errors="replace") if "text/html" in ctype or body[:15].lower().startswith(b"<!doctype") else ""
    meta = _extract_og_meta(text) if text else {}
    snippet = ""
    if text and not meta.get("description"):
        plain = re.sub(r"<[^>]+>", " ", text)
        plain = re.sub(r"\s+", " ", plain).strip()
        snippet = plain[:1200]
    return {
        "ok": True,
        "url": raw,
        "platform": platform,
        "httpStatus": code,
        "title": meta.get("title") or "",
        "description": meta.get("description") or snippet[:800],
        "image": meta.get("image") or "",
        "canonical": meta.get("canonical") or raw,
        "note": (
            "Базовый разбор (Open Graph / HTML). Для закрытых лент Instagram/TikTok "
            "нужен Apify-актор или авторизованный скрапинг — уточни у пользователя ссылку."
            if platform in {"instagram", "tiktok", "facebook"} and not meta.get("title")
            else ""
        ),
    }


def _vision_messages(task: str, image_url: Optional[str], image_b64: Optional[str]) -> List[Dict[str, Any]]:
    instruction = (task or "").strip() or (
        "Сначала OCR: дословно весь видимый текст (подписи, URL, списки, имена). "
        "Затем 1–2 предложения — что изображено. "
        "Не выдумывай UI, файлы, репозитории или ссылки, которых нет на картинке. "
        "Ответ на языке пользователя."
    )
    parts: List[Dict[str, Any]] = [{"type": "text", "text": instruction}]
    if image_url:
        parts.append({"type": "image_url", "image_url": {"url": image_url.strip()}})
    elif image_b64:
        raw = image_b64.strip()
        if raw.startswith("data:"):
            data_url = raw
        else:
            data_url = f"data:image/jpeg;base64,{raw}"
        parts.append({"type": "image_url", "image_url": {"url": data_url}})
    else:
        raise ValueError("image_url or image_base64 is required")
    return [{"role": "user", "content": parts}]


def _default_vision_steps(settings: Optional[Dict[str, Any]] = None) -> List[Dict[str, str]]:
    from main import _default_agent_llm_routing, load_swoop_llm_key_settings
    from swoop_provider_catalog import get_cached_provider_catalogs, pick_models_for_tier, resolve_model_for_provider

    tiers = _default_agent_llm_routing().get("tiers") or {}
    vision = tiers.get("vision")
    if isinstance(vision, list) and vision:
        return [dict(x) for x in vision]
    swoop = settings if settings is not None else load_swoop_llm_key_settings()
    catalogs = get_cached_provider_catalogs(swoop)
    steps: List[Dict[str, str]] = []
    for prov in _VISION_PROVIDERS:
        candidates = pick_models_for_tier(catalogs.get(prov, []), "vision", prov, limit=_VISION_FALLBACK_LIMIT)
        if candidates:
            for model in candidates:
                steps.append({"provider": prov, "model": model})
        else:
            model = resolve_model_for_provider(prov, "vision", "", swoop, catalogs=catalogs)
            if model:
                steps.append({"provider": prov, "model": model})
    return steps


def _vision_steps_from_swoop(settings: Dict[str, Any]) -> List[Dict[str, str]]:
    from main import _coerce_routing_steps, _default_agent_llm_routing
    from swoop_provider_catalog import get_cached_provider_catalogs, pick_models_for_tier, resolve_model_for_provider

    routing = settings.get("agent_llm_routing")
    if not isinstance(routing, dict):
        routing = _default_agent_llm_routing()
    tiers = routing.get("tiers") if isinstance(routing.get("tiers"), dict) else {}
    steps = _coerce_routing_steps(tiers.get("vision"))
    if not steps:
        steps = _default_vision_steps(settings)
    catalogs = get_cached_provider_catalogs(settings)
    out: List[Dict[str, str]] = []
    for step in steps:
        prov = str(step.get("provider") or "").strip().lower()
        if prov not in _VISION_PROVIDERS:
            continue
        model = str(step.get("model") or "").strip()
        if model:
            out.append({"provider": prov, "model": model})
        else:
            candidates = pick_models_for_tier(
                catalogs.get(prov, []), "vision", prov, limit=_VISION_FALLBACK_LIMIT
            )
            if candidates:
                for candidate in candidates:
                    out.append({"provider": prov, "model": candidate})
            else:
                resolved = resolve_model_for_provider(prov, "vision", "", settings, catalogs=catalogs)
                if resolved:
                    out.append({"provider": prov, "model": resolved})
    if not out:
        out = _default_vision_steps(settings)
    # Уникальные пары provider+model, порядок сохраняем.
    seen: set = set()
    unique: List[Dict[str, str]] = []
    for step in out:
        key = (step["provider"], step["model"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(step)
    return unique


def _try_vision_with_tier(
    messages: List[Dict[str, Any]],
    tier: str,
    settings: Dict[str, Any],
) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    from main import openai_chat_completions_generic

    errors: List[str] = []
    steps = _vision_steps_from_swoop(settings) if tier == "vision" else []
    if tier != "vision":
        res = openai_chat_completions_generic(
            messages=messages,
            temperature=0.2,
            tier_override=tier,
            hermes_proxy=True,
        )
        text = (res.content or "").strip() if res.content else ""
        if text:
            return (
                {
                    "ok": True,
                    "text": text,
                    "provider": res.provider_used or tier,
                    "model": res.model_resolved or "",
                },
                errors,
            )
        errors.append(f"tier={tier}: empty response")
        return None, errors

    for step in steps:
        prov = step["provider"]
        model = step["model"]
        try:
            res = openai_chat_completions_generic(
                messages=messages,
                temperature=0.2,
                tier_override="vision",
                route_provider_override=prov,
                route_model_override=model,
                hermes_proxy=True,
            )
            text = (res.content or "").strip() if res.content else ""
            if text:
                return (
                    {
                        "ok": True,
                        "text": text,
                        "provider": res.provider_used or prov,
                        "model": res.model_resolved or model,
                    },
                    errors,
                )
            errors.append(f"{prov}/{model}: empty response")
        except Exception as exc:
            logger.warning("vision fail %s/%s: %s", prov, model, exc)
            errors.append(f"{prov}/{model}: {exc}")
    return None, errors


def vision_analyze_from_settings(
    task: str,
    image_url: Optional[str] = None,
    image_base64: Optional[str] = None,
) -> Dict[str, Any]:
    from main import load_swoop_llm_key_settings

    try:
        messages = _vision_messages(task, image_url, image_base64)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}

    settings = load_swoop_llm_key_settings()
    all_errors: List[str] = []

    for tier in ("vision", "reasoning"):
        result, errs = _try_vision_with_tier(messages, tier, settings)
        all_errors.extend(errs)
        if result:
            return result

    return {
        "ok": False,
        "error": (
            "Не удалось распознать изображение ни одной vision-моделью из Swoop. "
            + (all_errors[-1] if all_errors else "проверьте ключи glm/gemini/openrouter в админке.")
        ),
        "attempts": all_errors[-8:],
    }


def _whisper_transcribe_bytes(
    data: bytes,
    *,
    filename: str,
    content_type: str,
    language: Optional[str] = None,
    source_label: str = "bytes",
) -> Dict[str, Any]:
    from main import load_swoop_llm_key_settings, _iter_keys_with_health

    settings = load_swoop_llm_key_settings()
    openai_base = _openai_audio_base()
    openai_pool = list(settings.get("openai_keys") or [])

    import io
    import urllib.request as ur

    for key in _iter_keys_with_health("openai_pool", openai_pool):
        try:
            boundary = "----autoroFormBoundary7MA4YWxk"
            body_io = io.BytesIO()
            body_io.write(f"--{boundary}\r\n".encode())
            body_io.write(
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
            )
            body_io.write(f"Content-Type: {content_type or 'application/octet-stream'}\r\n\r\n".encode())
            body_io.write(data)
            body_io.write(f"\r\n--{boundary}\r\n".encode())
            body_io.write(f'Content-Disposition: form-data; name="model"\r\n\r\n'.encode())
            body_io.write(b"whisper-1\r\n")
            if language:
                body_io.write(f"--{boundary}\r\n".encode())
                body_io.write(f'Content-Disposition: form-data; name="language"\r\n\r\n'.encode())
                body_io.write(f"{language}\r\n".encode())
            body_io.write(f"--{boundary}--\r\n".encode())
            payload = body_io.getvalue()
            url = openai_base.rstrip("/") + "/audio/transcriptions"
            req = ur.Request(
                url,
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                },
            )
            with ur.urlopen(req, timeout=180) as resp:
                out = json.loads(resp.read().decode("utf-8", errors="replace"))
            text = str(out.get("text") or "").strip()
            if text:
                return {
                    "ok": True,
                    "source": source_label,
                    "transcript": text,
                    "provider": "openai",
                    "model": "whisper-1",
                }
        except Exception as exc:
            logger.warning("whisper fail: %s", exc)
            continue

    return {
        "ok": False,
        "source": source_label,
        "error": (
            "Транскрипция недоступна: нужен OpenAI-ключ в Swoop (whisper-1) "
            "или отправьте текстовый файл."
        ),
    }


def transcribe_audio_bytes(
    data: bytes,
    filename: str = "audio.ogg",
    mime_type: str = "application/octet-stream",
    language: Optional[str] = None,
) -> Dict[str, Any]:
    if not data:
        return {"ok": False, "error": "empty_audio"}
    if len(data) > _MAX_DOWNLOAD_BYTES:
        return {"ok": False, "error": f"audio_too_large_max_{_MAX_DOWNLOAD_BYTES}"}
    gemini_result = _gemini_transcribe_bytes(
        data,
        content_type=mime_type or "application/octet-stream",
        language=language,
        source_label="bytes",
    )
    if gemini_result.get("ok"):
        return gemini_result
    whisper_result = _whisper_transcribe_bytes(
        data,
        filename=filename or "audio.ogg",
        content_type=mime_type or "application/octet-stream",
        language=language,
        source_label="bytes",
    )
    if whisper_result.get("ok"):
        return whisper_result
    return gemini_result if gemini_result.get("error") else whisper_result


def transcribe_media_url(
    media_url: str,
    language: Optional[str] = None,
) -> Dict[str, Any]:
    raw = (media_url or "").strip()
    if not raw.startswith(("http://", "https://")):
        return {"ok": False, "error": "media_url must start with http:// or https://"}

    try:
        data, ctype, _ = _http_get(raw, timeout=120)
    except ValueError as exc:
        return {"ok": False, "url": raw, "error": str(exc)}

    ext = ".webm"
    if "mp4" in ctype or raw.endswith(".mp4"):
        ext = ".mp4"
    elif "mpeg" in ctype or raw.endswith(".mp3"):
        ext = ".mp3"
    elif "wav" in ctype:
        ext = ".wav"
    elif "m4a" in ctype:
        ext = ".m4a"

    result = _whisper_transcribe_bytes(
        data,
        filename=f"media{ext}",
        content_type=ctype or "application/octet-stream",
        language=language,
        source_label=raw,
    )
    if result.get("ok"):
        result["url"] = raw
        return result
    result["url"] = raw
    return result


def _openai_audio_base() -> str:
    return os.environ.get("BOOKMARKS_OPENAI_API_BASE", "https://api.openai.com/v1").strip().rstrip("/")


_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"
_GEMINI_TTS_DEFAULT_MODEL = "gemini-2.5-flash-preview-tts"
_GEMINI_STT_MODEL = "gemini-2.0-flash"
_GEMINI_TTS_VOICES = frozenset(
    {
        "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
        "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
        "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
        "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
        "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
    }
)


def _gemini_media_key_pool(settings: Dict[str, Any]) -> List[str]:
    from main import _gemini_chat_key_pool

    return list(_gemini_chat_key_pool(settings))


def _gemini_transcribe_bytes(
    data: bytes,
    *,
    content_type: str,
    language: Optional[str] = None,
    source_label: str = "bytes",
) -> Dict[str, Any]:
    from main import load_swoop_llm_key_settings, _iter_keys_with_health

    settings = load_swoop_llm_key_settings()
    gemini_pool = _gemini_media_key_pool(settings)
    if not gemini_pool:
        return {"ok": False, "source": source_label, "error": "no_gemini_keys"}

    mime = (content_type or "audio/webm").split(";")[0].strip() or "audio/webm"
    lang_hint = (language or "auto").strip()
    prompt = (
        "Transcribe the spoken audio accurately. "
        f"Language hint: {lang_hint}. "
        "Return only the transcript text, no commentary."
    )
    b64 = base64.b64encode(data).decode("ascii")
    payload = json.dumps(
        {
            "contents": [
                {
                    "parts": [
                        {"inline_data": {"mime_type": mime, "data": b64}},
                        {"text": prompt},
                    ]
                }
            ]
        }
    ).encode("utf-8")

    last_error = "no_gemini_keys"
    for key in _iter_keys_with_health("gemini_pool", gemini_pool):
        try:
            url = f"{_GEMINI_API_BASE}/models/{_GEMINI_STT_MODEL}:generateContent?key={key}"
            req = urllib.request.Request(
                url,
                data=payload,
                method="POST",
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=180) as resp:
                out = json.loads(resp.read().decode("utf-8", errors="replace"))
            text = ""
            for cand in out.get("candidates") or []:
                content = cand.get("content") or {}
                for part in content.get("parts") or []:
                    text += str(part.get("text") or "")
            text = text.strip()
            if text:
                return {
                    "ok": True,
                    "source": source_label,
                    "transcript": text,
                    "provider": "gemini",
                    "model": _GEMINI_STT_MODEL,
                    "language": language,
                }
            last_error = "empty_transcript"
        except Exception as exc:
            last_error = str(exc)
            logger.warning("gemini stt fail: %s", exc)
            continue

    return {"ok": False, "source": source_label, "error": last_error}


def _gemini_synthesize_speech(
    text: str,
    *,
    voice: str = "Kore",
    model: Optional[str] = None,
) -> Dict[str, Any]:
    from main import load_swoop_llm_key_settings, _iter_keys_with_health

    cleaned = (text or "").strip()
    if not cleaned:
        return {"ok": False, "error": "empty_text"}
    if len(cleaned) > 4096:
        cleaned = cleaned[:4096]

    voice_use = (voice or "Kore").strip()
    if voice_use not in _GEMINI_TTS_VOICES:
        voice_use = "Kore"
    model_use = (model or _GEMINI_TTS_DEFAULT_MODEL).strip() or _GEMINI_TTS_DEFAULT_MODEL

    settings = load_swoop_llm_key_settings()
    gemini_pool = _gemini_media_key_pool(settings)
    if not gemini_pool:
        return {"ok": False, "error": "no_gemini_keys"}

    payload = json.dumps(
        {
            "model": model_use,
            "input": cleaned,
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice_use}]},
        }
    ).encode("utf-8")

    last_error = "no_gemini_keys"
    for key in _iter_keys_with_health("gemini_pool", gemini_pool):
        try:
            url = f"{_GEMINI_API_BASE}/interactions"
            req = urllib.request.Request(
                url,
                data=payload,
                method="POST",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": key,
                },
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                out = json.loads(resp.read().decode("utf-8", errors="replace"))
            audio_b64 = None
            output_audio = out.get("output_audio") or {}
            if isinstance(output_audio, dict):
                audio_b64 = output_audio.get("data")
            if not audio_b64:
                for part in out.get("outputs") or []:
                    if isinstance(part, dict) and part.get("type") == "audio":
                        audio_b64 = part.get("data")
                        break
            if not audio_b64:
                last_error = "empty_audio_response"
                continue
            audio = base64.b64decode(audio_b64)
            if not audio:
                last_error = "empty_audio_response"
                continue
            return {
                "ok": True,
                "audio_bytes": audio,
                "content_type": "audio/wav",
                "provider": "gemini",
                "model": model_use,
                "voice": voice_use,
            }
        except Exception as exc:
            last_error = str(exc)
            logger.warning("gemini tts fail: %s", exc)
            continue

    return {
        "ok": False,
        "error": (
            "Синтез речи Gemini недоступен: проверьте gemini_keys в Swoop. "
            f"Последняя ошибка: {last_error}"
        ),
    }


_TTS_VOICES = frozenset(
    {"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"}
)


def synthesize_speech(
    text: str,
    *,
    voice: str = "nova",
    model: str = "tts-1",
) -> Dict[str, Any]:
    """OpenAI-compatible TTS via Swoop openai_keys. Returns ok + audio_bytes or error."""
    from main import load_swoop_llm_key_settings, _iter_keys_with_health

    cleaned = (text or "").strip()
    if not cleaned:
        return {"ok": False, "error": "empty_text"}
    if len(cleaned) > 4096:
        cleaned = cleaned[:4096]

    voice_use = (voice or "nova").strip().lower()
    if voice_use not in _TTS_VOICES:
        voice_use = "nova"
    model_use = (model or "tts-1").strip() or "tts-1"

    gemini_voice = voice if voice in _GEMINI_TTS_VOICES else "Kore"
    gemini_model = model if str(model or "").startswith("gemini") else _GEMINI_TTS_DEFAULT_MODEL
    gemini_result = _gemini_synthesize_speech(
        cleaned,
        voice=gemini_voice,
        model=gemini_model,
    )
    if gemini_result.get("ok"):
        return gemini_result

    settings = load_swoop_llm_key_settings()
    openai_pool = list(settings.get("openai_keys") or [])
    base = _openai_audio_base()
    payload = json.dumps(
        {"model": model_use, "input": cleaned, "voice": voice_use, "response_format": "mp3"}
    ).encode("utf-8")

    last_error = "no_openai_keys"
    for key in _iter_keys_with_health("openai_pool", openai_pool):
        try:
            url = f"{base}/audio/speech"
            req = urllib.request.Request(
                url,
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                audio = resp.read()
            if audio:
                return {
                    "ok": True,
                    "audio_bytes": audio,
                    "content_type": "audio/mpeg",
                    "provider": "openai",
                    "model": model_use,
                    "voice": voice_use,
                }
            last_error = "empty_audio_response"
        except Exception as exc:
            last_error = str(exc)
            logger.warning("tts fail: %s", exc)
            continue

    return {
        "ok": False,
        "error": (
            "Синтез речи недоступен: нужен OpenAI-ключ в Swoop (tts-1). "
            f"Последняя ошибка: {last_error}"
        ),
    }
