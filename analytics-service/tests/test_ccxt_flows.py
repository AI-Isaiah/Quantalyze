"""Mutation-honest proofs for the PURE ccxt flow adapter (FLOW-03, Phase 76-02).

``services.ccxt_flows.ccxt_rows_to_dated_flows`` is the ccxt analog of Deribit's
``deribit_dated_external_flows_usd`` (P75-02) and carries the SAME
silent-corruption risk: a non-stable coin flow valued at 1.0 / a current price /
dropped is a fabricated ±100% day. These tests are written to REDDEN under each
such mutation:

  * OWN-TRANSFER FILTER (per venue): a real deposit + an internal own-transfer →
    ONLY the deposit becomes an ``ExternalFlow``. Neutering the venue filter lets
    the own-transfer leak → the summed F_t moves → RED.
  * EVENT-TIME VALUATION: a non-stable coin is valued at its SAME-UTC-day close
    from the injected ``price_index`` (distinct per-day constants 42000/45000/
    41000). Valuing it at 1.0, at a cross-day close, or at a current price moves
    the flow → RED. No same-day price → fail loud (``NavReconstructionError``).

Author hand-built row-list fixtures fed to the PURE function — no vcr, no
network — mirroring the P75 fixture discipline (RESEARCH: the cleanest
revert-proof proof).
"""
from __future__ import annotations

import inspect
import re
from datetime import datetime, timezone
from typing import Any

import pytest

from services.ccxt_flows import ccxt_rows_to_dated_flows
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError


# --------------------------------------------------------------------------- #
# Fixture helpers — deterministic UTC-day timestamps + day keys.
# --------------------------------------------------------------------------- #
def _ms(year: int, month: int, day: int) -> int:
    """Epoch-MILLISECONDS at NOON UTC of the given calendar day (ccxt carries ms;
    noon keeps the fixture away from any midnight tz-boundary ambiguity)."""
    return int(
        datetime(year, month, day, 12, 0, tzinfo=timezone.utc).timestamp() * 1000
    )


def _day(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def _row(**kw: Any) -> dict[str, Any]:
    """A minimal ccxt unified-transaction row; callers override the fields the
    behavior under test cares about."""
    base: dict[str, Any] = {
        "id": "row",
        "type": "deposit",
        "currency": "USDT",
        "amount": 1000.0,
        "timestamp": _ms(2024, 1, 1),
        "internal": None,
        "info": {},
    }
    base.update(kw)
    return base


# Distinct per-day BTC closes so a cross-day / 1.0 / current substitution moves
# the valued flow (mirror 75-01's 42000/45000/41000 discipline).
_BTC_INDEX = {
    (_day(2024, 1, 1), "BTC"): 42000.0,
    (_day(2024, 1, 2), "BTC"): 45000.0,
    (_day(2024, 1, 3), "BTC"): 41000.0,
}


# --------------------------------------------------------------------------- #
# OWN-TRANSFER FILTER — one mutation-honest fixture per venue.
# --------------------------------------------------------------------------- #
def test_binance_own_transfer_excluded_only_deposit_survives() -> None:
    """Binance: an internal own-transfer (``internal is True``, transferType==1)
    is dropped; only the real external deposit (``internal is False``) becomes an
    F_t. MUTATION: neutering the ``internal is False`` filter lets the 5000 own-
    transfer leak → the flow becomes 6000 → RED."""
    rows = [
        _row(
            id="dep",
            type="deposit",
            amount=1000.0,
            internal=False,
            info={"transferType": 0},
        ),
        _row(
            id="own",
            type="deposit",
            amount=5000.0,
            internal=True,
            info={"transferType": 1},
        ),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="binance", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 1000.0)]


