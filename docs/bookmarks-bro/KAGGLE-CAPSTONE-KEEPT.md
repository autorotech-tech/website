# Kaggle Capstone Project: Keept secure knowledge concierge

This document serves as the technical submission report for the Kaggle Capstone Project (Vibe Coding Agents track), demonstrating the integration of Google Intensive AI Agent patterns into **Keep It For Me (Keept)**.

## Core Concepts & Architectural Patterns

Keept is a secure personal knowledge concierge that captures web content, files, and links, screens them for safety, enriches them via LLMs, and syncs them to a private Obsidian vault.

To align with modern production agent standards, we integrated key **Google Intensive** patterns:
1. **Stateful Graph Execution (ADK 2.0)**: Transitioning from linear chains to a DAG-based `Workflow` that supports route-based branching, state checkpoints, and interactive interrupts.
2. **Multi-Agent Collaboration**: Separating responsibilities between specialized agents (Ingestion ➔ Security ➔ Moderator ➔ Classifier/Enricher ➔ Sync).
3. **Advanced Security Filtering**: Ingress screening for PII (redacting emails, SSNs, credit cards, and phone numbers) and Prompt Injection attacks before any content is processed by downstream LLMs or saved.
4. **Human-in-the-Loop (HITL) Interruption**: Pausing workflow execution on security alerts to wait for moderator approval in the Refero Ivory Admin UI, then resuming to complete ingestion.

---

## Agent Flow & Node Topology

The capture graph consists of five critical processing phases:

```
[Ingest Payload] ➔ [Parse & Scrape] 
                         │
                         ▼
             [Security Screen Node]
                         │
        ┌────────────────┴────────────────┐
        ▼ (route: human_review)           ▼ (route: auto_process)
[human_review_node]                [ai_enrich_and_save]
  - Suspends Workflow                - Classifies content (classifier_agent)
  - Waits in Admin UI                - Summarizes content (enricher_agent)
  - Approve ➔ ai_enrich_and_save      - Generates embeddings
  - Reject ➔ reject_capture          - Saves to Postgres DB
                                     - Syncs to Obsidian vault
```

1. **Classifier Agent**: Categorizes incoming documents into semantic labels (`ai-ml`, `dev-tools`, `marketing`, etc.) and tags.
2. **Enrichment Agent**: Synthesizes a clean title and 2-3 bullet point summaries.
3. **Obsidian Sync Coordinator**: Resolves file paths and formats a Markdown note containing frontmatter metadata and redacted text, saving it directly inside the user's Obsidian Vault directory.

---

## Technical Implementation Details

- **Refero Ivory Admin UI**: Built at [KeeptAdminApp.tsx](file:///Users/vlad_x/Desktop/n8n/google%20intensive/AuthRAG/website/src/keeptAdmin/KeeptAdminApp.tsx) using the warm Refero Ivory design theme (`#FAF8F5` background, graphite text, and orange CTAs) to manage the moderation queue.
- **Workflow State Persistence**: Leveraging ADK's `InMemorySessionService` to serialize and store suspended workflows. A workflow suspended at `human_review_node` yields a `session_id`, allowing the Swoop backend or ADK Dev UI to resume it with `decision="approve"` or `decision="reject"`.
- **Hybrid Search**: The retrieval endpoint uses pgvector cosine distance coupled with standard keyword match to return high-relevance items from the knowledge base.

---

## Demonstration Script (3-5 Minutes Video Guide)

To demonstrate the full capability of the secure ingestion pipeline, follow this walk-through:

### Phase 1: Clean Capture (Auto-Ingestion)
1. **Action**: Capture a standard development article.
   - *Input*: `{"url": "https://example.com/fastapi-guide", "text": "This guide teaches you how to construct high performance APIs using Python FastAPI and Uvicorn. We will explore routers, dependencies, and pydantic schemas."}`
2. **Behavior**: The workflow passes the security screening immediately. Downstream LLM classification labels it `dev-tools` and tags it `["fastapi", "python"]`. It is stored as `searchable` and synced to the Obsidian vault.
3. **Verification**: Show the new searchable item inside the Keept UI dashboard.

### Phase 2: Sensitive Ingest & HITL Interruption
1. **Action**: Capture a document containing sensitive PII.
   - *Input*: `{"url": "https://example.com/client-billing", "text": "Contact client at support@company.com or call 123-456-7890. Use billing card 4111-1111-1111-1111. SSN is 123-45-6789."}`
2. **Behavior**: The security screen node redacts the credit card, email, phone number, and SSN to `[REDACTED_...]` tokens. Since PII is redacted, the routing directs to `human_review`.
3. **State**: The workflow suspends at `human_review_node`. The API returns a `pending` status, and a pending approval item is inserted into `capture_moderation_queue`.
4. **Verification**: Navigate to the Keept Admin Moderation queue page `/keept/admin`. Point out the flagged card showing the redacted text and the safety badges `[PII: SSN, credit_card, email, phone]`.

### Phase 3: Resolution & Sync
1. **Action**: Click "Approve" on the moderation item in the Admin UI.
2. **Behavior**: The backend issues a resume command to the ADK session using the session ID with `decision="approve"`. The workflow resumes, runs the enrichment agent, generates embeddings, saves the record as `searchable`, and writes the Markdown note to the Obsidian vault.
3. **Verification**: Show that the note has now successfully loaded in the user's Obsidian directory with full classification tags.
