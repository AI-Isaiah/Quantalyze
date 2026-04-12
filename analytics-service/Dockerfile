# CMD-override note (Sprint 3):
# This image serves BOTH the FastAPI API server (default CMD below) and
# the durable compute_jobs worker. The Railway worker service overrides
# CMD to: python -m main_worker
# which runs the dispatch + watchdog + daily-enqueue asyncio loops.
# The default CMD remains uvicorn for the API service — no change needed
# for existing deployments. Only the worker service's railway.toml (or
# Railway UI) sets the CMD override.

FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer - only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code (changes frequently, but deps layer is cached)
COPY . .

RUN adduser --disabled-password --no-create-home app
USER app

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