def test_bybit_own_transfer_uses_raw_withdrawtype_not_internal() -> None:
    """Bybit: ccxt leaves ``internal=None``, so the filter MUST read raw
    ``info.withdrawType`` ('0'=on-chain). A deposit is on-chain by nature (kept);
    an on-chain withdrawal (withdrawType '0') is kept; an off-chain/internal
    withdrawal (withdrawType '1') is dropped. Net = +2000 − 300 = 1700.
    MUTATION: neutering the filter leaks the 800 off-chain withdrawal → 900 → RED;
    copying Binance's ``internal is False`` drops everything (None is not False)."""
    rows = [
        _row(id="dep", type="deposit", amount=2000.0, internal=None, info={}),
        _row(
            id="onchain",
            type="withdrawal",
            amount=300.0,
            internal=None,
            info={"withdrawType": "0"},
        ),
        _row(
            id="offchain",
            type="withdrawal",
            amount=800.0,
            internal=None,
            info={"withdrawType": "1"},
        ),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="bybit", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 1700.0)]


def test_okx_structural_external_keeps_none_internal_rows() -> None:
    """OKX: the deposit/withdraw-history endpoints are structurally external-only,
    and ccxt leaves ``internal=None`` on every row. The filter must KEEP those
    rows (deposit +3000, withdrawal −500 → 2500). MUTATION: wrongly applying
    Binance's ``internal is False`` to OKX drops every None-internal row → empty
    flows → RED."""
    rows = [
        _row(id="dep", type="deposit", amount=3000.0, internal=None, info={}),
        _row(id="wd", type="withdrawal", amount=500.0, internal=None, info={}),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 2500.0)]


# --------------------------------------------------------------------------- #
# MED-1 / LOW-2 — an UNCLASSIFIABLE (None/missing) internal marker is EXTERNAL.
# The anti-overstatement direction: only an EXPLICITLY-internal row is excluded.
# --------------------------------------------------------------------------- #
def test_binance_none_internal_deposit_is_kept_as_external() -> None:
    """MED-1 (OVERSTATEMENT direction): a Binance deposit with ``internal=None``
    (Binance omits transferType) must be KEPT as +F_t. Pre-fix ``internal is
    False`` DROPPED it — silently overstating the deposit as performance.
    MUTATION: reverting to ``is False`` drops the 10000 deposit → empty → RED."""
    rows = [_row(id="dep", type="deposit", currency="USDT", amount=10_000.0,
                 internal=None, info={})]
    flows = ccxt_rows_to_dated_flows(rows, venue="binance", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 10_000.0)]


def test_binance_none_internal_withdrawal_is_kept_as_external() -> None:
    """LOW-2 (UNDERSTATEMENT direction): a Binance withdrawal with
    ``internal=None`` must be KEPT as −F_t. Pre-fix ``is False`` dropped it,
    understating the cash-out. MUTATION: ``is False`` → dropped → RED."""
    rows = [_row(id="wd", type="withdrawal", currency="USDT", amount=4_000.0,
                 internal=None, info={})]
    flows = ccxt_rows_to_dated_flows(rows, venue="binance", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), -4_000.0)]


def test_binance_explicit_internal_is_still_excluded() -> None:
    """Only an EXPLICITLY internal (``internal is True``) Binance row is dropped —
    the anti-overstatement stance keeps ambiguity, not real own-transfers."""
    rows = [
        _row(id="dep", type="deposit", currency="USDT", amount=1_000.0,
             internal=None, info={}),
        _row(id="own", type="deposit", currency="USDT", amount=5_000.0,
             internal=True, info={"transferType": 1}),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="binance", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 1_000.0)]


def test_bybit_missing_withdrawtype_is_kept_as_external() -> None:
    """LOW-2 (bybit): a withdrawal with a MISSING withdrawType (info absent the
    key) must be KEPT as −F_t. Pre-fix ``str(withdraw_type) == '0'`` required an
    explicit '0' and DROPPED the missing case — understating a real cash-out.
    MUTATION: requiring ``== '0'`` drops the 800 withdrawal → empty → RED."""
    rows = [_row(id="wd", type="withdrawal", currency="USDT", amount=800.0,
                 internal=None, info={})]
    flows = ccxt_rows_to_dated_flows(rows, venue="bybit", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), -800.0)]


