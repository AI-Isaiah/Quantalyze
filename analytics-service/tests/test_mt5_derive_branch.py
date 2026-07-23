"""MT5RECON-01/03 (Phase 136 / plan 136-03) — OFFLINE job-level tests for the
``venue == "mt5"`` branch in ``run_derive_broker_dailies_job``.

These are WIRING tests (Rule 9 — test the call site invokes the helper, not just
the helper): they drive the WHOLE derive job through the offline ``Mt5Client``
``_connect`` transport double (no live terminal, no ``mt5linux`` install, no
network) so that neutering the branch's combine call, the ``tail_kind`` selection,
or the anchor path turns a test RED — not just a helper unit test.

Oracle discipline (NON-NEGOTIABLE): every money assertion uses the plan-01 HAND
literals (deposit day → 300/100_400, terminal NAV → 110_500), NEVER a value read
back from the SUT to assert against itself.

Behaviors:
  * test_mt5_disabled_fails_closed — MT5_ENABLED off → permanent MT5_DISABLED,
    ZERO transport calls (no live read while disabled).
  * test_mt5_routes_one_backbone — flag on + healthy double → DONE; persisted
    csv_daily_returns equals the plan-01 hand literals AND the cash_settlement
    basis conventions echo periods_per_year == 252 (asset_class 'traditional').
  * test_upnl_wedge_flags — balance 100_000 / equity 110_000 (10% wedge) →
    unrealized_pnl_in_anchor stamped → complete_with_warnings.
  * test_read_error_fails_whole_job — a mid-read Mt5ClientError → typed FAILED,
    NOTHING partial persisted.
  * test_unclassifiable_deal_permanent — a CORRECTION deal → permanent FAILED +
    terminal stamp, never a transient retry.
  * test_missing_window_masked — deals spanning only a late window → the series
    starts at the first evidence day; NO rows fabricated before it.
  * test_long_fetch_tail_wiring — source 'mt5' selects tail_kind
    'derive_broker_dailies' (never sync_trades) via _LEDGER_BACKED_SOURCES.
  * test_reconstruction_reconciles_to_equity — reconstructed terminal NAV equals
    account_info().equity within max($1, 1e-6·|terminal|), asserted DIRECTLY at
    the mt5 job seam against a hand-derived oracle (reddens on anchor drift).
"""
from __future__ import annotations

from contextlib import ExitStack
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

import services.job_worker as jw
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from services.ingestion.long_fetch import (
    _LEDGER_BACKED_SOURCES,
    run_process_key_long_job,
)
from services.metrics import periods_per_year_for_asset_class
from services.mt5_client import Mt5Client, Mt5ClientError, Mt5Session


# ---------------------------------------------------------------------------
# Offline transport double (the mt5_client.py:158-162 _connect injection seam).
# ---------------------------------------------------------------------------
class _NT:
    """A netref-namedtuple stand-in: Mt5Client._materialize requires ._asdict()."""

    def __init__(self, d: dict) -> None:
        self._d = dict(d)

    def _asdict(self) -> dict:
        return dict(self._d)


class _FakeMt5Transport:
    """Records every call so a "zero live read while disabled" assertion is
    falsifiable. Distinguishes None (error → _raise_last) from () (honest empty),
    the load-bearing MT5 discipline, verbatim."""

    def __init__(
        self,
        *,
        account: dict,
        deals: list[dict],
        login_ok: bool = True,
        deals_none: bool = False,
        read_exc: Exception | None = None,
        last_error: tuple = (0, "unknown"),
    ) -> None:
        self._account = account
        self._deals = deals
        self._login_ok = login_ok
        self._deals_none = deals_none
        self._read_exc = read_exc
        self._last_error = last_error
        self.calls: list[str] = []

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self.calls.append("login")
        return self._login_ok

    def account_info(self):
        self.calls.append("account_info")
        return _NT(self._account)

    def history_deals_get(self, from_ts, to_ts):  # noqa: ANN001
        self.calls.append("history_deals_get")
        if self._read_exc is not None:
            raise self._read_exc
        if self._deals_none:
            return None
        return tuple(_NT(d) for d in self._deals)

    def order_check(self, request):  # noqa: ANN001 - unused by the derive branch
        self.calls.append("order_check")
        return _NT({"retcode": 0})

    def last_error(self):
        return self._last_error

    def shutdown(self):
        self.calls.append("shutdown")


