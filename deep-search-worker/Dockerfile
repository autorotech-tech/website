FROM python:3.12-slim

WORKDIR /app

# System deps for trafilatura/lxml
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2-dev libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# NOTE: cross-encoder model downloads lazily on first use (avoids build-time hang)

COPY . .

EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
