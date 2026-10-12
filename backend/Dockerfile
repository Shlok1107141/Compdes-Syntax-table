# Backend image: build the C analyzer, then serve it from a slim runtime.
# Build context is the repository root (the engine sources live in engine/).

FROM python:3.12-slim-bookworm AS engine
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev make \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/engine
COPY engine/ ./
RUN make symtab_analyze \
 && printf 'int counter; int counter_max;\n' | ./symtab_analyze > /dev/null

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SYMTAB_ENGINE=/app/bin/symtab_analyze
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/main.py backend/engine.py ./
COPY --from=engine /src/engine/symtab_analyze /app/bin/symtab_analyze

# Unprivileged: the service never needs root, and neither does the analyzer it spawns.
RUN useradd --system --uid 10001 --no-create-home symtab
USER symtab

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
