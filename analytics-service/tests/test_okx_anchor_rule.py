"""Phase 172 OKXANCHOR, plan 04: the forced OKX anchor asks the venue's bills before it refuses.

WHY these tests exist (Rule 9). A forced rebuild replaces an account's stored window in ONE
write. The 5x plausibility gate in ``equity_reconstruction`` cannot tell "a large balance was
held before the 89-day window" (a correct anchor) from "the replay lost value" (a wrong one),
so it refused a correctly funded OKX account. The rule under test lets such an account anchor
only when an independent source, the venue's own running bill balances, proves the opening the
anchor implies; and it keeps refusing, by the existing name and with nothing written, an
account whose opening the bills disagree with or cannot prove.

Every expected number here is a fixture constant: the payload's own ``totalEq``, the seeded
opening. None is computed by the code under test.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock

import ccxt
import pytest

from services import equity_reconstruction as er
from services import exchange as exchange_module
from services import okx_opening_balance as obal
from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests._okx_bills import (
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_bill_chain,
    okx_detail,
)
from tests.test_equity_reconstruction import (
    API_KEY_ID_1,
    _install_fake_audit,
    _install_fake_preflight,
    _make_trade,
)
from tests.test_reconstruct_force_rebuild import (
    COMPLETE,
    MARKER,
    _assert_forced_rebuild_refused,
    _audit_metadata,
    _bybit_exchange,
    _first_call_trades,
    _forced_job,
    _freeze_now_at,
    _trade_ts,
)
from tests.test_reconstruct_marker_writer import (
    DAY_MS,
    END_DATE,
    _freeze_now,
    _MarkerFake,
    _seed_key,
)
from tests.test_upnl_venues import (
    bybit_coin,
    bybit_wallet_balance,
    real_bybit_parse_balance,
)

# The payload's own total equity: 20000 USDT cash plus 1 BTC marked at the flat 50000 close.
_TOTAL_EQ = "70000"
# The cash the account held before its first trade: the seeded opening, a constant of the
# fixture. The replay (1 BTC bought at 40000, marked at 50000) ends at 10000, so the opening
# the anchor implies is 70000 - 10000 = 60000, the same number by construction of the venue.
_OPENING = "60000"


def _bills(usdt_opening: str = _OPENING) -> list[dict[str, str]]:
    """The venue's bills: one reach bill five days before the trade day, then from 00:00 UTC of
    the trade day a USDT chain (the 40000 spent on the buy) and a BTC chain (the 1 bought)."""
    first_ts = _trade_ts()
    return [
        okx_bill(1, first_ts - 5 * DAY_MS, "USDT", usdt_opening, "0"),
        *okx_bill_chain("USDT", usdt_opening, ["-40000"], first_id=100, first_ts=first_ts),
        *okx_bill_chain("BTC", "0", ["1"], first_id=200, first_ts=first_ts),
    ]


def _usdt_cash_after(usdt_opening: str) -> str:
    """Today's USDT cash for a USDT chain that opens at ``usdt_opening`` and spends 40000: the
    venue's newest bill balance IS the cash balance, which the oracle now checks."""
    return format(Decimal(usdt_opening) - 40000, "f")


async def _okx_world(
    bills: list[dict[str, str]] | None = None,
    *,
    usdt_cash: str = "20000",
) -> tuple[AsyncMock, OkxBillsArchive]:
    """An OKX exchange: one BTC buy of 1.0 at 40000 on the trade day, flat 50000 closes, a
    balance of 20000 USDT + 1 BTC (``totalEq`` 70000) and the bills archive ``bills``.

    Both raw OKX methods are set explicitly with dict-shaped answers: an unset method on this
    AsyncMock-based exchange would answer with a MagicMock (RESEARCH Pitfall 2).
    """
    exchange = await _bybit_exchange()
    exchange.id = "okx"
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
    )
    exchange.private_get_account_balance = AsyncMock(
        return_value=okx_balance_payload(
            _TOTAL_EQ, [okx_detail("USDT", usdt_cash), okx_detail("BTC", "1")]
        )
    )
    archive = OkxBillsArchive(_bills() if bills is None else bills)
    exchange.private_get_account_bills_archive = archive
    return exchange, archive


