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
	@echo "  lint      — mypy --strict on services/ingestion/ (MC-3 fix; the current CI gate)"
	@echo "  typecheck — mypy on the full B-mypy floor surface (services/ routers/ models/)"
	@echo "  test      — pytest with coverage (matches CI ci.yml)"
	@echo "  ci        — full local CI gauntlet: lint + test"

install:
	$(PIP) install -r requirements.txt pytest pytest-cov pytest-asyncio pytest-mock cryptography mypy

lint:
	$(MYPY) --strict --follow-imports=silent services/ingestion/

# B-mypy: the full type-safety floor. Flags come from pyproject.toml
# [tool.mypy] (auto-discovered from cwd), so this is byte-for-byte the
# command the CI gate runs once widened (ci.yml mypy step). Run this to
# match CI exactly.
typecheck:
	$(MYPY) services/ routers/ models/

test:
	$(PYTEST) --cov=services --cov-report=term-missing --cov-fail-under=80

ci: lint test
