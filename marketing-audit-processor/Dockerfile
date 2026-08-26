FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY processor.py /app/processor.py

# requests — Supabase/HTTP, pandas + openpyxl — работа с CSV/XLSX, psycopg2-binary — прямой доступ к Postgres, pyjwt — генерация JWT для Storage API, PyPDF2 — извлечение текста из PDF
RUN pip install --no-cache-dir requests pandas openpyxl psycopg2-binary pyjwt cryptography PyPDF2

CMD ["python", "/app/processor.py"]