@pytest.mark.asyncio
async def test_a_forced_okx_rebuild_whose_bills_prove_the_opening_anchors_and_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The tracer, job to persisted rows. A marked sole OKX key, a forced job: the replay ends
    at 10000 and ``totalEq`` is 70000, 7 times the replay, so the 5x gate alone refused this
    account. The bills prove 60000 was held before the curve begins (the USDT chain opens at
    60000, the BTC chain at 0), which is exactly the opening the anchor implies, so the rebuild
    anchors: the job ends DONE, every written row ends at the venue's ``totalEq`` and carries
    the 60000 offset as its STARTING_BALANCE, and the completion audit says the bills agreed.
    RED on the plan-01/02 code, where the 5x arm refused it."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="okx")
    audit = _install_fake_audit(monkeypatch)
    exchange, archive = await _okx_world()
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    rows = fake.rows_for("allocator_equity_snapshots")
    assert rows, "a forced rebuild whose opening the bills prove persisted no rows"
    for row in rows:
        assert row["value_usd"] == pytest.approx(float(_TOTAL_EQ), abs=0.01), (
            row["asof"], row["value_usd"],
        )
        assert row["breakdown"]["STARTING_BALANCE"] == pytest.approx(float(_OPENING), abs=0.01), (
            row["asof"], row["breakdown"],
        )
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get("anchor_opening_agreed") is True, complete
    assert complete.get("anchor_opening_check") == "agreed", complete
    assert complete.get("anchor_offset_implausible") is False, complete
    assert archive.calls, "the bills check never ran"


# ---------------------------------------------------------------------------
# Plan 04 task 2: a disagreeing or unprovable opening still refuses by name
# ---------------------------------------------------------------------------


async def _forced_window_call(
    monkeypatch: pytest.MonkeyPatch, exchange: Any
) -> tuple[list[dict[str, Any]], bool, dict[str, Any]]:
    """A DIRECT forced call of the crawl over the 89-day account window, time frozen six hours
    after midnight (the OKX terminus test needs the UTC day to have begun, RESEARCH Q1)."""
    _freeze_now_at(monkeypatch, END_DATE + timedelta(hours=6))
    end = END_DATE.date()
    return await er._fetch_and_price_window(
        exchange, "okx", _MarkerFake(), end - timedelta(days=89), end, require_anchor=True
    )


@pytest.mark.asyncio
async def test_a_disagreeing_opening_refuses_by_name_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An OKX account whose bills say it opened with 30000, not the 60000 the anchor implies:
    the missing 30000 is money the venue's own ledger does not show, so spreading the offset
    would invent a balance. The 5x gate's refusal stands, by the existing token: FAILED
    permanent, every stored row and the marker untouched, no completion audit."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="30000"), usdt_cash=_usdt_cash_after("30000")
    )

    await _assert_forced_rebuild_refused(
        monkeypatch, exchange, "anchor_skipped_implausible", venue="okx"
    )


async def _case_reach_unproven(exchange: AsyncMock) -> None:
    exchange.private_get_account_bills_archive = OkxBillsArchive([])


async def _case_chain_break(exchange: AsyncMock) -> None:
    """A USDT chain of three bills with the middle one missing: the venue's own running
    balance no longer adds up, so no opening can be read from it."""
    first_ts = _trade_ts()
    usdt = okx_bill_chain(
        "USDT", _OPENING, ["-10000", "-10000", "-20000"], first_id=100, first_ts=first_ts
    )
    del usdt[1]
    exchange.private_get_account_bills_archive = OkxBillsArchive(
        [
            okx_bill(1, first_ts - 5 * DAY_MS, "USDT", _OPENING, "0"),
            *usdt,
            *okx_bill_chain("BTC", "0", ["1"], first_id=200, first_ts=first_ts),
        ]
    )


async def _case_unpriced_ccy(exchange: AsyncMock) -> None:
    """The account held 5 XYZ before the curve and the venue lists no XYZ/USDT candle: a coin
    nobody can price cannot be added to an opening."""
    first_ts = _trade_ts()
    exchange.private_get_account_bills_archive = OkxBillsArchive(
        [*_bills(), *okx_bill_chain("XYZ", "5", ["1"], first_id=300, first_ts=first_ts)]
    )
    exchange.private_get_account_balance = AsyncMock(
        return_value=okx_balance_payload(
            _TOTAL_EQ,
            [okx_detail("USDT", "20000"), okx_detail("BTC", "1"), okx_detail("XYZ", "6")],
        )
    )
    flat_closes = exchange.fetch_ohlcv

    async def _ohlcv(symbol: str, *args: Any, **kwargs: Any) -> Any:
        if symbol.startswith("XYZ/"):
            return []
        return await flat_closes(symbol, *args, **kwargs)

    exchange.fetch_ohlcv = AsyncMock(side_effect=_ohlcv)


