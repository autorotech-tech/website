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
import time
import zipfile
import zlib
from typing import Any, Dict, List, Optional, Tuple

MAX_FILE_BYTES = 12 * 1024 * 1024  # 12 MiB
PDF_MAX_PAGES = 12
PDF_EXTRACT_BUDGET_SEC = 18.0
PDF_FLATE_STREAM_LIMIT = 60

_TEXT_EXTENSIONS = frozenset({
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".html", ".htm", ".log", ".yaml", ".yml",
})
_IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"})
_AUDIO_EXTENSIONS = frozenset({".mp3", ".m4a", ".wav", ".ogg", ".oga", ".webm", ".mp4", ".mpeg"})
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")

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
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/msword": ".doc",
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


def sanitize_extracted_text(text: str) -> str:
    """Strip NULs/control chars so Postgres/psycopg2 will accept the string."""
    if not text:
        return ""
    cleaned = text.replace("\x00", "")
    cleaned = _CONTROL_CHARS_RE.sub("", cleaned)
    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


def _printable_ratio(text: str) -> float:
    if not text:
        return 0.0
    good = sum(1 for ch in text if ch.isprintable() or ch in "\n\t")
    return good / max(len(text), 1)


def _looks_like_text(piece: str, *, min_len: int = 4) -> bool:
    if len(piece) < min_len:
        return False
    if "\x00" in piece:
        return False
    if _printable_ratio(piece) < 0.85:
        return False
    return bool(re.search(r"[A-Za-zА-Яа-яЁё0-9]", piece))


def _pdf_unescape_bytes(raw: bytes) -> bytes:
    out = bytearray()
    i = 0
    while i < len(raw):
        b = raw[i]
        if b != 0x5C or i + 1 >= len(raw):
            out.append(b)
            i += 1
            continue
        nxt = raw[i + 1]
        mapping = {0x6E: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5C: 0x5C}
        if nxt in mapping:
            out.append(mapping[nxt])
            i += 2
            continue
        if 0x30 <= nxt <= 0x37:
            octal = [nxt]
            j = i + 2
            while j < len(raw) and len(octal) < 3 and 0x30 <= raw[j] <= 0x37:
                octal.append(raw[j])
                j += 1
            out.append(int(bytes(octal), 8) & 0xFF)
            i = j
            continue
        out.append(nxt)
        i += 2
    return bytes(out)


def _decode_pdf_bytes(raw: bytes) -> str:
    if not raw:
        return ""
    if raw.startswith(b"\xfe\xff"):
        return raw[2:].decode("utf-16-be", errors="ignore")
    if raw.startswith(b"\xff\xfe"):
        return raw[2:].decode("utf-16-le", errors="ignore")
    if b"\x00" in raw and len(raw) >= 4 and (raw.count(b"\x00") / len(raw)) >= 0.3:
        padded = raw if len(raw) % 2 == 0 else raw + b"\x00"
        return padded.decode("utf-16-be", errors="ignore")
    if b"\x00" in raw:
        raw = raw.replace(b"\x00", b"")
        if not raw:
            return ""
    for enc in ("utf-8", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="ignore")


def _iter_pdf_literal_strings(data: bytes) -> List[str]:
    chunks: List[str] = []
    for match in re.finditer(rb"\((?:\\.|[^\\)]){2,8000}\)", data):
        decoded = _decode_pdf_bytes(_pdf_unescape_bytes(match.group(0)[1:-1]))
        piece = decoded.replace("\x00", "").strip()
        if _looks_like_text(piece):
            chunks.append(piece)
    for match in re.finditer(rb"<([0-9A-Fa-f \t\r\n]{8,8000})>", data):
        hex_s = re.sub(rb"\s+", b"", match.group(1))
        if len(hex_s) % 2:
            hex_s += b"0"
        try:
            raw = bytes.fromhex(hex_s.decode("ascii"))
        except ValueError:
            continue
        piece = _decode_pdf_bytes(raw).replace("\x00", "").strip()
        if _looks_like_text(piece):
            chunks.append(piece)
    return chunks


def _inflate_pdf_streams(data: bytes, *, limit: int = PDF_FLATE_STREAM_LIMIT) -> List[bytes]:
    inflated: List[bytes] = []
    for match in re.finditer(rb"stream\r?\n(.*?)endstream", data, re.S):
        blob = match.group(1)
        if blob.endswith(b"\r\n"):
            blob = blob[:-2]
        elif blob.endswith(b"\n") or blob.endswith(b"\r"):
            blob = blob[:-1]
        dec = None
        for wbits in (zlib.MAX_WBITS, -15):
            try:
                dec = zlib.decompress(blob, wbits)
                break
            except zlib.error:
                continue
        if dec:
            inflated.append(dec)
        if len(inflated) >= limit:
            break
    return inflated