def _session(transport: _FakeMt5Transport) -> Mt5Session:
    client = Mt5Client("h", 1, _connect=lambda *, host, port, timeout: transport)
    return Mt5Session(
        client=client, login=123456, investor_password="pw", server="Broker-Live"
    )


# ---------------------------------------------------------------------------
# ctx / capture harness (mirrors test_derive_broker_dailies_dualmode._build_ctx).
# ---------------------------------------------------------------------------
def _build_ctx(
    transport: _FakeMt5Transport, *, asset_class: str = "traditional"
) -> tuple[MagicMock, dict]:
    capture: dict = {"upserts": [], "rpc_calls": [], "deletes": []}
    ctx = MagicMock()
    ctx.exchange = _session(transport)
    ctx.supabase = MagicMock()
    ctx.strategy_row = {"id": "strat-mt5", "user_id": "u1", "asset_class": asset_class}
    ctx.key_row = {"id": "key-mt5", "user_id": "u1", "exchange": "mt5"}

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _upsert(payload: object, **kw: object) -> MagicMock:
            capture["upserts"].append((name, payload, kw.get("on_conflict")))
            stub = MagicMock()
            stub.execute.return_value = MagicMock(data=1)
            return stub

        tbl.upsert.side_effect = _upsert

        def _delete(**kw: object) -> MagicMock:
            capture["deletes"].append(name)
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.gte.return_value = chain
            chain.lte.return_value = chain
            chain.execute.return_value = MagicMock(data=[], count=0)
            return chain

        tbl.delete.side_effect = _delete
        return tbl

    ctx.supabase.table.side_effect = _table

    def _rpc(name: str, payload: dict) -> MagicMock:
        capture["rpc_calls"].append((name, payload))
        stub = MagicMock()
        stub.execute.return_value = MagicMock(data=1)
        return stub

    ctx.supabase.rpc.side_effect = _rpc
    return ctx, capture


def _patches(ctx: MagicMock, *, capture_series: dict | None = None) -> list:
    """Preflight → ctx; close chokepoint + db_execute stubbed. When
    ``capture_series`` is given, wrap persist_basis_series to record the
    BasisSeriesResult.conventions per basis (for the 252-echo assertion)."""
    ps = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(return_value=ctx),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]
    if capture_series is not None:
        def _capture(supabase, strategy_id, *, basis, result):  # noqa: ANN001
            capture_series[basis] = (
                dict(result.conventions) if result is not None else None
            )

        ps.append(
            patch("services.basis_series.persist_basis_series", new=_capture)
        )
    return ps


def _apply(patchers: list) -> ExitStack:
    stack = ExitStack()
    for p in patchers:
        stack.enter_context(p)
    return stack


def _job() -> dict:
    return {"id": "j-mt5", "kind": "derive_broker_dailies", "strategy_id": "strat-mt5"}


def _epoch(y: int, m: int, d: int, h: int = 12) -> int:
    return int(datetime(y, m, d, h, tzinfo=timezone.utc).timestamp())


# THE plan-01 canonical hand fixture (identical arithmetic to
# test_mt5_deal_reconstruction._canonical_deposit_deals). Anchor equity 110_500,
# balance 110_500 (no open positions), server_utc_offset_s=0:
#   initial = 110_500 − Σpnl(500) − Σflow(10_000) = 100_000
#   NAV: 100_000 / 100_400 / 100_400 / 110_700 / 110_500
#   day2: 400/100_000 = 0.0040   day3: flat 0.0
#   day4: 300/100_400 (deposit NOT a spike)   day5: −200/110_700
def _canonical_deals() -> list[dict]:
    return [
        {"type": 0, "entry": 1, "profit": 500.0, "swap": 0.0,
         "commission": -100.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 2, "profit": 10_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": 1, "entry": 1, "profit": 300.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": 1, "entry": 1, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 5)},
    ]