async def _case_malformed_bills(exchange: AsyncMock) -> None:
    """The archive answers a list where the venue promises an object."""
    exchange.private_get_account_bills_archive = AsyncMock(return_value=[])


async def _case_malformed_balance(exchange: AsyncMock) -> None:
    """The anchor's own balance read is fine; the check's second read is not a balance."""
    exchange.private_get_account_balance = AsyncMock(
        side_effect=[
            okx_balance_payload(
                _TOTAL_EQ, [okx_detail("USDT", "20000"), okx_detail("BTC", "1")]
            ),
            {"data": []},
        ]
    )


async def _case_page_ceiling(exchange: AsyncMock) -> None:
    """More bills since the opening than the walk's page ceiling allows (here 1 page)."""
    first_ts = _trade_ts()
    exchange.private_get_account_bills_archive = OkxBillsArchive(
        [
            okx_bill(1, first_ts - 5 * DAY_MS, "USDT", _OPENING, "0"),
            *okx_bill_chain(
                "USDT", _OPENING, ["-40000"] + ["0"] * 149, first_id=100, first_ts=first_ts
            ),
        ]
    )


_UNPROVABLE_CASES = [
    pytest.param("reach_unproven", _case_reach_unproven, id="reach_unproven"),
    pytest.param("chain_break", _case_chain_break, id="chain_break"),
    pytest.param("unpriced_ccy", _case_unpriced_ccy, id="unpriced_ccy"),
    pytest.param("malformed_bills", _case_malformed_bills, id="malformed_bills"),
    pytest.param("malformed_balance", _case_malformed_balance, id="malformed_balance"),
    pytest.param("page_ceiling", _case_page_ceiling, id="page_ceiling"),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(("token", "build"), _UNPROVABLE_CASES)
async def test_each_unprovable_opening_refuses_by_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, token: str, build: Any
) -> None:
    """Each way the bills can fail to prove an opening stands for a real OKX failure: an
    archive that does not reach back, a bill missing from the running balance, a coin with no
    price, a garbled page, a garbled balance row and a walk longer than the ceiling. None may
    anchor: an opening nobody proved is a refusal, never a guess, and it is refused by the
    existing token (no new vocabulary). The check's own log line must name the case's token,
    so the refusal is proven to come from THAT gap and not from the 5x arm alone."""
    exchange, _archive = await _okx_world()
    await build(exchange)
    if token == "page_ceiling":
        monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", 1)
    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction")

    with pytest.raises(er.ForcedRebuildRefusedError) as excinfo:
        await _forced_window_call(monkeypatch, exchange)

    assert excinfo.value.reason == "anchor_skipped_implausible"
    assert token in obal.OPENING_UNAVAILABLE_REASONS
    assert f"opening check unavailable ({token})" in caplog.text, caplog.text


# Review SFH-03: every oracle outcome used to collapse into the one refusal token, with the
# reason in a single log line, and PD-I forbids an automatic retry, so an operator could not tell
# "the venue's data was incomplete" from "the anchor is really wrong". The outcome now rides the
# refusal's own audit as one closed-vocabulary field. It is NOT a refusal token: the forced
# refusal vocabulary stays the closed 15.
_OPENING_CHECK_VOCABULARY = {"agreed", "disagreed", "not-run"} | obal.OPENING_UNAVAILABLE_REASONS


