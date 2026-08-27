FROM pyd4vinci/scrapling:latest

ENV PYTHONUNBUFFERED=1
ENV PATH="/app/.venv/bin:$PATH"
ENV VIRTUAL_ENV="/app/.venv"

COPY worker.py /app/worker.py

RUN uv pip install --no-cache psycopg2-binary pyjwt cryptography requests playwright pyyaml

ENTRYPOINT []
CMD ["python", "/app/worker.py"]
