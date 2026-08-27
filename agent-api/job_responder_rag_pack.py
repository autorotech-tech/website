"""RAG context pack for cover-letter generate (ATS stages 3+5 light path).

Ranks evidence_units by JD overlap (BM25 + dense token RRF) and packs
TOOL PIN / domain pin / languages into a structured RESUME EVIDENCE block.
No spaCy / transformers on the CF hot path.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

from job_responder_hybrid import (
    bm25_scores,
    dense_token_scores,
    rank_indices,
    reciprocal_rank_fusion,
    tokenize_bm25,
)


def build_jd_query(
    *,
    title: str = "",
    description: str = "",
    key_skills: Optional[Sequence[str]] = None,
    domains: Optional[Sequence[str]] = None,
) -> str:
    parts = [
        str(title or "").strip(),
        " ".join(str(s) for s in (key_skills or []) if str(s).strip()),
        " ".join(str(d) for d in (domains or []) if str(d).strip()),
        str(description or "").strip()[:2500],
    ]
    return " ".join(p for p in parts if p).strip()


def _unit_doc(unit: Dict[str, Any]) -> str:
    bits = [
        str(unit.get("unit_type") or ""),
        str(unit.get("title") or ""),
        str(unit.get("evidence") or unit.get("content") or ""),
    ]
    return " ".join(b for b in bits if b).strip()[:1200]


def rank_evidence_units_for_jd(
    evidence_units: Sequence[Dict[str, Any]],
    jd_query: str,
    *,
    top_k: int = 8,
    rrf_k: int = 60,
) -> List[Dict[str, Any]]:
    """Stage-5 light retrieve: BM25 + dense-token RRF over career units."""
    units = [u for u in evidence_units if isinstance(u, dict)]
    if not units or not (jd_query or "").strip():
        return []

    docs = [_unit_doc(u) for u in units]
    # Drop empty docs but keep index alignment via filter
    indexed: List[Tuple[int, str]] = [(i, d) for i, d in enumerate(docs) if d.strip()]
    if not indexed:
        return []

    idxs = [i for i, _ in indexed]
    corpus = [d for _, d in indexed]
    bm25 = bm25_scores(jd_query, corpus)
    dense = dense_token_scores(jd_query, corpus)
    fused = reciprocal_rank_fusion(
        [rank_indices(bm25), rank_indices(dense)],
        k=rrf_k,
        n_docs=len(corpus),
    )
    order = rank_indices(fused)
    out: List[Dict[str, Any]] = []
    for rank_pos, local_i in enumerate(order[: max(1, int(top_k))]):
        src = units[idxs[local_i]]
        item = {
            "unit_type": str(src.get("unit_type") or "job")[:32],
            "title": str(src.get("title") or "")[:120],
            "evidence": str(src.get("evidence") or src.get("content") or "")[:400],
            "score": round(float(fused[local_i]), 6),
            "rank": rank_pos + 1,
        }
        if item["evidence"]:
            out.append(item)
    return out


def build_rag_context_pack(
    profile: Dict[str, Any],
    *,
    title: str = "",
    description: str = "",
    key_skills: Optional[Sequence[str]] = None,
    vacancy_domains: Optional[Sequence[str]] = None,
    domain_pin: Optional[Dict[str, Any]] = None,
    tool_pin: Optional[Dict[str, Any]] = None,
    top_k: int = 8,
) -> Dict[str, Any]:
    """Explicit retrieve pack for generate (before draft)."""
    domain_pin = domain_pin or {}
    tool_pin = tool_pin or {}
    jd_query = build_jd_query(
        title=title,
        description=description,
        key_skills=key_skills,
        domains=vacancy_domains,
    )
    units = list(profile.get("evidence_units") or [])
    # Fallback: synthesize units from bullets so pack is never empty when KB has facts
    if not units:
        for b in list(profile.get("experience_bullets") or [])[:16]:
            bit = str(b or "").strip()
            if bit:
                units.append(
                    {
                        "unit_type": "job",
                        "title": bit[:80],
                        "evidence": bit[:400],
                        "content": bit[:400],
                    }
                )
        for p in list(profile.get("projects") or [])[:12]:
            if not isinstance(p, dict):
                continue
            name = str(p.get("name") or "").strip()
            summary = str(p.get("summary") or "").strip()
            bit = " - ".join(x for x in (name, summary) if x)
            if bit:
                units.append(
                    {
                        "unit_type": "project",
                        "title": name[:80] or bit[:80],
                        "evidence": f"project: {bit}"[:400],
                        "content": bit[:400],
                    }
                )

    ranked = rank_evidence_units_for_jd(units, jd_query, top_k=top_k)
    tools = list(tool_pin.get("tools_matched") or tool_pin.get("pinned_names") or [])[:8]
    languages = [str(x) for x in (profile.get("languages") or []) if str(x).strip()][:8]
    pack = {
        "version": 1,
        "jd_query_tokens": len(tokenize_bm25(jd_query)),
        "tools_matched": [str(t) for t in tools],
        "domains_matched": [str(d) for d in (domain_pin.get("domains_matched") or [])][:6],
        "domain_pin_bullets": [str(b) for b in (domain_pin.get("pinned_bullets") or [])][:4],
        "languages": languages,
        "top_evidence": ranked,
        "evidence_count": len(ranked),
    }
    return pack


def format_rag_evidence_block(pack: Dict[str, Any], *, max_chars: int = 1600) -> str:
    """Structured RESUME EVIDENCE for user prompt (not a PDF dump)."""
    if not pack:
        return ""
    lines: List[str] = [
        "RESUME EVIDENCE (ranked for this JD; cite named facts only):",
    ]
    tools = pack.get("tools_matched") or []
    if tools:
        lines.append("- TOOL PIN: " + ", ".join(str(t) for t in tools))
    domains = pack.get("domains_matched") or []
    if domains:
        lines.append("- DOMAIN PIN: " + ", ".join(str(d) for d in domains))
    pins = pack.get("domain_pin_bullets") or []
    for b in pins[:3]:
        lines.append(f"- domain_fact: {b}")
    langs = pack.get("languages") or []
    if langs:
        lines.append("- LANGUAGES: " + ", ".join(str(x) for x in langs))
    evidence = pack.get("top_evidence") or []
    if evidence:
        lines.append("- TOP EVIDENCE:")
        for item in evidence:
            if not isinstance(item, dict):
                continue
            ut = str(item.get("unit_type") or "job")
            ev = str(item.get("evidence") or "").strip()
            if not ev:
                continue
            lines.append(f"  {item.get('rank')}. [{ut}] {ev}")
    text = "\n".join(lines).strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"