async def _refusal_audit(monkeypatch: pytest.MonkeyPatch, exchange: Any) -> dict[str, Any]:
    """Run a forced OKX job to its refusal and return the ONE ``reconstruct_failed`` audit's
    metadata, the operator's only record of the refusal."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="okx")
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.FAILED, result
    assert (result.error_message or "").startswith(
        "forced rebuild refused (anchor_skipped_implausible)"
    ), result.error_message
    (failed,) = _audit_metadata(audit, "allocator.equity.reconstruct_failed")
    return failed


@pytest.mark.asyncio
@pytest.mark.parametrize(("token", "build"), _UNPROVABLE_CASES)
async def test_a_refusal_audit_names_why_the_bills_could_not_prove_the_opening(
    monkeypatch: pytest.MonkeyPatch, token: str, build: Any
) -> None:
    """Each of the six ways the bills can fail to prove an opening is recorded on the refusal's
    audit under its own name, so an operator can tell incomplete venue data from a wrong anchor
    without a log search."""
    exchange, _archive = await _okx_world()
    await build(exchange)
    if token == "page_ceiling":
        monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", 1)

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed.get("anchor_opening_check") == token, failed
    assert failed["anchor_opening_check"] in _OPENING_CHECK_VOCABULARY


@pytest.mark.asyncio
async def test_a_refusal_audit_names_a_genuine_disagreement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The bills read cleanly and say the account opened with 30000, not the 60000 the anchor
    implies: that is the anchor being wrong, a different operator action from incomplete data,
    so the audit says "disagreed"."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="30000"), usdt_cash=_usdt_cash_after("30000")
    )

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed.get("anchor_opening_check") == "disagreed", failed


@pytest.mark.asyncio
async def test_a_refusal_the_bills_were_never_asked_about_says_not_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Bybit refusal over the same 5x bound never consults the OKX bills, and its audit must
    not claim an outcome: it says "not-run", so the operator is not left guessing whether the
    check was consulted."""
    payload = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "100000", "250.5")])
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
    )
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now(monkeypatch)

    await run_reconstruct_allocator_history_job(_forced_job())

    (failed,) = _audit_metadata(audit, "allocator.equity.reconstruct_failed")
    assert failed.get("anchor_opening_check") == "not-run", failed


@pytest.mark.asyncio
async def test_a_disagreement_is_logged_at_warning_and_the_refusal_names_the_check(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A disagreement used to log at info (inside the oracle), below the worker's warning
    threshold, and the refusal line never said the bills had been consulted. Both now speak at
    warning level from the reconstruction itself."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="30000"), usdt_cash=_usdt_cash_after("30000")
    )
    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.equity_reconstruction")

    with pytest.raises(er.ForcedRebuildRefusedError):
        await _forced_window_call(monkeypatch, exchange)

    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("bills disagree" in m for m in warnings), warnings
    assert any("OKX bills check: disagreed" in m for m in warnings), warnings


def test_every_unavailable_token_has_an_anchor_rule_case() -> None:
    """The refusal cases and the oracle's closed vocabulary must not drift apart."""
    assert {p.values[0] for p in _UNPROVABLE_CASES} == obal.OPENING_UNAVAILABLE_REASONS


