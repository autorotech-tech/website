"""Offline / batch cross-encoder re-rank for Autoro Hunt vacancy lists.

NOT on the Cloudflare generate hot path. Optional dependency:
  pip install sentence-transformers
Model default: cross-encoder/ms-marco-MiniLM-L-6-v2

Enable batch API re-rank with:
  JOB_RESPONDER_CE_RERANK=1
When sentence-transformers is missing, callers degrade gracefully (identity order).
"""

from __future__ import annotations

import logging
import math
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

_LOG = logging.getLogger("job_responder.cross_encoder")

DEFAULT_CE_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
_ENV_FLAG = "JOB_RESPONDER_CE_RERANK"
_ENV_MODEL = "JOB_RESPONDER_CE_MODEL"
_ENV_BLEND = "JOB_RESPONDER_CE_BLEND"  # 0..1 weight of CE vs prior score

_reranker = None
_reranker_model: Optional[str] = None
_import_error: Optional[str] = None


def ce_rerank_enabled() -> bool:
    return str(os.environ.get(_ENV_FLAG, "0")).strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def ce_model_name() -> str:
    return str(os.environ.get(_ENV_MODEL, "") or DEFAULT_CE_MODEL).strip() or DEFAULT_CE_MODEL


def ce_blend_weight() -> float:
    try:
        w = float(os.environ.get(_ENV_BLEND, "0.35") or "0.35")
    except (TypeError, ValueError):
        w = 0.35
    return max(0.0, min(1.0, w))


def sentence_transformers_available() -> bool:
    try:
        import sentence_transformers  # noqa: F401

        return True
    except Exception as exc:  # pragma: no cover - env dependent
        global _import_error
        _import_error = str(exc)
        return False


def get_cross_encoder(model_name: Optional[str] = None):
    """Lazy-load CrossEncoder; returns None if deps missing."""
    global _reranker, _reranker_model, _import_error
    name = (model_name or ce_model_name()).strip()
    if _reranker is not None and _reranker_model == name:
        return _reranker
    try:
        from sentence_transformers import CrossEncoder

        _reranker = CrossEncoder(name)
        _reranker_model = name
        _import_error = None
        _LOG.info("cross-encoder loaded model=%s", name)
        return _reranker
    except Exception as exc:
        _import_error = str(exc)
        _LOG.warning("cross-encoder unavailable: %s", exc)
        _reranker = None
        _reranker_model = None
        return None


def ce_status() -> Dict[str, Any]:
    available = sentence_transformers_available()
    return {
        "enabledFlag": ce_rerank_enabled(),
        "depsAvailable": available,
        "model": ce_model_name(),
        "blend": ce_blend_weight(),
        "loaded": _reranker is not None,
        "importError": _import_error,
    }


def _sigmoid(x: float) -> float:
    # Stable sigmoid for CE logits / raw scores
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def normalize_ce_scores(raw: Sequence[float]) -> List[float]:
    """Map CE outputs to ~0..1. Prefer min-max within batch; fallback sigmoid."""
    if not raw:
        return []
    vals = [float(x) for x in raw]
    lo, hi = min(vals), max(vals)
    if hi - lo < 1e-9:
        # All equal — keep mild positive mass via sigmoid
        return [_sigmoid(v) for v in vals]
    # Heuristic: if already look like probabilities, keep clipped
    if lo >= -0.05 and hi <= 1.05:
        return [max(0.0, min(1.0, v)) for v in vals]
    return [(v - lo) / (hi - lo) for v in vals]


def predict_ce_scores(
    query: str,
    documents: Sequence[str],
    *,
    model_name: Optional[str] = None,
) -> Tuple[Optional[List[float]], Dict[str, Any]]:
    """Return CE scores aligned with documents, or None if unavailable."""
    q = (query or "").strip()
    docs = [str(d or "").strip() for d in documents]
    meta: Dict[str, Any] = {
        "applied": False,
        "reason": None,
        "model": model_name or ce_model_name(),
        "pairCount": len(docs),
    }
    if not q or not docs:
        meta["reason"] = "empty_query_or_docs"
        return None, meta
    encoder = get_cross_encoder(model_name)
    if encoder is None:
        meta["reason"] = "deps_missing"
        meta["importError"] = _import_error
        return None, meta
    pairs = [(q, d if d else " ") for d in docs]
    try:
        raw = encoder.predict(pairs)
        scores = [float(x) for x in raw]
        meta["applied"] = True
        return scores, meta
    except Exception as exc:
        _LOG.warning("cross-encoder predict failed: %s", exc)
        meta["reason"] = f"predict_failed:{exc}"
        return None, meta


