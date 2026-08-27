# ATS pipeline ↔ Autoro Hunt: symbiosis + recruiter reverse bridge

Elevate, don't rewrite. Maps the Senior AI/ML ATS research brief onto the **existing** Job Responder stack (compact profile, semantic grid, hybrid BM25+RRF, CRAG-lite, TOOL/DOMAIN PIN) and documents hooks for the **next** product: recruiter reverse resume ranking.

Related: [README](./README.md) · [rag-ats-optimization-playbook.md](./rag-ats-optimization-playbook.md) · [gemini-rag.md](./gemini-rag.md)

---

## 1. Research internalized (modern ATS = NLP/IR)

Modern ATS is not a keyword black box. It is an NLP/IR pipeline:

**unstructured resume → normalized DB profile → rank vs JD**

Core ideas from the brief + literature:

| Idea | Practice |
|------|----------|
| Layout-aware text extraction | PDF/OCR → plain text career units |
| Sequence tagging NER | BIO spans: skills, titles, orgs, dates, education |
| Taxonomy normalization | Map raw phrases → ESCO / O*NET (e.g. «PostgreSQL DBA» → Database Administrator + SQL cluster) |
| Hard filters | Boolean / SQL must-haves (visa, years, location) |
| Semantic ranking | Sparse BM25/TF-IDF + dense SBERT cosine + Cross-Encoder on top-k |

**5 stages (canonical):**

1. **Text Extraction & Layout** - PyMuPDF / pdfminer / OCR  
2. **Sequence Tagging NER** - BiLSTM-CRF / RoBERTa / spaCy  
3. **Taxonomy Normalization** - ESCO / O*NET / FastText / Vector DB  
4. **Hard Filtering** - SQL / Boolean  
5. **Semantic Scoring & Ranking** - BM25 + vector + Cross-Encoder (cosine on embeddings)

**Hybrid retrieve formula:** sparse BM25/Boolean ∪ dense SBERT cosine → fuse ranks (RRF) → optional Cross-Encoder re-rank on top-k.

**Citations (keep for roadmap):**

