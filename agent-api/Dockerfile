FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn[standard] psycopg2-binary

COPY main.py hermes_media.py swoop_provider_catalog.py swoop_lmarena.py swoop_expired_domains.py ./

EXPOSE 8900

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8900"]