@pytest.mark.asyncio
async def test_an_opening_just_inside_the_tolerance_anchors_and_just_outside_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The boundary of the rule, both sides. The anchor implies a 60000 opening; the bills say
    60000 minus 0.999 of the tolerance (agree, the curve anchors at ``totalEq``) or minus
    1.001 of it (disagree, refused). A tolerance that quietly widened would pass the second
    case; one that quietly narrowed would refuse the first."""
    tol = max(obal.OPENING_TOLERANCE_USD, obal.OPENING_TOLERANCE_REL * float(_TOTAL_EQ))

    def _opening(fraction: float) -> str:
        return format(Decimal(f"{float(_OPENING) - fraction * tol:.4f}"), "f")

    inside, _archive = await _okx_world(
        _bills(usdt_opening=_opening(0.999)), usdt_cash=_usdt_cash_after(_opening(0.999))
    )
    rows, _terminus, telemetry = await _forced_window_call(monkeypatch, inside)
    assert rows[-1]["value_usd"] == pytest.approx(float(_TOTAL_EQ), abs=0.01)
    assert telemetry["anchor_opening_agreed"] is True

    outside, _archive = await _okx_world(
        _bills(usdt_opening=_opening(1.001)), usdt_cash=_usdt_cash_after(_opening(1.001))
    )
    with pytest.raises(er.ForcedRebuildRefusedError) as excinfo:
        await _forced_window_call(monkeypatch, outside)
    assert excinfo.value.reason == "anchor_skipped_implausible"


# Review SFH-R2-01: an "agreed" verdict applied the anchor past the 5x gate with nothing recording
# HOW CLOSE the bills came, so 4.9% of the anchor read like 0.1%, and OPENING_TOLERANCE_REL rests on
# one account. Two ratios now ride the agreed log line, the telemetry, the completion audit and a
# disagreement's refusal audit: the residual (the opening the anchor implies minus the bills' opening,
# the allocator history probe's sign) over the anchor, and the implied opening over the anchor.
# Ratios only, 3 significant figures, never an amount. Fixture constants: anchor 70000, replay end 10000, so the implied opening is
# 60000 and its ratio is 60000 / 70000 = 0.857142... = 0.857.
_IMPLIED_OPENING_RATIO = 0.857
_RESIDUAL_KEY = "anchor_opening_residual_ratio"
_IMPLIED_KEY = "anchor_opening_implied_ratio"


@pytest.mark.asyncio
async def test_an_agreed_check_reports_how_close_the_bills_came(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The bills say the account opened with 59000 against the 60000 the anchor implies: the
    residual is (60000 - 59000) / 70000 = +0.0142857, 3 significant figures 0.0143 (the probe's sign:
    implied minus bills). The ratio is on the
    telemetry and on the agreed log line, so a near-tolerance agreement is told from an exact one."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="59000"), usdt_cash=_usdt_cash_after("59000")
    )
    caplog.set_level(logging.INFO, logger="quantalyze.analytics.equity_reconstruction")

    _rows, _terminus, telemetry = await _forced_window_call(monkeypatch, exchange)

    assert telemetry["anchor_opening_check"] == "agreed"
    assert telemetry[_RESIDUAL_KEY] == 0.0143
    assert telemetry[_IMPLIED_KEY] == _IMPLIED_OPENING_RATIO
    agreed_lines = [r.getMessage() for r in caplog.records if "bills agree" in r.getMessage()]
    assert agreed_lines and "residual_ratio=0.0143 " in agreed_lines[0] and "0.857" in agreed_lines[0], agreed_lines


@pytest.mark.asyncio
async def test_the_completion_audit_carries_the_agreed_ratios(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Job to audit: the completion of a rebuild that anchored on the bills' word carries both
    ratios, as the floats the telemetry computed and nothing else (no amount, no id)."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="okx")
    audit = _install_fake_audit(monkeypatch)
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="59000"), usdt_cash=_usdt_cash_after("59000")
    )
    _install_fake_preflight(monkeypatch, "okx", fake, exchange)
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get(_RESIDUAL_KEY) == 0.0143, complete
    assert complete.get(_IMPLIED_KEY) == _IMPLIED_OPENING_RATIO, complete


@pytest.mark.asyncio
async def test_a_disagreement_refusal_audit_carries_how_far_off_the_bills_were(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The bills read cleanly and say 30000 against the implied 60000: (60000 - 30000) / 70000 =
    +0.428571, 3 significant figures 0.429. The refusal's audit says how far off, so an operator
    can tell a near miss from a wrong anchor."""
    exchange, _archive = await _okx_world(
        _bills(usdt_opening="30000"), usdt_cash=_usdt_cash_after("30000")
    )

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed.get("anchor_opening_check") == "disagreed", failed
    assert failed.get(_RESIDUAL_KEY) == 0.429, failed
    assert failed.get(_IMPLIED_KEY) == _IMPLIED_OPENING_RATIO, failed


@pytest.mark.asyncio
async def test_an_unproven_opening_has_no_ratios_to_report(monkeypatch: pytest.MonkeyPatch) -> None:
    """When the bills could not prove an opening there is no residual to state: the refusal audit
    carries neither ratio."""
    exchange, _archive = await _okx_world()
    await _case_reach_unproven(exchange)

    failed = await _refusal_audit(monkeypatch, exchange)

    assert failed.get("anchor_opening_check") == "reach_unproven", failed
    assert _RESIDUAL_KEY not in failed and _IMPLIED_KEY not in failed, failed