def _extract_pdf_pypdf(
    data: bytes,
    *,
    max_pages: int = PDF_MAX_PAGES,
    budget_sec: float = PDF_EXTRACT_BUDGET_SEC,
) -> Tuple[str, Dict[str, Any]]:
    reader = None
    extra: Dict[str, Any] = {"pdfPages": 0, "pdfTruncated": False}
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(io.BytesIO(data))
    except Exception:
        try:
            from PyPDF2 import PdfReader  # type: ignore

            reader = PdfReader(io.BytesIO(data))
        except Exception:
            return "", extra
    if reader is None:
        return "", extra
    pages: List[str] = []
    deadline = time.monotonic() + max(2.0, float(budget_sec))
    try:
        all_pages = list(getattr(reader, "pages", []) or [])
        extra["pdfPageCount"] = len(all_pages)
        for page in all_pages[: max(1, int(max_pages))]:
            if time.monotonic() > deadline:
                extra["pdfTruncated"] = True
                break
            try:
                piece = page.extract_text() or ""
            except Exception:
                piece = ""
            extra["pdfPages"] = int(extra["pdfPages"]) + 1
            if piece.strip():
                pages.append(piece)
        if extra["pdfPageCount"] > extra["pdfPages"]:
            extra["pdfTruncated"] = True
    except Exception:
        return sanitize_extracted_text("\n".join(pages)), extra
    return sanitize_extracted_text("\n".join(pages)), extra


def _extract_pdf_text(data: bytes) -> Tuple[str, str, Dict[str, Any]]:
    """Returns (text, method, extra). Never includes NUL bytes. Fast-path pypdf."""
    started = time.monotonic()
    deadline = started + PDF_EXTRACT_BUDGET_SEC
    extra: Dict[str, Any] = {}

    pypdf_text, pypdf_meta = _extract_pdf_pypdf(data)
    extra.update(pypdf_meta)
    if len(pypdf_text) >= 80:
        extra["pdfElapsedSec"] = round(time.monotonic() - started, 3)
        return pypdf_text, "pdf_pypdf", extra

    candidates: List[Tuple[str, str]] = []
    if pypdf_text:
        candidates.append((pypdf_text, "pdf_pypdf"))

    if time.monotonic() < deadline:
        inflated = _inflate_pdf_streams(data, limit=PDF_FLATE_STREAM_LIMIT)
        if inflated:
            flate_chunks: List[str] = []
            for blob in inflated:
                if time.monotonic() > deadline:
                    extra["pdfTruncated"] = True
                    break
                flate_chunks.extend(_iter_pdf_literal_strings(blob))
            flate_text = sanitize_extracted_text("\n".join(flate_chunks))
            if flate_text:
                candidates.append((flate_text, "pdf_flate"))

    # Full-file literal scan is O(file size) and can exceed Cloudflare 524.
    if time.monotonic() < deadline and len(data) <= 1_500_000:
        raw_text = sanitize_extracted_text("\n".join(_iter_pdf_literal_strings(data)))
        if raw_text:
            candidates.append((raw_text, "pdf_literals"))
    elif len(data) > 1_500_000:
        extra["pdfSkippedLiterals"] = True

    extra["pdfElapsedSec"] = round(time.monotonic() - started, 3)
    ranked = [
        item
        for item in candidates
        if len(item[0]) >= 40 and _printable_ratio(item[0]) >= 0.85
    ]
    if ranked:
        ranked.sort(key=lambda item: len(item[0]), reverse=True)
        return ranked[0][0], ranked[0][1], extra
    if candidates:
        candidates.sort(key=lambda item: len(item[0]), reverse=True)
        return candidates[0][0], candidates[0][1], extra
    return "", "pdf_none", extra


def _extract_docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError, OSError):
        return ""
    xml = re.sub(rb"</w:p[^>]*>", b"\n", xml)
    xml = re.sub(rb"<[^>]+>", b" ", xml)
    text = _decode_text_bytes(xml)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return sanitize_extracted_text(text)


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
            text, method = sanitize_extracted_text(_extract_csv_text(data)), "csv"
        elif ext == ".json" or ext == ".jsonl" or mime == "application/json":
            text, method = sanitize_extracted_text(_extract_json_text(data)), "json"
        elif ext in {".html", ".htm"} or mime == "text/html":
            text, method = sanitize_extracted_text(_extract_html_text(data)), "html"
        else:
            text, method = sanitize_extracted_text(_decode_text_bytes(data)), "text"
        return text, {**meta, "method": method}

    if ext == ".pdf" or mime == "application/pdf":
        text, method, pdf_extra = _extract_pdf_text(data)
        meta.update(pdf_extra)
        if len(text) >= 40:
            return text, {**meta, "method": method}
        return "", {**meta, "method": method or "pdf_none", "error": "pdf_text_not_extracted"}

    if ext == ".docx" or "wordprocessingml.document" in mime:
        text = _extract_docx_text(data)
        if len(text) >= 20:
            return text, {**meta, "method": "docx"}
        return "", {**meta, "method": "docx", "error": "docx_text_not_extracted"}

    if ext == ".doc" or mime == "application/msword":
        return "", {**meta, "method": "doc", "error": "legacy_doc_unsupported_save_as_pdf_or_docx"}

    if ext in _IMAGE_EXTENSIONS or mime.startswith("image/"):
        return "", {**meta, "method": "image", "needsVision": True}

    if ext in _AUDIO_EXTENSIONS or mime.startswith("audio/") or mime.startswith("video/"):
        return "", {**meta, "method": "audio", "needsTranscription": True}

    # generic fallback — если файл похож на текст
    sample = data[:4096]
    if sample and sum(32 <= b < 127 or b in (9, 10, 13) for b in sample) / max(len(sample), 1) > 0.85:
        text = sanitize_extracted_text(_decode_text_bytes(data))
        if text:
            return text, {**meta, "method": "binary_as_text"}
    return "", {**meta, "error": "unsupported_file_type", "extension": ext or None}
