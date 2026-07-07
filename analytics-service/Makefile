# analytics-service — local dev / CI lint targets.
#
# Phase 19 / BACKBONE-02 / MC-3 fix (per 19-REVIEWS.md): the
# IngestionAdapter Protocol uses `@runtime_checkable`, which only
# verifies METHOD PRESENCE at runtime — NOT signature shape. A
# typo like `validate(req)` vs `validate(request)` would slip past
# the isinstance check at runtime and only surface as a TypeError
# at the first /process-key call. mypy --strict catches that drift
# at type-check time before the test pipeline even runs.
#
# Scoped via --follow-imports=silent so the strict pass applies ONLY
# to services/ingestion/; the wider analytics-service codebase has
# legacy untyped surface that is migrated incrementally.

PYTHON ?= python3
VENV   ?= .venv
PIP     = $(VENV)/bin/pip
PY      = $(VENV)/bin/python
MYPY    = $(VENV)/bin/mypy
PYTEST  = $(VENV)/bin/pytest

.PHONY: help install rebuild-venv lock lint typecheck test ci

help:
	@echo "Targets:"
	@echo "  install   — create .venv on Python 3.12 (if missing) + pip install deps (matches CI)"
	@echo "  rebuild-venv — force a clean 3.12 venv rebuild (fixes a 3.13/3.14 segfault venv)"
	@echo "  lock      — regenerate requirements.txt (the pinned lock) from requirements.in"
	@echo "  lint      — mypy --strict on services/ingestion/ (MC-3 fix; the current CI gate)"
	@echo "  typecheck — mypy on the full B-mypy floor surface (services/ routers/ models/)"
	@echo "  test      — pytest with coverage (matches CI ci.yml)"
	@echo "  ci        — full local CI gauntlet: lint + test"

# tech-debt #7: requirements.txt is a generated lock; requirements.in is the
# source. Always compile against 3.12 (CI/prod) and --universal so the lock
# installs on both mac (dev) and linux (CI/Railway). Needs `uv` on PATH. After
# editing requirements.in (e.g. a Dependabot bump), run this and commit the lock.
lock:
	uv pip compile requirements.in --python-version 3.12 --universal -o requirements.txt

# Create the local venv on the CI/prod Python (3.12 — pinned in .python-version).
# WHY pinned: Python 3.13/3.14 segfault the numpy/pandas/scipy/pyarrow native
# stack, and `python3` is 3.14 on some dev machines — a bare `python3 -m venv`
# then produces a venv whose test run crashes on import. `uv` fetches 3.12 if
# absent. Idempotent (a directory target): only runs when .venv is missing;
# `make rebuild-venv` forces a clean 3.12 rebuild.
$(VENV):
	uv venv --python 3.12 $(VENV)

rebuild-venv:
	uv venv --python 3.12 --clear $(VENV)
	$(PIP) install -r requirements.txt -r requirements-dev.txt

install: $(VENV)
	# Single source of truth for dev/test deps: requirements-dev.txt carries the
	# test tooling (pytest*, cryptography, mypy) AND the TEST-ONLY runtime deps
	# (quantstats reference + pyarrow for the golden parquet fixture, H-0537).
	# Byte-for-byte the install ci.yml / cassette-refresh.yml run, so `make test`
	# matches CI and the parquet fixture loads.
	$(PIP) install -r requirements.txt -r requirements-dev.txt

lint:
	$(MYPY) --strict --follow-imports=silent services/ingestion/

# B-mypy: the full type-safety floor. Flags come from pyproject.toml
# [tool.mypy] (auto-discovered from cwd), so this is byte-for-byte the
# command the CI gate runs once widened (ci.yml mypy step). Run this to
# match CI exactly.
typecheck:
	$(MYPY) services/ routers/ models/

test:
	$(PYTEST) --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80

ci: lint test
