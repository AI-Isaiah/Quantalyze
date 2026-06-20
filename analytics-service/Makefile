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
	@echo "  install   — pip install -r requirements.txt -r requirements-dev.txt (matches CI)"
	@echo "  lint      — mypy --strict on services/ingestion/ (MC-3 fix; the current CI gate)"
	@echo "  typecheck — mypy on the full B-mypy floor surface (services/ routers/ models/)"
	@echo "  test      — pytest with coverage (matches CI ci.yml)"
	@echo "  ci        — full local CI gauntlet: lint + test"

install:
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
