# CMD note. ⚠️ STALE HEADER CORRECTED 2026-08-26 (phase 163 review, WR-08).
#
# This block described a SEPARATE Railway worker service overriding CMD to
# `python -m main_worker`. That topology is gone — the worker was merged into
# the API process (see `main.py:297`, which logs "Worker starting as ... (merged
# into API)"). There is ONE service and it runs the default CMD below.
#
# Why this mattered enough to fix: this header was the apparent SOURCE for a
# claim elsewhere that `main_worker.py` is a live production entrypoint. It
# made a stale deployment note read as evidence about current production. The
# standalone `python -m main_worker` path still exists and is still worth
# configuring correctly, but it is not what production runs.

FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached layer - only rebuilds when requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# v1.15 MT5 go-live: the mt5linux RPyC client (`from mt5linux import MetaTrader5`,
# lazy import in services/mt5_client.py). Installed --no-deps ON PURPOSE: the 0.1.9
# wheel mis-declares its build toolchain (twine, urllib3==1.26.7, six==1.16.0, …) as
# runtime deps, which conflict with this service's urllib3/six — so it can't go in the
# uv lock. Its only real runtime dep is rpyc (pinned in requirements.txt, 5.x/<6 to
# match the gateway's Wine-side rpyc-5 server; numpy is already present). Pinned 0.1.9:
# 0.1.10+ regressed shell=True Popen usage (see mt5-go-live runbook / gateway constraint).
# HARMLESS: pip logs a conflict warning here ("mt5linux 0.1.9 requires urllib3==1.26.7 /
# six==1.16.0, but you have ...") and the image will fail a `pip check` — both expected,
# non-fatal (exit 0), caused by mt5linux's mis-declared metadata. Do NOT "fix" by
# downgrading urllib3/six; that would break the service. The client only needs rpyc.
RUN pip install --no-cache-dir --no-deps mt5linux==0.1.9

# Copy application code (changes frequently, but deps layer is cached)
COPY . .

RUN adduser --disabled-password --no-create-home app
USER app

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