def test_bybit_explicit_internal_withdrawtype_still_excluded() -> None:
    """Only an EXPLICITLY internal bybit withdrawal (``withdrawType == '1'``) is
    dropped; an on-chain '0' and a missing marker are both kept."""
    rows = [
        _row(id="onchain", type="withdrawal", currency="USDT", amount=300.0,
             internal=None, info={"withdrawType": "0"}),
        _row(id="offchain", type="withdrawal", currency="USDT", amount=800.0,
             internal=None, info={"withdrawType": "1"}),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="bybit", price_index={})
    # on-chain −300 kept, off-chain −800 excluded → net −300.
    assert flows == [ExternalFlow(_day(2024, 1, 1), -300.0)]


# --------------------------------------------------------------------------- #
# EVENT-TIME VALUATION — non-stable coin at same-UTC-day close, fail-loud.
# --------------------------------------------------------------------------- #
def test_non_stable_valued_at_same_utc_day_close() -> None:
    """A BTC deposit on 2024-01-02 is valued at that day's close (45000), NOT at
    1.0, NOT at the most-recent (41000), NOT at a cross-day close. 0.5 * 45000 =
    22500. MUTATION: 1.0 → 0.5; current/last (41000) → 20500; day-1 (42000) →
    21000 — all ≠ 22500 → RED."""
    rows = [
        _row(
            id="btc",
            type="deposit",
            currency="BTC",
            amount=0.5,
            timestamp=_ms(2024, 1, 2),
            internal=None,
        ),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index=_BTC_INDEX)
    assert flows == [ExternalFlow(_day(2024, 1, 2), 22500.0)]


def test_non_stable_uses_the_days_own_close_per_day() -> None:
    """Two BTC deposits on different days each pick THEIR day's close — proving
    the per-day key, not a single price. 1 BTC on 01-01 (42000) + 1 BTC on 01-03
    (41000). MUTATION: a cross-day/most-recent substitution collapses both to one
    price → RED."""
    rows = [
        _row(id="a", currency="BTC", amount=1.0, timestamp=_ms(2024, 1, 1),
             internal=None),
        _row(id="b", currency="BTC", amount=1.0, timestamp=_ms(2024, 1, 3),
             internal=None),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index=_BTC_INDEX)
    assert flows == [
        ExternalFlow(_day(2024, 1, 1), 42000.0),
        ExternalFlow(_day(2024, 1, 3), 41000.0),
    ]


def test_stablecoin_valued_at_one_without_touching_price_index() -> None:
    """A stablecoin flow is valued at 1.0 and NEVER routed through the price
    index (an EMPTY index still succeeds). MUTATION: routing a stablecoin through
    the index KeyErrors → RED; using anything other than 1.0 moves the flow."""
    for stable in ("USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"):
        rows = [_row(currency=stable, amount=1234.0, internal=None)]
        flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
        assert flows == [ExternalFlow(_day(2024, 1, 1), 1234.0)], stable


def test_non_stable_without_same_day_price_fails_loud() -> None:
    """A BTC deposit on a day the index has no BTC close FAILS LOUD — never 1.0,
    never a current price, never dropped. MUTATION: any silent fallback returns a
    flow instead of raising → RED."""
    rows = [
        _row(id="orphan", currency="BTC", amount=0.5, timestamp=_ms(2024, 1, 5),
             internal=None),
    ]
    with pytest.raises(NavReconstructionError, match="no same-UTC-day"):
        ccxt_rows_to_dated_flows(rows, venue="okx", price_index=_BTC_INDEX)


# --------------------------------------------------------------------------- #
# SIGN + accumulation.
# --------------------------------------------------------------------------- #
def test_withdrawal_is_negative_deposit_positive() -> None:
    """Sign is trusted from the ccxt ``type`` (deposit +, withdrawal −), the
    ``amount`` supplying magnitude only. MUTATION: dropping the sign, or re-
    deriving it, flips the withdrawal."""
    rows = [
        _row(id="d", type="deposit", currency="USDT", amount=1000.0,
             internal=None),
        _row(id="w", type="withdrawal", currency="USDT", amount=250.0,
             internal=None),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 750.0)]


