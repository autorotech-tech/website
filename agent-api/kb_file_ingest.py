"""
Извлечение текста из файлов для обогащения Unified KB (Keept).
Поддерживает txt/md/csv/json/html и базовый разбор подсказок kind/category из caption.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from typing import Any, Dict, Optional, Tuple

MAX_FILE_BYTES = 12 * 1024 * 1024  # 12 MiB

_TEXT_EXTENSIONS = frozenset({
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".html", ".htm", ".log", ".yaml", ".yml",
})
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"})
_AUDIO_EXTENSIONS = frozenset({".mp3", ".m4a", ".wav", ".ogg", ".oga", ".webm", ".mp4", ".mpeg"})

_KIND_HINT_RE = re.compile(
    r"(?:#kind\s+|#)(bookmark|note|idea|plan|development|task|article|prompt|contact|link)\b",
    re.IGNORECASE,
)
_CATEGORY_HINT_RE = re.compile(
    r"(?:#category\s+|#)(general|ai-ml|dev-tools|marketing|business|design|prompt|article|note|link|task)\b",
    re.IGNORECASE,
)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def guess_extension(filename: str, mime_type: Optional[str] = None) -> str:
    name = (filename or "").strip().lower()
    if "." in name:
        return name[name.rfind(".") :]
    mime = (mime_type or "").lower()
    mime_map = {
        "text/plain": ".txt",
        "text/markdown": ".md",
        "text/csv": ".csv",
        "application/json": ".json",
        "text/html": ".html",
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
        "audio/mpeg": ".mp3",
        "audio/ogg": ".ogg",
    }
    for key, ext in mime_map.items():
        if mime.startswith(key):
            return ext
    return ""


def parse_file_ingest_hints(caption: Optional[str]) -> Dict[str, Optional[str]]:
    """Разбор kind/category/title из подписи Telegram или web form."""
    text = (caption or "").strip()
    out: Dict[str, Optional[str]] = {"kind": None, "category": None, "title": None}
    if not text:
        return out
    kind_m = _KIND_HINT_RE.search(text)
    if kind_m:
        out["kind"] = kind_m.group(1).lower()
    cat_m = _CATEGORY_HINT_RE.search(text)
    if cat_m:
        out["category"] = cat_m.group(1).lower()
    remainder = _KIND_HINT_RE.sub("", text)
    remainder = _CATEGORY_HINT_RE.sub("", remainder)
    remainder = re.sub(r"#kb\b", "", remainder, flags=re.IGNORECASE)
    remainder = re.sub(r"\s+", " ", remainder).strip()
    if remainder:
        out["title"] = remainder[:180]
    return out


def _decode_text_bytes(data: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "cp1251", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_csv_text(data: bytes) -> str:
    raw = _decode_text_bytes(data)
    reader = csv.reader(io.StringIO(raw))
    lines = []
    for row in reader:
        if row:
            lines.append(" | ".join(cell.strip() for cell in row if cell is not None))
    return "\n".join(lines)


def _extract_json_text(data: bytes) -> str:
    raw = _decode_text_bytes(data)
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def _extract_html_text(data: bytes) -> str:
    raw = _decode_text_bytes(data)
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", raw, flags=re.IGNORECASE)
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _extract_pdf_fallback(data: bytes) -> str:
    """Без pypdf: вытаскиваем читаемые фрагменты из PDF (best-effort)."""
    chunks: list[str] = []
    for match in re.finditer(rb"\(([^()\\]{4,2000})\)", data):
        try:
            piece = match.group(1).decode("latin-1", errors="ignore").strip()
        except Exception:
            continue
        if len(piece) >= 4 and re.search(r"[A-Za-zА-Яа-я0-9]", piece):
            chunks.append(piece)
    text = "\n".join(chunks)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_text_from_bytes(
    filename: str,
    data: bytes,
    mime_type: Optional[str] = None,
) -> Tuple[str, Dict[str, Any]]:
    """
    Возвращает (text, meta). meta: method, needsVision, needsTranscription, error.
  """
    meta: Dict[str, Any] = {"method": "none", "filename": filename, "bytes": len(data)}
    if not data:
        return "", {**meta, "error": "empty_file"}
    if len(data) > MAX_FILE_BYTES:
        return "", {**meta, "error": f"file_too_large_max_{MAX_FILE_BYTES}"}

    ext = guess_extension(filename, mime_type)
    mime = (mime_type or "").lower()

    if ext in _TEXT_EXTENSIONS or mime.startswith("text/") or mime == "application/json":
        if ext == ".csv" or ext == ".tsv" or mime == "text/csv":
            return _extract_csv_text(data), {**meta, "method": "csv"}
        if ext == ".json" or ext == ".jsonl" or mime == "application/json":
            return _extract_json_text(data), {**meta, "method": "json"}
        if ext in {".html", ".htm"} or mime == "text/html":
            return _extract_html_text(data), {**meta, "method": "html"}
        text = _decode_text_bytes(data).strip()
        return text, {**meta, "method": "text"}

    if ext == ".pdf" or mime == "application/pdf":
        text = _extract_pdf_fallback(data)
        if len(text) >= 40:
            return text, {**meta, "method": "pdf_fallback"}
        return "", {**meta, "method": "pdf_fallback", "error": "pdf_text_not_extracted"}

    if ext in _IMAGE_EXTENSIONS or mime.startswith("image/"):
        return "", {**meta, "method": "image", "needsVision": True}

    if ext in _AUDIO_EXTENSIONS or mime.startswith("audio/") or mime.startswith("video/"):
        return "", {**meta, "method": "audio", "needsTranscription": True}

    # generic fallback — если файл похож на текст
    sample = data[:4096]
    if sample and sum(32 <= b < 127 or b in (9, 10, 13) for b in sample) / max(len(sample), 1) > 0.85:
        text = _decode_text_bytes(data).strip()
        if text:
            return text, {**meta, "method": "binary_as_text"}
    return "", {**meta, "error": "unsupported_file_type", "extension": ext or None}
