"""FLOW-01 contract tests for services.external_flows (Phase 75 Wave 0).

The venue-agnostic dated-flow contract MUST be a drop-in for the core's
positional unpack ``day_raw, usd_raw = flow`` (``nav_twr._flows_to_daily_usd``,
nav_twr.py:123-129). These tests pin:

  * positional unpack yields exactly ``(utc_day_iso, usd_signed)`` — the shape
    the core already consumes and the Phase 76 ccxt adapters will emit verbatim;
  * named field access returns the two members;
  * the OPTIONAL shape-only validator rejects a non-finite ``usd_signed`` and an
    empty ``utc_day_iso`` (it does NOT re-implement the core's business coerce);
  * the module is PURE — a source-scan finds no ccxt / pandas / I/O imports
    (mirrors the deribit_txn.py import discipline).
"""
from __future__ import annotations

import inspect
import re

import pytest

from services.external_flows import ExternalFlow, validate_flow_shape


def test_unpacks_positionally_as_day_usd() -> None:
    """``day_raw, usd_raw = flow`` — the EXACT unpack nav_twr does. A withdrawal
    is negative; the pair round-trips byte-for-byte."""
    flow = ExternalFlow("2026-03-14", -42000.0)
    day_raw, usd_raw = flow  # the core's positional unpack (nav_twr.py:124)
    assert day_raw == "2026-03-14"
    assert usd_raw == -42000.0
    # A NamedTuple is also a real 2-tuple → drop-in anywhere a (day, usd) is.
    assert tuple(flow) == ("2026-03-14", -42000.0)
    assert len(flow) == 2


def test_named_field_access() -> None:
    """The two members are addressable by name (deposit positive)."""
    flow = ExternalFlow(utc_day_iso="2026-03-15", usd_signed=50000.0)
    assert flow.utc_day_iso == "2026-03-15"
    assert flow.usd_signed == 50000.0


def test_validate_shape_accepts_valid_pairs() -> None:
    """A valid deposit and a valid withdrawal both pass shape validation and are
    returned unchanged (identity — no coercion/mutation)."""
    deposit = ExternalFlow("2026-03-14", 50000.0)
    withdrawal = ExternalFlow("2026-03-14", -0.5 * 42000.0)
    assert validate_flow_shape(deposit) is deposit
    assert validate_flow_shape(withdrawal) is withdrawal


@pytest.mark.parametrize("bad_usd", [float("nan"), float("inf"), float("-inf")])
def test_validate_shape_rejects_non_finite_usd(bad_usd: float) -> None:
    """A non-finite ``usd_signed`` (NaN/±inf) is rejected — it would sail past
    every downstream NAV denominator guard as a silent NaN (T-75-01)."""
    with pytest.raises(ValueError):
        validate_flow_shape(ExternalFlow("2026-03-14", bad_usd))


@pytest.mark.parametrize("bad_day", ["", "   "])
def test_validate_shape_rejects_empty_day(bad_day: str) -> None:
    """An empty / whitespace ``utc_day_iso`` is rejected — a flow we cannot key
    onto a UTC day is realized cash we would otherwise silently misplace."""
    with pytest.raises(ValueError):
        validate_flow_shape(ExternalFlow(bad_day, 100.0))


def test_module_is_pure_no_io_imports() -> None:
    """Source-scan: the contract imports nothing beyond stdlib/typing — no ccxt,
    no pandas, no os/requests/httpx, no file/network I/O. Mirrors the
    deribit_txn.py discipline so Phase 76 ccxt adapters import it inert."""
    src = inspect.getsource(
        __import__("services.external_flows", fromlist=["_"])
    )
    forbidden = (
        r"\bimport\s+ccxt\b",
        r"\bimport\s+pandas\b",
        r"\bimport\s+numpy\b",
        r"\bimport\s+os\b",
        r"\bimport\s+sys\b",
        r"\bimport\s+requests\b",
        r"\bimport\s+httpx\b",
        r"\bimport\s+socket\b",
        r"\bimport\s+subprocess\b",
        r"\bfrom\s+services\.",  # no coupling to I/O service modules
        r"\bopen\s*\(",
    )
    for pattern in forbidden:
        assert re.search(pattern, src) is None, f"forbidden token {pattern!r} in external_flows.py"