def blend_scores(
    prior_scores: Sequence[float],
    ce_raw: Sequence[float],
    *,
    blend: Optional[float] = None,
) -> List[float]:
    """Blend prior 0..100 scores with CE (normalized 0..1 → 0..100)."""
    w = ce_blend_weight() if blend is None else max(0.0, min(1.0, float(blend)))
    ce_n = normalize_ce_scores(ce_raw)
    out: List[float] = []
    for i, prior in enumerate(prior_scores):
        p = float(prior)
        c100 = 100.0 * float(ce_n[i]) if i < len(ce_n) else p
        out.append((1.0 - w) * p + w * c100)
    return out


def rerank_vacancy_batch(
    profile_text: str,
    items: Sequence[Dict[str, Any]],
    *,
    text_keys: Sequence[str] = ("title", "description", "text"),
    score_key: str = "score",
    blend: Optional[float] = None,
    model_name: Optional[str] = None,
    force: bool = False,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Re-rank scored vacancy dicts. Identity order when CE unavailable / flag off.

    Each item should have a numeric score_key and text fields for the JD side.
    Returns (new_items, meta). New items get ceScore / score (blended) when applied.
    """
    meta: Dict[str, Any] = {
        "ce": ce_status(),
        "applied": False,
        "reason": None,
        "count": len(items),
    }
    if not items:
        meta["reason"] = "empty"
        return list(items), meta
    if not force and not ce_rerank_enabled():
        meta["reason"] = "flag_off"
        return [dict(x) for x in items], meta

    docs: List[str] = []
    priors: List[float] = []
    for it in items:
        parts = []
        for k in text_keys:
            v = it.get(k)
            if v:
                parts.append(str(v).strip())
        docs.append(" ".join(parts)[:2000] or str(it.get("title") or "vacancy"))
        try:
            priors.append(float(it.get(score_key) or 0))
        except (TypeError, ValueError):
            priors.append(0.0)

    raw, pred_meta = predict_ce_scores(profile_text, docs, model_name=model_name)
    meta.update({k: v for k, v in pred_meta.items() if k != "applied"})
    if raw is None:
        meta["reason"] = pred_meta.get("reason") or "unavailable"
        return [dict(x) for x in items], meta

    blended = blend_scores(priors, raw, blend=blend)
    ce_n = normalize_ce_scores(raw)
    out: List[Dict[str, Any]] = []
    for i, it in enumerate(items):
        row = dict(it)
        row["scorePrior"] = int(round(priors[i]))
        row["ceScore"] = round(float(ce_n[i]), 4)
        row["ceRaw"] = round(float(raw[i]), 4)
        row[score_key] = int(max(0, min(100, round(blended[i]))))
        out.append(row)
    # Stable sort by blended score desc
    out.sort(key=lambda r: (float(r.get(score_key) or 0), float(r.get("ceScore") or 0)), reverse=True)
    meta["applied"] = True
    meta["reason"] = None
    meta["blend"] = ce_blend_weight() if blend is None else blend
    return out, meta


def profile_text_for_ce(profile: Dict[str, Any], *, max_chars: int = 1800) -> str:
    """Compact query string from merged profile for CE pairs."""
    parts: List[str] = []
    for key in ("title", "headline", "summary"):
        v = profile.get(key)
        if v:
            parts.append(str(v).strip())
    skills = profile.get("skills") or []
    if skills:
        parts.append("skills: " + ", ".join(str(x) for x in skills[:40]))
    tools = profile.get("tools") or []
    if tools:
        parts.append("tools: " + ", ".join(str(x) for x in tools[:30]))
    domains = profile.get("domains") or profile.get("domains_matched") or []
    if domains:
        parts.append("domains: " + ", ".join(str(x) for x in domains[:12]))
    for bullet in (profile.get("experience_bullets") or [])[:8]:
        parts.append(str(bullet).strip()[:240])
    blob = str(profile.get("_text_blob") or "").strip()
    if blob and len(" ".join(parts)) < max_chars // 2:
        parts.append(blob[:800])
    text = "\n".join(p for p in parts if p)
    return text[:max_chars]
