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

from services.external_flows import USD_FAMILY, ExternalFlow, validate_flow_shape


def test_unpacks_positionally_as_day_usd() -> None:
    """``day_raw, usd_raw = flow[0], flow[1]`` — the EXACT indexed access nav_twr
    does after the Phase 79-01 native-channel extension. A withdrawal is negative;
    the first two fields round-trip byte-for-byte, and a legacy 2-arg construction
    fills the native channel with byte-identical defaults."""
    flow = ExternalFlow("2026-03-14", -42000.0)
    day_raw, usd_raw = flow[0], flow[1]  # the core's indexed access (nav_twr.py:201)
    assert day_raw == "2026-03-14"
    assert usd_raw == -42000.0
    # The first two fields are still exactly (day, usd); the native channel carries
    # the defaults so every existing producer stays byte-identical.
    assert tuple(flow) == ("2026-03-14", -42000.0, "USD", None)
    assert flow.currency == "USD"
    assert flow.quantity is None


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


# ---------------------------------------------------------------------------
# Phase 79-01: (currency, quantity) extension + USD_FAMILY (SC-2 / SC-3).
# ---------------------------------------------------------------------------


def test_four_field_validate_shape_passthrough() -> None:
    """A 4-field ``ExternalFlow`` (native channel populated) passes shape
    validation and is returned UNCHANGED. RED today: ``day, usd = flow`` unpacks
    a 4-field NamedTuple → ``ValueError: too many values to unpack``."""
    flow = ExternalFlow("2026-01-02", -500.0, "BTC", -0.012)
    assert validate_flow_shape(flow) is flow
    assert flow.currency == "BTC"
    assert flow.quantity == -0.012


def test_legacy_defaults_byte_identical() -> None:
    """A 2-arg positional construction (the deribit_txn.py:670 /
    ccxt_flows.py:295 producers) fills ``currency='USD'`` and ``quantity=None`` —
    every existing producer stays byte-identical via the defaults."""
    flow = ExternalFlow("2026-03-14", -42000.0)
    assert flow.currency == "USD"
    assert flow.quantity is None
    # A legacy flow still unpacks as its first two fields and round-trips its
    # (day, usd) meaning for existing 2-unpack consumers via indexed access.
    assert flow[0] == "2026-03-14"
    assert flow[1] == -42000.0


def test_validate_flow_shape_extended_currency_and_quantity() -> None:
    """Extended shape checks: reject empty / non-UPPERCASE ``currency`` and a
    non-finite ``quantity``; accept ``quantity=None`` (legacy) and finite floats.
    Still shape-only — the flow is returned unchanged on success."""
    ok_native = ExternalFlow("2026-01-02", -500.0, "BTC", -0.012)
    assert validate_flow_shape(ok_native) is ok_native
    ok_legacy = ExternalFlow("2026-01-02", -500.0)  # quantity=None accepted
    assert validate_flow_shape(ok_legacy) is ok_legacy

    with pytest.raises(ValueError):
        validate_flow_shape(ExternalFlow("2026-01-02", -500.0, "", None))
    with pytest.raises(ValueError):
        validate_flow_shape(ExternalFlow("2026-01-02", -500.0, "btc", None))
    for bad_qty in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError):
            validate_flow_shape(ExternalFlow("2026-01-02", -500.0, "BTC", bad_qty))


def test_usd_family_membership() -> None:
    """The ONE USD-family frozenset lives here and is exactly the five USD-family
    settlement currencies (DAI added — behavior-neutral for Deribit, §3.2)."""
    assert USD_FAMILY == frozenset({"USD", "USDC", "USDT", "EURR", "DAI"})


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
