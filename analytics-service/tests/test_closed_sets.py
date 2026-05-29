"""B8b — closed-set discipline registry (Python half).

Pins the single-source registry's contracts and the two behaviors that
matter for correctness:

* ``perp_quote`` reproduces the exact prior inline quote derivation that
  lived (twice) in ``_compute_daily_equity`` (golden parity).
* ``_make_fill_dict`` flags — but does not drop — a fill with an
  unrecognized trade side, closing the NEW-C01-09 ingest gap where bad
  sides silently reached ``trades``.
* The type aliases / sets every consumer now imports ARE the registry's
  objects (identity), so they cannot fork.
"""

import pytest

from services.closed_sets import (
    POSITION_DIRECTIONS,
    STABLECOIN_SPLIT_SUFFIXES,
    STABLECOINS,
    STABLECOINS_LONGEST_FIRST,
    TRADE_SIDES,
    TRADE_SIDES_SET,
    is_trade_side,
    perp_quote,
)


# ---------------------------------------------------------------------------
# Closed-set membership / shape
# ---------------------------------------------------------------------------
def test_trade_sides_are_exactly_buy_sell():
    assert TRADE_SIDES == ("buy", "sell")
    assert TRADE_SIDES_SET == frozenset({"buy", "sell"})


def test_position_directions_are_long_short():
    assert POSITION_DIRECTIONS == ("long", "short")


def test_stablecoins_canonical_set():
    # The "treat as cash / skip the ticker" set. FDUSD MUST be present — its
    # absence in the old allocator_positions copy is the drift B8b closes.
    assert STABLECOINS == frozenset(
        {"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"}
    )
    assert "FDUSD" in STABLECOINS


def test_split_suffixes_are_disjoint_from_stablecoins():
    # Splitter-only suffixes (USDe/PYUSD/USDB) must NOT leak into the
    # price-skip set, or a token like PYUSDETH would be marked as cash.
    assert STABLECOIN_SPLIT_SUFFIXES.isdisjoint(STABLECOINS)


def test_longest_first_is_sorted_descending_and_covers_both_sets():
    lengths = [len(s) for s in STABLECOINS_LONGEST_FIRST]
    assert lengths == sorted(lengths, reverse=True)
    assert set(STABLECOINS_LONGEST_FIRST) == STABLECOINS | STABLECOIN_SPLIT_SUFFIXES


# ---------------------------------------------------------------------------
# is_trade_side
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("value", ["buy", "sell", "BUY", "Sell", "sElL"])
def test_is_trade_side_accepts_known_case_insensitive(value):
    assert is_trade_side(value) is True


@pytest.mark.parametrize(
    "value",
    ["", "long", "short", "net", "hold", None, 0, 1, [], {}, "buyy", "buy "],
)
def test_is_trade_side_rejects_unknown_and_non_strings(value):
    assert is_trade_side(value) is False


# ---------------------------------------------------------------------------
# perp_quote — golden parity with the prior inline derivation
# ---------------------------------------------------------------------------
def _legacy_inline_quote(symbol: str) -> str:
    """The exact logic that lived inline in _compute_daily_equity twice."""
    if "/" in symbol:
        return symbol.split("/")[-1].split(":")[0].upper()
    return "USDT"


@pytest.mark.parametrize(
    "symbol",
    [
        "BTC/USDT:USDT",   # linear perp
        "ETH/USDT:USDT",
        "BTC/USD:BTC",     # inverse perp — quote is USD, NOT USD:BTC
        "BTC/USDT",        # spot
        "ETH/USDC",
        "DOGE/USDT:USDT",
        "BTCUSDT",         # stripped holdings code — no slash
        "",                # empty
        "WEIRD",           # no slash, non-stable
        "a/b:c",           # lowercase -> uppercased
    ],
)
def test_perp_quote_matches_legacy_inline(symbol):
    assert perp_quote(symbol) == _legacy_inline_quote(symbol)


def test_perp_quote_strips_inverse_settle_suffix():
    # The WR-03 bug this guards: a naive split("/")[-1] would yield "USD:BTC".
    assert perp_quote("BTC/USD:BTC") == "USD"
    assert perp_quote("BTC/USDT:USDT") == "USDT"


def test_perp_quote_defaults_usdt_without_slash():
    assert perp_quote("BTCUSDT") == "USDT"
    assert perp_quote("") == "USDT"


# ---------------------------------------------------------------------------
# _make_fill_dict ingest guard — NEW-C01-09 (the residual ingest gap)
# ---------------------------------------------------------------------------
def _fill_kwargs(side: str) -> dict:
    return dict(
        exchange="okx",
        symbol="BTC/USDT:USDT",
        side=side,
        price=100.0,
        quantity=2.0,
        fee=0.1,
        fee_currency="USDT",
        timestamp="2026-05-29T00:00:00Z",
        exchange_order_id="o1",
        exchange_fill_id="f1",
        is_maker=False,
        raw_data=None,
    )


def test_make_fill_dict_flags_unknown_side_but_persists_fill():
    from services import exchange as ex

    ex.get_and_clear_last_dq_flags()  # reset the per-task buffer
    row = ex._make_fill_dict(**_fill_kwargs("LONG"))  # not a trade side

    # The fill is STILL persisted (dropping it would lose reconciliation),
    # with its raw side value untouched.
    assert row["side"] == "LONG"
    assert row["is_fill"] is True

    flags = ex.get_and_clear_last_dq_flags()
    assert flags.get("unknown_trade_side") is True
    samples = flags.get("unknown_trade_side_samples")
    assert isinstance(samples, list) and len(samples) >= 1


def test_make_fill_dict_no_flag_for_valid_side():
    from services import exchange as ex

    ex.get_and_clear_last_dq_flags()
    for valid in ("buy", "sell"):
        ex._make_fill_dict(**_fill_kwargs(valid))
    flags = ex.get_and_clear_last_dq_flags()
    assert "unknown_trade_side" not in flags
    assert "unknown_trade_side_samples" not in flags


def test_make_fill_dict_sample_list_is_bounded():
    from services import exchange as ex

    ex.get_and_clear_last_dq_flags()
    # Drive more distinct bad sides than the cap to prove the list is bounded.
    for i in range(ex._UNKNOWN_SIDE_SAMPLE_CAP + 8):
        ex._make_fill_dict(**{**_fill_kwargs(f"garbage_{i}"), "symbol": f"S{i}/USDT"})
    flags = ex.get_and_clear_last_dq_flags()
    assert flags.get("unknown_trade_side") is True
    assert len(flags["unknown_trade_side_samples"]) <= ex._UNKNOWN_SIDE_SAMPLE_CAP


# ---------------------------------------------------------------------------
# Re-export identity — consumers must share the registry's objects, not copies
# ---------------------------------------------------------------------------
def test_consumers_share_the_registry_objects():
    from services import closed_sets as cs
    from services import allocator_positions as ap
    from services import equity_reconstruction as er

    assert ap.STABLECOINS is cs.STABLECOINS
    assert er.STABLECOINS is cs.STABLECOINS
    # The longest-first tuple equity reconstruction binds is the registry's.
    assert er._STABLECOINS_LONGEST_FIRST is cs.STABLECOINS_LONGEST_FIRST
