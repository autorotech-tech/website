FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn[standard] psycopg2-binary python-multipart pypdf

COPY main.py job_responder.py job_responder_gemini_rag.py hermes_media.py swoop_provider_catalog.py swoop_lmarena.py swoop_mimo.py swoop_kimi.py swoop_seekai.py swoop_openmodel.py swoop_serpapi.py swoop_groq.py swoop_parsing.py swoop_expired_domains.py kb_file_ingest.py security.py ./

EXPOSE 8900

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8900", "--workers", "2"]
