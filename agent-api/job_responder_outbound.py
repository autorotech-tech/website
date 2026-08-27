"""Outbound prepare helpers for Autoro Hunt (Phase 5).

Packages scored vacancies into a human-gated response queue.
Never auto-submits; extension fills/inserts only after user confirm.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from job_responder_platforms import detect_platform, host_key_for_hostname


def _str(v: Any, max_len: int = 8000) -> str:
    s = str(v or "").strip()
    return s[:max_len] if s else ""


def _vacancy_id(item: Dict[str, Any]) -> str:
    vid = _str(item.get("id"), 64)
    if vid:
        return vid
    url = _str(item.get("url"), 4000)
    if "/vacancy/" in url:
        part = url.split("/vacancy/", 1)[1]
        digits = "".join(ch for ch in part.split("?", 1)[0].split("/", 1)[0] if ch.isdigit())
        if digits:
            return digits
    return ""


def _hostname_from_url(url: str) -> str:
    u = _str(url, 4000)
    if not u.startswith("http"):
        return ""
    try:
        # Avoid urllib dependency edge cases in tiny helper.
        without = u.split("://", 1)[1]
        host = without.split("/", 1)[0]
        return host.split(":", 1)[0].lower()
    except Exception:
        return ""


def normalize_answers(raw: Any) -> List[Dict[str, str]]:
    """Normalize [{question, answer}] stubs from generate or client."""
    out: List[Dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for row in raw[:40]:
        if isinstance(row, str):
            q = _str(row, 4000)
            if q:
                out.append({"question": q, "answer": ""})
            continue
        if not isinstance(row, dict):
            continue
        q = _str(row.get("question") or row.get("text") or "", 4000)
        a = _str(row.get("answer") or "", 8000)
        if not q and not a:
            continue
        out.append({"question": q, "answer": a})
    return out


def prepare_outbound_item(
    item: Dict[str, Any],
    *,
    default_letter: str = "",
    default_attachment_ids: Optional[Sequence[int]] = None,
    min_score: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Build one queue row. Returns None if filtered out (e.g. below min_score)."""
    score_raw = item.get("score")
    score: Optional[float]
    try:
        score = float(score_raw) if score_raw is not None and str(score_raw).strip() != "" else None
    except (TypeError, ValueError):
        score = None

    if min_score is not None and score is not None and score < float(min_score):
        return None

    url = _str(item.get("url"), 4000)
    host_name = _hostname_from_url(url)
    adapter = detect_platform(host_name) if host_name else detect_platform("")
    host_key = _str(item.get("host"), 32) or (host_key_for_hostname(host_name) if host_name else "web")

    letter = _str(item.get("letterText") or item.get("letter") or default_letter, 20000)
    answers = normalize_answers(item.get("answers") or item.get("questions"))
    att = item.get("attachmentSourceIds")
    if not isinstance(att, list) or not att:
        att = list(default_attachment_ids or [])
    attachment_ids = []
    for x in att[:50]:
        try:
            attachment_ids.append(int(x))
        except (TypeError, ValueError):
            continue

    status = "ready_for_review" if letter or any(a.get("answer") for a in answers) else "needs_letter"

    return {
        "id": _vacancy_id(item),
        "url": url,
        "title": _str(item.get("title"), 1000) or "Вакансия",
        "company": _str(item.get("company"), 500),
        "score": score,
        "host": host_key,
        "platform": adapter.id,
        "platformLabel": adapter.label,
        "letterText": letter,
        "answers": answers,
        "attachmentSourceIds": attachment_ids,
        "status": status,
        "humanGate": True,
        "autoSubmit": False,
        "actions": ["insert_letter", "fill_fields", "manual_submit"],
        "selectors": dict(adapter.selectors or {}),
    }


def prepare_outbound_bundle(
    items: Sequence[Dict[str, Any]],
    *,
    default_letter: str = "",
    default_attachment_ids: Optional[Sequence[int]] = None,
    min_score: Optional[float] = None,
    workspace_id: str = "",
) -> Dict[str, Any]:
    """Prepare human-gated outbound queue from scored / selected vacancies."""
    prepared: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    for raw in items[:80]:
        if not isinstance(raw, dict):
            skipped.append({"reason": "invalid_item"})
            continue
        row = prepare_outbound_item(
            raw,
            default_letter=default_letter,
            default_attachment_ids=default_attachment_ids,
            min_score=min_score,
        )
        if row is None:
            skipped.append(
                {
                    "id": _vacancy_id(raw),
                    "url": _str(raw.get("url"), 4000),
                    "title": _str(raw.get("title"), 200),
                    "score": raw.get("score"),
                    "reason": "below_min_score",
                }
            )
            continue
        prepared.append(row)

    return {
        "ok": True,
        "humanGate": True,
        "autoSubmit": False,
        "message": (
            "Пакет готов к ручному отклику. Расширение не отправляет форму автоматически "
            "(human gate)."
        ),
        "prepared": prepared,
        "skipped": skipped,
        "count": len(prepared),
        "workspaceId": str(workspace_id or ""),
    }