def test_same_utc_day_multi_flow_collapses_to_one_entry() -> None:
    """Multiple same-UTC-day flows sum into ONE ExternalFlow (dict-by-day, like
    the Deribit producer)."""
    rows = [
        _row(id="a", currency="USDT", amount=100.0, internal=None),
        _row(id="b", currency="USDT", amount=200.0, internal=None),
        _row(id="c", type="withdrawal", currency="USDT", amount=50.0,
             internal=None),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 250.0)]


# --------------------------------------------------------------------------- #
# Fail-loud schema-drift guards (mirror the Deribit _MISSING discipline).
# --------------------------------------------------------------------------- #
def test_missing_amount_fails_loud() -> None:
    """An absent ``amount`` field is schema drift — coalescing absent→0.0 would
    silently DROP a real capital flow and mis-anchor the TWR base. Fail loud."""
    row = _row(currency="USDT", internal=None)
    del row["amount"]
    with pytest.raises(NavReconstructionError, match="amount"):
        ccxt_rows_to_dated_flows([row], venue="okx", price_index={})


@pytest.mark.parametrize("bad", [None, "", "   "])
def test_null_or_blank_amount_fails_loud(bad: Any) -> None:
    """A present-but-null/blank ``amount`` is schema drift too — it must NOT
    coalesce to a silent 0.0 dropped flow."""
    rows = [_row(currency="USDT", amount=bad, internal=None)]
    with pytest.raises(NavReconstructionError, match="amount"):
        ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})


def test_zero_amount_is_a_noop_skip_no_price_needed() -> None:
    """A numeric 0.0 amount is a legitimate observed-no-cash no-op: no entry, and
    NO price lookup (so a non-stable 0.0 with an EMPTY index does NOT fail loud)."""
    rows = [
        _row(id="z", currency="BTC", amount=0.0, internal=None),
        _row(id="real", currency="USDT", amount=500.0, internal=None),
    ]
    flows = ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})
    assert flows == [ExternalFlow(_day(2024, 1, 1), 500.0)]


def test_unknown_venue_fails_loud() -> None:
    with pytest.raises(NavReconstructionError, match="unknown venue"):
        ccxt_rows_to_dated_flows([], venue="kraken", price_index={})


def test_unsignable_type_fails_loud() -> None:
    """A row whose ``type`` is neither deposit nor withdrawal cannot be signed —
    refuse to guess the direction of a capital flow."""
    rows = [_row(type="trade", currency="USDT", amount=100.0, internal=None)]
    with pytest.raises(NavReconstructionError, match="type"):
        ccxt_rows_to_dated_flows(rows, venue="okx", price_index={})


# --------------------------------------------------------------------------- #
# Purity — source-scan (mirrors the external_flows discipline).
# --------------------------------------------------------------------------- #
def test_module_is_pure_no_io_imports() -> None:
    """``ccxt_flows`` does the valuation MATH only: no ccxt, no pandas/numpy, no
    network/file I/O in its own source. It may import ONLY the pure shared
    contract modules (external_flows, closed_sets, deribit_txn, nav_twr)."""
    src = inspect.getsource(__import__("services.ccxt_flows", fromlist=["_"]))
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
        r"\bopen\s*\(",
    )
    for pattern in forbidden:
        assert re.search(pattern, src) is None, f"forbidden token {pattern!r}"
    # Any `from services.` import must target ONLY the pure contract modules.
    allowed = {"external_flows", "closed_sets", "deribit_txn", "nav_twr"}
    for mod in re.findall(r"from\s+services\.(\w+)\s+import", src):
        assert mod in allowed, f"ccxt_flows imports non-contract service {mod!r}"