def _csv_rows(capture: dict) -> dict[str, float]:
    """Flatten the captured csv_daily_returns upsert payloads into {date: return}."""
    out: dict[str, float] = {}
    for name, payload, _oc in capture["upserts"]:
        if name != "csv_daily_returns":
            continue
        for row in payload:
            out[row["date"]] = float(row["daily_return"])
    return out


def _dq_flags(capture: dict) -> dict:
    """The strategy_analytics prestamp's data_quality_flags (last one wins)."""
    flags: dict = {}
    for name, payload, _oc in capture["upserts"]:
        if name == "strategy_analytics" and isinstance(payload, dict):
            f = payload.get("data_quality_flags")
            if isinstance(f, dict):
                flags = f
    return flags


# ---------------------------------------------------------------------------
# 1 — kill-switch fails closed with ZERO live read.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_disabled_fails_closed(monkeypatch) -> None:
    monkeypatch.delenv("MT5_ENABLED", raising=False)
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0}, deals=_canonical_deals()
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "not yet available" in (result.error_message or "").lower()
    # The go-dark gate fires BEFORE any decrypt/login/read — zero live calls.
    assert transport.calls == [], (
        f"a disabled mt5 derive must never touch the terminal; got {transport.calls!r}"
    )
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])


# ---------------------------------------------------------------------------
# 2 — the ONE backbone: hand literals at the JOB level + 252 echo.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_routes_one_backbone(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0}, deals=_canonical_deals()
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    series_conventions: dict = {}
    with _apply(_patches(ctx, capture_series=series_conventions)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    # The live read actually happened at the JOB level (proves the wiring, not
    # just the helper): login → account_info → history_deals_get.
    assert transport.calls[:3] == ["login", "account_info", "history_deals_get"]

    rows = _csv_rows(capture)
    # Hand literals (NEVER read back from the SUT). day3 is a gap-filled flat 0.0.
    assert rows["2025-06-02"] == pytest.approx(400 / 100_000, abs=1e-12)
    assert rows["2025-06-03"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2025-06-04"] == pytest.approx(300 / 100_400, abs=1e-12)
    assert rows["2025-06-05"] == pytest.approx(-200 / 110_700, abs=1e-12)
    # The deposit day is NOT the +10.26% cash spike (the load-bearing money bug).
    assert rows["2025-06-04"] != pytest.approx((110_700 - 100_400) / 100_400, abs=1e-6)

    # The mt5 → traditional → √252 clock, echoed at the cash_settlement seam.
    assert series_conventions.get("cash_settlement", {})["periods_per_year"] == 252

    # The strategy factsheet tail is enqueued (byte-unchanged downstream).
    enqueues = [c for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"]
    assert any(
        c[1].get("p_kind") == "compute_analytics_from_csv" for c in enqueues
    )


# ---------------------------------------------------------------------------
# 3 — uPnL wedge → complete_with_warnings.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_upnl_wedge_flags(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # equity 110_000, balance 100_000 → wedge 10_000; 10_000/110_000 ≈ 0.0909 > 0.05.
    # The canonical 4-day ledger keeps >=2 usable days (floor not tripped).
    transport = _FakeMt5Transport(
        account={"equity": 110_000.0, "balance": 100_000.0}, deals=_canonical_deals()
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    flags = _dq_flags(capture)
    assert flags.get("unrealized_pnl_in_anchor") is True, (
        f"a material realized-vs-MTM wedge must stamp unrealized_pnl_in_anchor "
        f"(complete_with_warnings); got flags={flags!r}"
    )


# ---------------------------------------------------------------------------
# 4 — a mid-read error fails the WHOLE job; nothing partial persists.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_read_error_fails_whole_job(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0},
        deals=[],
        read_exc=RuntimeError("kaboom mid-read"),  # unrecognized → transient
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    # The read error surfaced as a typed Mt5ClientError inside the client and was
    # classified (unrecognized → transient, retryable, no terminal stamp).
    assert result.error_kind == "transient"
    assert "history_deals_get" in transport.calls  # the error happened mid-read
    # NO partial series row and NO terminal analytics stamp (no-invented-data).
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"])


# ---------------------------------------------------------------------------
# 5 — an unclassifiable DEAL_TYPE is PERMANENT + terminal stamp, never a retry.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_unclassifiable_deal_permanent(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    deals = _canonical_deals()
    # A CORRECTION deal (type=5) — the deribit-'correction' fail-loud lesson.
    deals.append(
        {"type": 5, "profit": 42.0, "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": _epoch(2025, 6, 5)}
    )
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0}, deals=deals
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"  # never a forever-retry
    # A terminal 'failed' analytics stamp exists; NO partial series row.
    sa = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert sa, "an unclassifiable deal must stamp a terminal 'failed' analytics row"
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    # Leak-safety: the raise carries the DEAL_TYPE code, never the raw USD amount.
    assert "42" not in (result.error_message or "")


# ---------------------------------------------------------------------------
# 6 — a missing-history window renders as coverage-masked absence.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_missing_window_masked(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # Deals span only [06-03 .. 06-05] — a LATE window. No pre-06-03 evidence.
    deals = [
        {"type": 1, "entry": 1, "profit": 100.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 3)},
        {"type": 1, "entry": 1, "profit": 200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        {"type": 1, "entry": 1, "profit": -50.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 5)},
    ]
    transport = _FakeMt5Transport(
        account={"equity": 100_250.0, "balance": 100_250.0}, deals=deals
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    rows = _csv_rows(capture)
    assert rows, "expected a persisted series for a >=2-day late window"
    # NO row is fabricated before the first evidence day — absence renders as
    # ABSENT rows, never a fabricated flat run stretching back to the epoch.
    assert min(rows) >= "2025-06-03", (
        f"series must not fabricate rows before the first evidence day; got {sorted(rows)!r}"
    )
    assert max(rows) <= "2025-06-05"


# ---------------------------------------------------------------------------
# 7 — the long-fetch tail routes mt5 to derive_broker_dailies (never sync_trades).
# ---------------------------------------------------------------------------
def _ledger_supabase_mock() -> MagicMock:
    sb = MagicMock()
    table_chain = MagicMock()
    table_chain.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = MagicMock(
        data={"status": "draft"}
    )
    sb.table.return_value = table_chain
    sb.rpc.return_value = MagicMock(execute=MagicMock(return_value=MagicMock(data=None)))
    return sb


@pytest.mark.asyncio
async def test_long_fetch_tail_wiring() -> None:
    """MT5RECON-01: an mt5 onboard routes the queued long-fetch through the
    ledger tail (derive_broker_dailies) and NEVER the fill pipeline — mt5's
    Mt5Adapter.fetch_raw/compute_metrics raise by design. Mirrors the deribit/
    sfox tail-wiring tests."""
    from services.ingestion.adapter import ValidationResult

    assert "mt5" in _LEDGER_BACKED_SOURCES  # the set membership that drives it
    job = {
        "id": "job-mt5",
        "kind": "process_key_long",
        "strategy_id": "s-mt5",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-mt5",
            "source": "mt5",
            "flow_type": "onboard",
            "correlation_id": "cid-mt5",
            "context": {
                "strategy_id": "s-mt5", "api_key": "123456", "api_secret": "pw",
                "passphrase": "Broker-Live",
            },
        },
    }
    adapter = MagicMock()
    adapter.validate = AsyncMock(
        return_value=ValidationResult(
            valid=True, read_only=True, error_code=None, human_message=None,
            debug_context={},
        )
    )
    adapter.fetch_raw = AsyncMock(
        side_effect=AssertionError("fetch_raw must not run for mt5")
    )
    adapter.compute_metrics = MagicMock(
        side_effect=AssertionError("compute_metrics must not run for mt5")
    )
    adapter.compute_fingerprint = MagicMock(
        side_effect=AssertionError("compute_fingerprint must not run for mt5")
    )
    adapter.reconstruct_positions = AsyncMock(
        side_effect=AssertionError("reconstruct_positions must not run for mt5")
    )
    sb = _ledger_supabase_mock()

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb), \
         patch("services.encryption.encrypt_credentials", return_value={"v": 1}), \
         patch("services.encryption.get_kek", return_value=b"0" * 32):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.DONE
    adapter.fetch_raw.assert_not_called()
    adapter.compute_metrics.assert_not_called()

    enqueue = [
        c for c in sb.rpc.call_args_list
        if c.args and c.args[0] == "enqueue_compute_job"
    ]
    assert enqueue, "mt5 success must enqueue a ledger factsheet tail"
    assert enqueue[0].args[1]["p_kind"] == "derive_broker_dailies", (
        "a ledger-backed source must enqueue derive_broker_dailies, not sync_trades"
    )
    assert enqueue[0].args[1]["p_strategy_id"] == "s-mt5"


# ---------------------------------------------------------------------------
# 8 — ground-truth parity: reconstructed terminal NAV == account_info().equity.
# ---------------------------------------------------------------------------
def _forward_terminal_nav(
    returns_by_day: dict[str, float], *, initial: float, flows_by_day: dict[str, float]
) -> float:
    """Roll the equity curve FORWARD from a HAND-DERIVED initial capital using the
    flow-in-numerator identity NAV_t = NAV_{t-1}·(1+r_t) + F_t. This is the
    INDEPENDENT oracle: it never reads the SUT's own NAV, so if the branch computed
    the returns against a DRIFTED anchor, the terminal here diverges from the live
    account_info().equity and the parity assertion reddens."""
    nav = initial
    for day in sorted(returns_by_day):
        nav = nav * (1.0 + returns_by_day[day]) + flows_by_day.get(day, 0.0)
    return nav


@pytest.mark.asyncio
async def test_reconstruction_reconciles_to_equity(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    terminal_equity = 110_500.0  # account_info().equity — the ground truth
    transport = _FakeMt5Transport(
        account={"equity": terminal_equity, "balance": terminal_equity},
        deals=_canonical_deals(),
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    rows = _csv_rows(capture)

    # HAND-DERIVED oracle inputs (NEVER read back from the SUT):
    #   initial = 110_500 − Σpnl(500) − Σflow(10_000) = 100_000
    #   the sole external flow is the +10_000 deposit on 2025-06-04
    initial = 100_000.0
    flows_by_day = {"2025-06-04": 10_000.0}
    reconstructed_terminal = _forward_terminal_nav(
        rows, initial=initial, flows_by_day=flows_by_day
    )

    tol = max(1.0, 1e-6 * abs(terminal_equity))  # the nav_twr construction tolerance
    assert abs(reconstructed_terminal - terminal_equity) <= tol, (
        f"reconstructed terminal NAV {reconstructed_terminal} must reconcile to "
        f"account_info().equity {terminal_equity} within {tol}"
    )

    # TEETH (negative control): the gate is NOT vacuous — a $2 anchor drift on the
    # hand-derived initial would push the terminal OUTSIDE tolerance and redden.
    drifted = _forward_terminal_nav(
        rows, initial=initial + 2.0, flows_by_day=flows_by_day
    )
    assert abs(drifted - terminal_equity) > tol


# ---------------------------------------------------------------------------
# WR-02 regression — the MT5 deal-fetch upper-bound margin must cover the max
# plausible server-ahead-of-UTC offset so a same-day server-time deal is never
# clipped by the UTC-based bound. The invariant is enforced at module import by
# an assert on the two named constants (replacing the former bare ``86_400``);
# this test documents WHY and reddens if the margin is ever tightened below the
# offset bound (or the constants removed).
# ---------------------------------------------------------------------------


def test_deal_fetch_margin_covers_server_utc_offset_bound() -> None:
    """A broker whose server runs AHEAD of UTC stamps a just-happened deal with an
    epoch LATER than UTC ``now``. The fetch upper bound is ``utc_now + margin``, so
    a same-day deal on a server ``offset`` seconds ahead survives iff
    ``margin >= offset``. The margin must therefore cover the maximum plausible
    offset (real MT5 brokers are within ±13h). Encodes the invariant the module
    assert guards — a future tightening of the window that could silently drop
    same-day deals turns this RED."""
    assert jw._MT5_DEAL_FETCH_MARGIN_S >= jw._MT5_MAX_SERVER_UTC_OFFSET_S
    # A +13h-ahead server's same-day deal lands within the fetch window:
    utc_now = 1_700_000_000
    upper_bound = utc_now + jw._MT5_DEAL_FETCH_MARGIN_S
    same_day_deal_on_ahead_server = utc_now + jw._MT5_MAX_SERVER_UTC_OFFSET_S
    assert same_day_deal_on_ahead_server <= upper_bound
