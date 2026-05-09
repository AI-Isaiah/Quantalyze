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

.PHONY: help install lint typecheck test ci

help:
	@echo "Targets:"
	@echo "  install   — pip install -r requirements.txt + dev deps"
	@echo "  lint      — mypy --strict on services/ingestion/ (MC-3 fix)"
	@echo "  typecheck — alias for lint (kept for clarity)"
	@echo "  test      — pytest with coverage (matches CI ci.yml)"
	@echo "  ci        — full local CI gauntlet: lint + test"

install:
	$(PIP) install -r requirements.txt pytest pytest-cov pytest-asyncio pytest-mock cryptography mypy

lint:
	$(MYPY) --strict --follow-imports=silent services/ingestion/

typecheck: lint

test:
	$(PYTEST) --cov=services --cov-report=term-missing --cov-fail-under=80

ci: lint test
