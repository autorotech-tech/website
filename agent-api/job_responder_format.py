"""HH formatting + anti-embellish post-process (no FastAPI deps).

Used by job_responder generate/finalize and Phase 0 golden eval harness.
"""

from __future__ import annotations

import re
from typing import List, Optional, Tuple

# HH formatting + light no-ai-slop scrub (see docs/job-responder/prompts-ultra-short.md).
_HH_SLOP_PHRASES = (
    "Я хотел бы выразить заинтересованность",
    "Пишу, чтобы выразить свой интерес",
    "В современном быстро меняющемся мире",
    "В сегодняшнем быстро меняющемся мире",
    "Как высокомотивированный профессионал",
    "Позвольте представиться",
    "Разрешите представить себя",
    "С радостью хотел бы присоединиться",
    "Имею честь подать заявку",
    "Давайте разберёмся",
    "Давайте разберемся",
    "I am writing to express my interest",
    "I'm writing to express my interest",
    "I would like to express my interest",
    "In today's fast-paced world",
    "In today's rapidly evolving world",
    "As a highly motivated professional",
    "Here's the thing",
    "Let me be clear",
    "It's worth noting that",
    "It is worth noting that",
    "At the end of the day",
    "When it comes to",
    "In conclusion,",
    "Let's dive in",
    "Going forward,",
    "Thrilled to apply",
    "I'm thrilled to apply",
    "I am thrilled to apply",
    "Passionate about",
    "I'm passionate about",
    "I am passionate about",
    "Excited about the opportunity",
    "I'm excited about the opportunity",
    "Perfect fit for",
    "Hit the ground running",
    "Динамично развивающаяся компания",
    "динамично развивающейся компании",
    "динамично развивающаяся",
    "Буду рад стать частью команды",
    "Идеально подхожу",
    "Открыт к новым вызовам",
    "Высокий уровень экспертизы",
)

_HH_SLOP_WORD_RE = re.compile(
    r"(?i)\b(?:"
    r"delve|foster|leverage|utilize|facilitate|empower|streamline|"
    r"cutting[- ]edge|paradigm\s+shift|game[- ]changer|"
    r"multifaceted|meticulous|intricate|paramount|transformative|"
    r"supercharge|harness|ever[- ]evolving|tapestry|realm|beacon|"
    r"thrilled|passionate|synergy|dynamic\s+team"
    r")\b"
)

_CEFR_EMBELLISH_RE = re.compile(
    r"(?i)\b(?:C1|C2|B2|B1|A2|A1|CEFR|IELTS|TOEFL)\b|"
    r"свободно\s+владею|на\s+продвинут\w+\s+уровн|native[- ]?like|"
    r"экспертн\w+\s+уровн|fluently?\s+(?:speak|master)"
)

_SENIORITY_EMBELLISH_RE = re.compile(
    r"(?i)(?:на\s+уровне\s+)?\b(?:senior|сеньор)\b|"
    r"уровн\w*\s+(?:senior|сеньор)|"
    r"\bэксперт(?:н\w+)?\b|"
    r"\bexperts?\b|"
    r"\blead[- ]?level\b"
)


_COVER_SECTION_SPLIT_RE = re.compile(
    r"(?m)^(?P<head>#{1,6}\s*(?:Контакты|Ссылки)\s*)$"
)
_TERMINAL_END_RE = re.compile(r'[.!?…]["\')\]]?\s*$')
_BULLET_START_RE = re.compile(r"^\s*(?:\d+\.|[-*•])\s+")
_LAST_SENTENCE_END_RE = re.compile(r'[.!?…]["\')\]]?')
_INCOMPLETE_WORD_TAIL_RE = re.compile(
    r"(?i)(?:^|[\s(])([A-Za-zА-Яа-яЁё]{1,}$)"
)


def looks_truncated_cover(text: str) -> bool:
    """True if cover body likely cut mid-word / mid-sentence (before contacts/links)."""
    body, _tail = _split_contacts_links_tail(text or "")
    prose = body.rstrip()
    if len(prose) < 40:
        return False
    # Drop trailing blank / markdown-only lines for the check.
    lines = [ln for ln in prose.splitlines() if ln.strip()]
    if not lines:
        return False
    last = lines[-1].rstrip()
    if _TERMINAL_END_RE.search(last):
        return False
    if last.endswith((":", "-", "—", "–", "->")):
        return True
    # Mid-word / no terminal punct on last content line.
    if re.search(r"[A-Za-zА-Яа-яЁё0-9)]$", last):
        return True
    return False


def _split_contacts_links_tail(text: str) -> Tuple[str, str]:
    """Split letter into prose + trailing ## Контакты / ## Ссылки block (if any)."""
    raw = text or ""
    m = _COVER_SECTION_SPLIT_RE.search(raw)
    if not m:
        return raw, ""
    return raw[: m.start()], raw[m.start() :]