- Alonso 2025 - O*NET-oriented ATS normalization  
- Kumar 2025 - AI-ATS pipelines  
- Riabchenko 2022 - ESCO + SBERT matching  
- Gaur 2021 - NER on resumes  
- Official: [ESCO](https://esco.ec.europa.eu/) · [O*NET](https://www.onetcenter.org/database.html)

**Stack prefs (research):** FastAPI, Pydantic, spaCy/transformers, sentence-transformers, pgvector/Qdrant + BM25.

**Autoro Hunt constraints (product):** FastAPI + Pydantic + pgvector + in-memory BM25 already; **no** heavy spaCy/transformers on Cloudflare generate hot path; CE offline only; Qdrant **not** replacing pgvector this turn.

---

## 2. Stage mapping: brief ↔ Autoro Hunt

| ATS stage | Research ideal | Autoro Hunt today | Gap / note |
|-----------|----------------|-------------------|------------|
| **1 Extraction** | PyMuPDF / pdfminer / OCR | `kb_file_ingest` + pypdf; screenshots → vision OCR; notes/Drive | Layout/table fidelity weaker than PyMuPDF; career-unit chunking via optimize |
| **2 NER** | spaCy / RoBERTa BIO | Heuristic parse in `job_responder_optimize.extract_evidence_units` + structured profile fields | No neural NER on hot path (intentional) |
| **3 Taxonomy** | ESCO / O*NET IDs | `skill-synonyms.json` + semantic clusters + ESCO **stub** import (`esco_id` nullable); `CandidateProfile` / `SkillItem` contract | Full ESCO API sync later; O*NET crosswalk offline |
| **4 Hard filter** | Boolean must-haves | N/A for cover-letter generate; light gates in relevance calibration | Recruiter reverse will own SQL/Boolean filters |
| **5 Semantic rank** | BM25 + dense + CE | `/relevance`: hybrid BM25+dense RRF + semantic grid boost; CE offline (`JOB_RESPONDER_CE_RERANK`); **generate retrieve**: `job_responder_rag_pack` ranks evidence_units | Dense on hot path = token cosine proxy when embed unavailable; CE not in generate |

```mermaid
flowchart LR
  PDF[CV / notes / OCR] --> S1[Stage1 ingest]
  S1 --> S2[Stage2 heuristic units]
  S2 --> S3[Stage3 synonyms + ESCO stub]
  S3 --> CP[CandidateProfile / compact]
  JD[Vacancy] --> S5[Stage5 hybrid RRF]
  CP --> S5
  S5 --> REL[/relevance score]
  CP --> PACK[RAG context pack]
  JD --> PACK
  PACK --> GEN[generate draft]
  GEN --> HH[HH finalize]
```

---

## 3. Generate RAG scheme (what we elevated)

### 3.1 Retrieve → draft (same ranked evidence family as relevance)

Before LLM draft, generate builds an explicit **RAG context pack**:

| Field | Source |
|-------|--------|
| `top_evidence` | `evidence_units` (fallback: bullets/projects) ranked by BM25+dense RRF vs JD query |
| `tools_matched` | TOOL PIN (JD ∩ KB) |
| `domains_matched` / pin bullets | domain pin |
| `languages` | compact profile languages |

Injected into user prompt as structured **`RESUME EVIDENCE`** (not a PDF dump), alongside lean **RESUME CONTEXT** + CRAG hints. CF budget / provider rotation unchanged.

Code:

- `agent-api/job_responder_rag_pack.py` - pack + format  
- `agent-api/job_responder_schemas.py` - `CandidateProfile`, `JobDescription`, adapters  
- Wired in `job_responder.py` generate (+ Gemini File Search prompt gets the same evidence block)

### 3.2 Profile contract (stage 2–3 shape)

```json
{
  "personal_info": { "email": "...", "telegram": "...", "links": [] },
  "experience": [{ "title_raw": "...", "title_normalized": null, "unit_type": "job", "evidence": "..." }],
  "education": [{ "raw": "..." }],
  "skills": [{ "skill_raw": "google ads", "esco_id": null, "weight": 1.0 }],
  "tools": [],
  "domains": [],
  "languages": [],
  "evidence_units": []
}
```

`merged_profile_to_candidate()` lifts the existing merge dict → this contract (hooks for recruiter reverse + debug `candidateProfileSkills` on generate response).

### 3.3 What we did **not** do

- Replace pgvector with Qdrant  
- Add spaCy/transformers to CF generate  
- Build recruiter UI  
- Full GraphRAG / neural NER  

---

## 4. Recruiter reverse tool (bridge / next product)

**Invert the query:**

| Cover letter (Hunt) | Recruiter reverse |
|---------------------|-------------------|
| Query = JD | Query = JD (same) |
| Corpus = one candidate's evidence | Corpus = **many** `CandidateProfile` / resume rows |
| Output = letter | Output = ranked candidates + scoreBreakdown |

**Reuse as-is:**

1. Hybrid BM25 + dense RRF (`job_responder_hybrid`)  
2. Semantic grid + skill-synonyms / ESCO stubs  
3. Offline Cross-Encoder blend (`job_responder_cross_encoder`)  
4. Pydantic `JobDescription` + `CandidateProfile`  
5. Domain / tool pins as feature boosts  

**Add later:**

1. Stage-4 hard filters (years, geo, must-have skills) as SQL/Boolean pre-filter  
2. `POST /api/v1/recruiter/rank` (or `/job-responder/rank-resumes`) accepting `{ vacancy, resumeIds[] | workspacePool }`  
3. pgvector ANN over resume embeddings at pool scale  
4. Optional spaCy/RoBERTa NER **offline** batch on ingest (not generate)  
5. UI: vacancy paste → ranked shortlist  

**Contract sketch:**

```text
POST /rank-resumes
  JobDescription + CandidateProfile[] | knowledgeItemIds
→ { ranked: [{ candidateId, score, scoreBreakdown, matchedSkills, missingMustHaves }], hardFilteredOut[] }
```

Same RRF math; flip from "score one resume vs JD" to "score N resumes vs one JD".

---

## 5. Verification baseline (prod)

- Extension: Autoro Hunt **v0.9.20**  
- API: `https://swoop.autoro.tech/api/v1/job-responder/...` (test mode ws=1)  
- Recent main: generate timeout/rotation, generalist scoring, TOOL PIN, hybrid calibration, Phase 6 CE+ESCO  

---

## 6. Changelog

| Date | Change |
|------|--------|
| 2026-08-27 | Symbiosis doc + research internalization; `CandidateProfile`/`JobDescription`; generate RAG context pack (RESUME EVIDENCE); recruiter reverse bridge |