# ---------------------------------------------------------------------------
# Plan 04 task 3: the rule touches nothing outside the forced OKX path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_rate_limit_inside_the_check_propagates_instead_of_refusing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """OKX answers the bills walk with a 429 that survives the backoff. The crawl stamps the 429
    and the job is retried; turning it into ``anchor_skipped_implausible`` would be a PERMANENT
    refusal, the very re-crawl PD-I forbids retrying by hand. The venue error must leave
    ``_fetch_and_price_window`` as the venue error."""
    monkeypatch.setattr(exchange_module, "OKX_BILLS_BACKOFF_BASE_S", 0.0)
    monkeypatch.setattr(exchange_module.random, "uniform", lambda _a, _b: 0.0)
    exchange, archive = await _okx_world()
    archive.effect = ccxt.RateLimitExceeded("fixture 429")

    with pytest.raises(ccxt.RateLimitExceeded):
        await _forced_window_call(monkeypatch, exchange)

    assert archive.calls, "the check never reached the bills"


@pytest.mark.asyncio
async def test_the_unforced_okx_path_skips_the_check_even_when_the_bills_would_agree(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unforced reconstruct keeps its advisory zero-cash curve (PD-B): its OKX window is
    730 days, the bills archive reaches three months and cannot prove an opening two years back.
    Even on an account whose bills WOULD agree, an unforced call must not read them: the curve
    ends at the replay's 10000, the implausible flag is raised as before, and the archive is
    never called."""
    _freeze_now_at(monkeypatch, END_DATE + timedelta(hours=6))
    exchange, archive = await _okx_world()
    end = END_DATE.date()

    rows, _terminus, telemetry = await er._fetch_and_price_window(
        exchange, "okx", _MarkerFake(), end - timedelta(days=89), end
    )

    assert rows[-1]["value_usd"] == pytest.approx(10000.0, abs=0.01)
    assert telemetry["anchor_offset_implausible"] is True
    assert telemetry["anchor_opening_agreed"] is False
    assert archive.calls == []


@pytest.mark.asyncio
async def test_a_non_positive_replay_anchors_without_the_bills_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A buy at 60000 marked at 50000 leaves the replay at -10000 and ``totalEq`` is 70000.
    This pins the PRE-EXISTING behaviour that the 5x arm does not gate a replay at or below
    zero (RESEARCH Open Question 2, Pitfall 5): the forced curve anchors at ``totalEq`` and
    asks the bills nothing. It is out of this phase's scope and booked by plan 05 as
    ``172-OKX-NONPOSITIVE-REPLAY-UNGATED``; this test only stops the rule from changing it
    unnoticed."""
    exchange, archive = await _okx_world()
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 60000.0, 1.0)]
    )

    rows, _terminus, telemetry = await _forced_window_call(monkeypatch, exchange)

    assert rows[-1]["value_usd"] == pytest.approx(float(_TOTAL_EQ), abs=0.01)
    assert telemetry["anchor_opening_agreed"] is False
    assert archive.calls == []


@pytest.mark.asyncio
async def test_the_bybit_implausible_arm_reads_no_bills_and_still_refuses(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The check is OKX-only. A Bybit account whose offset is over 5x refuses exactly as before
    and never touches an OKX bills method (the explicit mock proves it was not awaited)."""
    payload = bybit_wallet_balance("UNIFIED", [bybit_coin("USDT", "100000", "250.5")])
    exchange = await _bybit_exchange()
    exchange.fetch_balance = AsyncMock(return_value=await real_bybit_parse_balance(payload))
    exchange.fetch_my_trades = _first_call_trades(
        [_make_trade(_trade_ts(), "BTC/USDT", "buy", 40000.0, 1.0)]
    )
    exchange.private_get_account_bills_archive = AsyncMock()

    await _assert_forced_rebuild_refused(monkeypatch, exchange, "anchor_skipped_implausible")

    assert exchange.private_get_account_bills_archive.await_count == 0


@pytest.mark.asyncio
async def test_an_ordinary_forced_rebuild_reports_no_opening_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A forced Bybit rebuild whose anchor needs no second opinion ends DONE, and its completion
    audit says so: ``anchor_opening_agreed`` is False, because the flag means "anchored past the
    5x bound on the bills' word" and nothing here was."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=MARKER, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, await _bybit_exchange())
    _freeze_now(monkeypatch)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete.get("anchor_opening_agreed") is False, complete
    assert complete.get("anchor_opening_check") == "not-run", complete
    # SFH-R2-01: the keys are present and None, like the other anchor fields' defaults.
    assert _RESIDUAL_KEY in complete and complete[_RESIDUAL_KEY] is None, complete
    assert _IMPLIED_KEY in complete and complete[_IMPLIED_KEY] is None, complete