def _trim_incomplete_line(line: str) -> Optional[str]:
    """Complete to last sentence end, else drop incomplete trailing word, else None (= drop line)."""
    s = (line or "").rstrip()
    if not s:
        return ""
    if _TERMINAL_END_RE.search(s):
        return s
    ends = list(_LAST_SENTENCE_END_RE.finditer(s))
    if ends:
        cut = s[: ends[-1].end()].rstrip()
        if len(cut) >= 12:
            return cut
    # Drop trailing incomplete token (e.g. "сценарии использ").
    trimmed = re.sub(r"\s+\S{1,24}$", "", s).rstrip()
    if trimmed and trimmed != s:
        if _TERMINAL_END_RE.search(trimmed):
            return trimmed
        ends2 = list(_LAST_SENTENCE_END_RE.finditer(trimmed))
        if ends2:
            cut2 = trimmed[: ends2[-1].end()].rstrip()
            if len(cut2) >= 12:
                return cut2
        # Keep trimmed line if it still has useful content and ends with letter+punct-ish.
        if len(trimmed) >= 20 and not _INCOMPLETE_WORD_TAIL_RE.search(trimmed):
            return trimmed
    # Incomplete bullet with no salvageable sentence -> drop.
    if _BULLET_START_RE.match(s):
        return None
    return trimmed if len(trimmed) >= 20 else None


def strip_incomplete_trailing_text(text: str) -> str:
    """Prefer complete last sentence / strip incomplete trailing bullet over mid-word cut."""
    if not (text or "").strip():
        return text or ""
    body, tail = _split_contacts_links_tail(text)
    if not looks_truncated_cover(body):
        return text
    lines = body.splitlines()
    # Walk back over blank lines.
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return (tail or "").strip()
    fixed = _trim_incomplete_line(lines[-1])
    if fixed is None:
        lines.pop()
        while lines and not lines[-1].strip():
            lines.pop()
    else:
        lines[-1] = fixed
    prose = "\n".join(lines).rstrip()
    if tail:
        return (prose + ("\n\n" if prose else "") + tail.lstrip()).strip()
    return prose


def hh_format_text(text: str) -> str:
    """HH vacancy response formatting + safe no-ai-slop scrub."""
    if not text:
        return ""
    t = text
    t = t.replace("—", "-").replace("–", "-")
    t = t.replace("→", "->").replace("⇒", "->")
    t = t.replace("«", '"').replace("»", '"')
    t = t.replace("\u201c", '"').replace("\u201d", '"').replace("\u201e", '"')
    for bad in _HH_SLOP_PHRASES:
        t = re.sub(re.escape(bad), "", t, flags=re.IGNORECASE)
    t = _HH_SLOP_WORD_RE.sub("", t)
    t = re.sub(r"[ \t]{2,}", " ", t)
    t = re.sub(r" *([,.;:])", r"\1", t)
    t = re.sub(r"(?m)^[ \t]*[,.;:]+[ \t]*", "", t)
    t = re.sub(
        r"(?m)^(?!\*\*)(Должность|Компания|Формат):\*\*",
        r"**\1:**",
        t,
    )
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def strip_embellished_language_claims(letter: str, profile_blob: str) -> Tuple[str, List[str]]:
    """Drop/soften CEFR/fluency/senior/expert claims not present in profile/RAG."""
    src = (profile_blob or "").lower()
    src_has_cefr = bool(re.search(r"\b(?:c1|c2|b2|b1|a2|a1|cefr|ielts|toefl)\b", src))
    src_has_senior = bool(re.search(r"\b(?:senior|сеньор)\b", src))
    src_has_expert = bool(re.search(r"\b(?:эксперт|expert)\b", src))
    fixes: List[str] = []
    out_lines: List[str] = []
    for ln in (letter or "").splitlines():
        line = ln
        if _CEFR_EMBELLISH_RE.search(line) and not src_has_cefr:
            if re.search(r"(?i)english|английск", line) and "proficient" in src:
                replacement = (
                    "3. **English (Proficient)** - Английский на уровне Proficient "
                    "(формулировка как в профиле; без CEFR)."
                )
                num = re.match(r"^(\s*\d+\.\s*)", line)
                if num:
                    replacement = num.group(1) + replacement.split(". ", 1)[-1]
                out_lines.append(replacement)
                fixes.append("rewrote_proficient_no_cefr")
                continue
            if re.search(r"(?i)english|английск|язык", line):
                fixes.append("dropped_embellished_language_bullet")
                continue
            soft = _CEFR_EMBELLISH_RE.sub("", line)
            soft = re.sub(r"\s{2,}", " ", soft).strip(" -–—*")
            if soft:
                line = soft
                fixes.append("stripped_cefr_tokens")
            else:
                fixes.append("dropped_embellished_line")
                continue

        if _SENIORITY_EMBELLISH_RE.search(line):
            scrubbed = line
            if not src_has_senior:
                scrubbed = re.sub(
                    r"(?i)(?:на\s+уровне\s+)?\b(?:senior|сеньор)\b|уровн\w*\s+(?:senior|сеньор)",
                    "",
                    scrubbed,
                )
            if not src_has_expert:
                scrubbed = re.sub(r"(?i)\bэксперт(?:н\w+)?\b|\bexperts?\b", "", scrubbed)
            if not src_has_senior:
                scrubbed = re.sub(r"(?i)\blead[- ]?level\b", "", scrubbed)
            scrubbed = re.sub(r"\s{2,}", " ", scrubbed)
            scrubbed = re.sub(r"\s+([,.;:])", r"\1", scrubbed)
            scrubbed = scrubbed.strip(" -–—*")
            body = re.sub(r"^\s*\d+\.\s*", "", scrubbed)
            body = re.sub(r"^\*\*[^*]+\*\*\s*-?\s*", "", body).strip()
            if scrubbed != line:
                fixes.append("stripped_seniority_embellish")
            if len(body) < 12:
                fixes.append("dropped_embellished_seniority_line")
                continue
            line = scrubbed

        out_lines.append(line)
    return "\n".join(out_lines), fixes
