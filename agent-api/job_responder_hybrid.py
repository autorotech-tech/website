"""Hybrid relevance: lightweight BM25 + dense token rank fused via RRF.

No extra dependencies; used by Job Responder /relevance hot path.
Semantic grid remains a separate Tier-0 boost in score_resume_vs_vacancy.
RRF base is gated by absolute BM25/dense quality so rank-consensus alone
cannot inflate weak matches to the ceiling.
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Sequence, Tuple

_TOKEN_RE = re.compile(r"[a-zA-Zа-яА-ЯёЁ0-9+#.%]{2,}")
_STOP = frozenset(
    {
        "и",
        "в",
        "на",
        "по",
        "для",
        "с",
        "the",
        "and",
        "of",
        "to",
        "for",
        "in",
        "with",
        "or",
        "навыки",
        "skills",
        "опыт",
    }
)


def tokenize_bm25(text: str) -> List[str]:
    return [
        t.lower()
        for t in _TOKEN_RE.findall(text or "")
        if len(t) > 2 and t.lower() not in _STOP
    ]


def bm25_scores(
    query: str,
    docs: Sequence[str],
    *,
    k1: float = 1.5,
    b: float = 0.75,
) -> List[float]:
    """In-memory BM25 over document strings."""
    tokenized = [tokenize_bm25(str(d or "")) for d in docs]
    query_toks = tokenize_bm25(query)
    if not query_toks or not tokenized:
        return [0.0] * len(docs)

    n_docs = len(tokenized)
    avgdl = sum(len(d) for d in tokenized) / max(n_docs, 1)
    df: Dict[str, int] = {}
    for doc in tokenized:
        for tok in set(doc):
            df[tok] = df.get(tok, 0) + 1

    idf: Dict[str, float] = {}
    for tok, freq in df.items():
        idf[tok] = math.log((n_docs - freq + 0.5) / (freq + 0.5) + 1.0)

    scores: List[float] = []
    for doc in tokenized:
        tf: Dict[str, int] = {}
        for tok in doc:
            tf[tok] = tf.get(tok, 0) + 1
        dl = len(doc)
        total = 0.0
        for qt in query_toks:
            if qt not in idf:
                continue
            freq = tf.get(qt, 0)
            denom = freq + k1 * (1.0 - b + b * dl / max(avgdl, 1.0))
            total += idf[qt] * (freq * (k1 + 1.0)) / max(denom, 1e-9)
        scores.append(total)
    return scores


def dense_token_scores(query: str, docs: Sequence[str]) -> List[float]:
    """Token-overlap cosine proxy when pgvector embed is unavailable on hot path."""
    q_tokens = set(tokenize_bm25(query))
    if not q_tokens:
        return [0.0] * len(docs)
    q_norm = math.sqrt(len(q_tokens))
    scores: List[float] = []
    for doc in docs:
        d_tokens = set(tokenize_bm25(str(doc or "")))
        if not d_tokens:
            scores.append(0.0)
            continue
        overlap = len(q_tokens & d_tokens)
        scores.append(overlap / max(q_norm * math.sqrt(len(d_tokens)), 1e-9))
    return scores


def rank_indices(scores: Sequence[float]) -> List[int]:
    return sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)


def reciprocal_rank_fusion(
    rank_lists: Sequence[Sequence[int]],
    *,
    k: int = 60,
    n_docs: int | None = None,
) -> List[float]:
    """RRF scores per document index (Cormack et al., SIGIR 2009)."""
    if n_docs is None:
        n_docs = 0
        for ranks in rank_lists:
            if ranks:
                n_docs = max(n_docs, max(ranks) + 1)
    if n_docs <= 0:
        return []

    fused = [0.0] * n_docs
    for ranks in rank_lists:
        for rank, doc_idx in enumerate(ranks):
            if 0 <= doc_idx < n_docs:
                fused[doc_idx] += 1.0 / (k + rank + 1)
    return fused


def normalize_rrf_base(
    fused: Sequence[float],
    *,
    max_pts: float = 48.0,
    rrf_k: int = 60,
) -> float:
    """Scale top RRF by theoretical dual-rank-1 ceiling (not identity)."""
    if not fused:
        return 0.0
    top = max(fused)
    if top <= 0:
        return 0.0
    ceiling = 2.0 / (rrf_k + 1)
    return max_pts * min(1.0, top / max(ceiling, 1e-9))


def absolute_match_quality(
    bm25_top: float,
    dense_top: float,
    *,
    query_token_count: int,
) -> float:
    """0..1 gate so rank-consensus alone cannot yield a max hybrid base.

    Dense is cosine-like (~0..1). BM25 is unbounded; normalize by query length.
    Weak shared tokens stay well below 1.0.
    """
    q_len = max(int(query_token_count), 1)
    dense_q = min(1.0, max(0.0, float(dense_top)) / 0.32)
    bm25_q = min(1.0, max(0.0, float(bm25_top)) / max(6.0, q_len * 0.55))
    quality = 0.5 * dense_q + 0.5 * bm25_q
    return max(0.05, min(1.0, quality))


def build_relevance_corpus(
    profile: Dict[str, Any],
    resume_rows: Sequence[Dict[str, Any]] | None = None,
    *,
    strip_wrapper=None,
) -> List[str]:
    """Career-unit aware chunks for BM25 / dense rank."""
    chunks: List[str] = []

    for unit in profile.get("evidence_units") or []:
        if not isinstance(unit, dict):
            continue
        ev = str(unit.get("evidence") or unit.get("content") or "").strip()
        if ev:
            chunks.append(ev[:1200])

    for bullet in profile.get("experience_bullets") or []:
        bit = str(bullet).strip()
        if bit:
            chunks.append(bit[:800])

    skills_blob = " ".join(str(x) for x in (profile.get("skills") or [])[:30])
    tools_blob = " ".join(str(x) for x in (profile.get("tools") or [])[:24])
    if skills_blob or tools_blob:
        chunks.append(f"skills: {skills_blob} tools: {tools_blob}".strip()[:1000])

    blob = str(profile.get("_text_blob") or "").strip()
    if blob:
        chunks.append(blob[:2400])

    for row in resume_rows or []:
        body = str(row.get("content_text") or row.get("ai_summary") or "")
        if strip_wrapper is not None:
            body = strip_wrapper(body)
        body = body.strip()
        if body:
            chunks.append(body[:2000])

    # Dedupe near-identical chunks
    seen: set[str] = set()
    out: List[str] = []
    for c in chunks:
        key = c.lower()[:120]
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out[:24]


def hybrid_relevance_base(
    query: str,
    profile: Dict[str, Any],
    resume_rows: Sequence[Dict[str, Any]] | None = None,
    *,
    strip_wrapper=None,
    rrf_k: int = 60,
    max_pts: float = 48.0,
) -> Tuple[float, Dict[str, Any]]:
    """RRF(BM25, dense) scaled to 0..max_pts, gated by absolute match quality.

    Rank consensus alone used to always hit max_pts (any corpus has a #1 in each
    list). Quality gate keeps weak / title-overlap queries well below the ceiling.
    """
    corpus = build_relevance_corpus(profile, resume_rows, strip_wrapper=strip_wrapper)
    if not corpus or not (query or "").strip():
        return 0.0, {
            "chunkCount": len(corpus),
            "rrfTop": 0.0,
            "bm25Top": 0.0,
            "denseTop": 0.0,
            "quality": 0.0,
        }

    bm25 = bm25_scores(query, corpus)
    dense = dense_token_scores(query, corpus)
    bm25_rank = rank_indices(bm25)
    dense_rank = rank_indices(dense)
    fused = reciprocal_rank_fusion([bm25_rank, dense_rank], k=rrf_k, n_docs=len(corpus))
    top_rrf = max(fused) if fused else 0.0
    # Scale: theoretical max RRF when doc is rank-0 in both lists
    rrf_ceiling = 2.0 / (rrf_k + 1)
    rrf_frac = min(1.0, top_rrf / max(rrf_ceiling, 1e-9))
    bm25_top = max(bm25) if bm25 else 0.0
    dense_top = max(dense) if dense else 0.0
    quality = absolute_match_quality(
        bm25_top,
        dense_top,
        query_token_count=len(tokenize_bm25(query)),
    )
    # Sub-linear RRF so dual-rank-1 consensus does not auto-max without quality.
    base = float(max_pts) * (rrf_frac**0.9) * (quality**1.15)

    meta = {
        "chunkCount": len(corpus),
        "rrfTop": round(top_rrf, 6),
        "bm25Top": round(bm25_top, 4),
        "denseTop": round(dense_top, 4),
        "quality": round(quality, 4),
        "rrfFrac": round(rrf_frac, 4),
        "maxPts": max_pts,
        "topChunkPreview": corpus[bm25_rank[0]][:120] if bm25_rank else "",
    }
    return base, meta
