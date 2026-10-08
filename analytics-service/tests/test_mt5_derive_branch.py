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

Phase-137 hardening (MT5CONC-01/02):
  * test_mt5_hung_read_restart_on_timeout — a wedged read blows the wall-clock
    bound → the terminal is ACTIVELY restarted (shutdown + re-connect) → transient,
    nothing persisted, the event loop stays live (137-01).
  * test_mt5_restart_itself_bounded — the restart's own shutdown also hangs but is
    bounded, so the job still returns transient promptly (never a nested wedge,
    137-01).
  * test_mt5_concurrent_syncs_serialized — two concurrent mt5 syncs CANNOT
    interleave on the ONE shared terminal (module-level per-terminal asyncio.Lock);
    embedded neutered-lock negative control proves the guarantee is not vacuous
    (MT5CONC-02).
  * test_mt5_login_bracket_pre_mismatch — the PRE-read login bracket rejects a
    wrong-account terminal → transient + restart, persist NOTHING, no user-blame,
    message carries only the two int logins (MT5CONC-02).
  * test_mt5_login_bracket_post_hijack — the POST-read bracket independently rejects
    a mid-read terminal re-login (MT5CONC-02).
  * test_mt5_login_field_missing_fails_loud — a missing "login" field fails loud,
    never default-matches (MT5CONC-02, Pitfall 3).
"""
from __future__ import annotations

import asyncio
import threading
import time
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
# ⚠️ Imported from the module that OWNS it (`services.mt5_client`), never through a
# re-export — a name reached through a re-export is a DIFFERENT binding and an
# assertion on it is a silent no-op (the 151 review-E2 rule). `job_worker`
# deliberately does not re-export the epoch registry at all.
from services.mt5_client import _mt5_epoch_for, bump_mt5_terminal_epoch
# 151 review E2 — the restart bound is READ from this leaf module, not from
# `job_worker` (Phase 151 moved the MT5 concurrency symbols out; job_worker only
# re-exports `_MT5_RESTART_TIMEOUT_S`). A monkeypatch aimed at `jw` is a SILENT
# no-op, so the bound must be patched HERE or the test that names it is vacuous.
import services.mt5_concurrency as mt5_conc


# ---------------------------------------------------------------------------
# Offline transport double (the mt5_client.py:158-162 _connect injection seam).
# ---------------------------------------------------------------------------
class _NT:
    """A netref-namedtuple stand-in: Mt5Client._materialize requires ._asdict()."""

    def __init__(self, d: dict) -> None:
        self._d = dict(d)

    def _asdict(self) -> dict:
        return dict(self._d)



class _FakeRpycConn:
    """The name-mangled `_MetaTrader5__conn` seam mt5linux 0.1.9 exposes — and since
    153.3-06 / **D-35** the ONLY thing `Mt5Client.close()`/`release()` touch.

    Present so these doubles EXERCISE the real transport teardown instead of falling
    through to the "no rpyc transport close reachable" WARNING branch, which would
    mean the close paths here were silently walking a route production never takes.
    """

    def __init__(self, calls: list) -> None:
        self._calls = calls
        self.close_calls = 0
        # rpyc classic's remote-namespace seam (MT5DEAL-01). `history_deals_get`
        # materializes deals on the FAR side of the wire, because doing it here
        # costs one round-trip per deal per field — MEASURED 60ms/deal live, 29.9s
        # for 493 deals against a 40s bound. `execute()` really execs, so these
        # doubles run the REAL remote source instead of a stand-in that could drift.
        self.namespace: dict = {}
        self.execute_calls = 0

    def execute(self, src: str) -> None:
        self.execute_calls += 1
        self._calls.append("execute")
        exec(src, self.namespace)  # noqa: S102 — running the real source is the point

    def close(self):
        self.close_calls += 1
        self._calls.append("transport_close")

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
        hang_s: float = 0.0,
        shutdown_hang_s: float = 0.0,
        second_account: dict | None = None,
        post_read_exc: Exception | None = None,
        deals_by_call: list[list[dict]] | None = None,
    ) -> None:
        self._account = account
        self._deals = deals
        # 164.6.6.3 / D-04 (Finding C): when set, the Nth `history_deals_get` call
        # returns the Nth list and the LAST list repeats — a history that arrives
        # AFTER the first read (a fresh login's download still running). `None`
        # keeps the single-list `deals` behaviour byte-identical.
        self._deals_by_call = deals_by_call
        self._history_calls = 0
        self._login_ok = login_ok
        self._deals_none = deals_none
        self._read_exc = read_exc
        self._last_error = last_error
        # MT5CONC-01: a BOUNDED real sleep (never an unbounded threading.Event) so a
        # broken regression drains and can never itself hang CI. hang_s simulates a
        # wedged history_deals_get; shutdown_hang_s a terminal too wedged to even
        # tear down (the restart-itself-bounded case).
        self._hang_s = hang_s
        self._shutdown_hang_s = shutdown_hang_s
        # MT5CONC-02: when set, the SECOND (and later) account_info() call returns
        # this snapshot — a mid-read terminal re-login/hijack that the POST login
        # bracket must catch independently of the PRE bracket.
        self._second_account = second_account
        # IN-01: when set, the SECOND (and later) account_info() call — i.e. the
        # ASSERTION-ONLY POST login bracket re-read — RAISES this, simulating a
        # transient transport blip AFTER the correct account's deals were fetched.
        self._post_read_exc = post_read_exc
        self._account_info_calls = 0
        self.calls: list[str] = []
        self._MetaTrader5__conn = _FakeRpycConn(self.calls)

    def initialize(self, **kwargs):
        # **kwargs: initialize() carries its own `timeout=` ms ceiling (153.3 / D-24).
        # Real login() attaches the terminal IPC via initialize() before login().
        self.calls.append("initialize")
        return True

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self.calls.append("login")
        return self._login_ok

    def account_info(self):
        self.calls.append("account_info")
        self._account_info_calls += 1
        if self._account_info_calls >= 2:
            if self._post_read_exc is not None:
                raise self._post_read_exc
            if self._second_account is not None:
                return _NT(self._second_account)
        return _NT(self._account)

    def history_deals_get(self, from_ts, to_ts):  # noqa: ANN001
        self.calls.append("history_deals_get")
        if self._hang_s:
            time.sleep(self._hang_s)  # simulate a wedged Wine/RPyC pipe
        if self._read_exc is not None:
            raise self._read_exc
        if self._deals_none:
            return None
        if self._deals_by_call is not None:
            idx = min(self._history_calls, len(self._deals_by_call) - 1)
            self._history_calls += 1
            return tuple(_NT(d) for d in self._deals_by_call[idx])
        return tuple(_NT(d) for d in self._deals)

    def order_check(self, **request):  # noqa: ANN001 - unused by the derive branch
        self.calls.append("order_check")
        return _NT({"retcode": 0})

    def last_error(self):
        return self._last_error

    def shutdown(self):
        self.calls.append("shutdown")
        if self._shutdown_hang_s:
            time.sleep(self._shutdown_hang_s)  # a teardown too wedged to complete


def _session(
    transport: _FakeMt5Transport, *, connects: list | None = None
) -> Mt5Session:
    """Build an Mt5Session over the offline transport double. When ``connects`` is
    provided, every connect() invocation appends to it so restart's re-connect is
    countable (len == 2 after one restart) — the single shared transport keeps its
    call log across the rebuild, so ``"shutdown" in transport.calls`` still proves
    the teardown happened."""

    def _connect(*, host, port, timeout):  # noqa: ANN001
        if connects is not None:
            connects.append(1)
        return transport

    client = Mt5Client("h", 1, _connect=_connect)
    return Mt5Session(
        client=client, login=123456, investor_password="pw", server="Broker-Live",
        venue_account_id="123456",
    )


# ---------------------------------------------------------------------------
# ctx / capture harness (mirrors test_derive_broker_dailies_dualmode._build_ctx).
# ---------------------------------------------------------------------------
def _build_ctx(
    transport: _FakeMt5Transport,
    *,
    asset_class: str = "traditional",
    connects: list | None = None,
) -> tuple[MagicMock, dict]:
    capture: dict = {"upserts": [], "rpc_calls": [], "deletes": [], "updates": []}
    ctx = MagicMock()
    ctx.exchange = _session(transport, connects=connects)
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

        def _update(payload: object, **kw: object) -> MagicMock:
            # Recorded per table so a write to ``api_keys`` is OBSERVABLE: without this an
            # "api_keys was updated" assertion passes vacuously on a bare MagicMock
            # (164.6.6.2 Wave 0). Chainable like the real builder: ``.eq(...).execute()``.
            capture["updates"].append((name, payload))
            chain = MagicMock()
            chain.eq.return_value = chain
            chain.execute.return_value = MagicMock(data=[payload], count=1)
            return chain

        tbl.update.side_effect = _update
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


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """MT5CONC-02: clear the module-level per-terminal asyncio.Lock registry between
    tests so a Lock created by one test (e.g. the concurrent-serialization test) can
    never leak into another and mask a regression.

    Since WIZFORM-ABANDON / D-36 it also clears the per-terminal EPOCH registry,
    via the ONE shared helper (RESEARCH Pitfall 8: a leaked epoch fences a client
    another test builds for the same key — a sixth flake mechanism). Routed
    through `mt5_concurrency` rather than `jw`: `jw._MT5_TERMINAL_LOCKS` is the
    very same dict object (Phase 151 moved it into the leaf and job_worker re-binds
    it), so nothing is lost — and the epoch registry is deliberately NOT re-exported
    into `jw`, so there is no `jw` name to reach it by."""
    mt5_conc.reset_terminal_state_for_tests()
    yield
    mt5_conc.reset_terminal_state_for_tests()


# ---------------------------------------------------------------------------
# 1 — kill-switch fails closed with ZERO live read.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_disabled_fails_closed(monkeypatch) -> None:
    monkeypatch.delenv("MT5_ENABLED", raising=False)
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}, deals=_canonical_deals()
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
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}, deals=_canonical_deals()
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    series_conventions: dict = {}
    with _apply(_patches(ctx, capture_series=series_conventions)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    # The live read actually happened at the JOB level (proves the wiring, not just
    # the helper). The EXACT 4-call sequence is pinned: login → account_info (PRE
    # login bracket) → history_deals_get → account_info (POST login bracket,
    # MT5CONC-02). Silent deletion of the POST bracket reds this healthy-path test.
    assert transport.calls == [
        "initialize",
        "login",
        "account_info",
        "history_deals_get",
        # MT5DEAL-01: deals materialize on the FAR side of the wire, so the
        # source crossing is a real round-trip and is recorded as one.
        "execute",
        # 164.6.6.3 / D-04 + WR-02: this is a FRESH login (the registry is empty), so
        # the settle loop makes TWO confirmation reads (the count must hold across
        # two full intervals) before the POST bracket.
        "history_deals_get",
        "execute",
        "history_deals_get",
        "execute",
        "account_info",
    ]

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
# 2b — 164.6.6.3 / D-04 (Finding C): a FRESH login's deal history arrives after
# the first read. THE tracer for item 0.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_fresh_login_history_arriving_late_is_read_once_settled(
    monkeypatch,
) -> None:
    """Finding C (`164.6.6-CONTEXT.md` `## Live verification 2026-10-04`, measured
    twice with about 62k and 141k USD of equity): the derive is the jobs terminal's
    FIRST login of a new account, `history_deals_get` is read about one second
    after authorization, MT5 has not finished downloading the history, and the
    read comes back EMPTY. The combine then sees zero usable days and stamps a
    funded account permanently with "<2 usable daily-return days".

    D-04: a fresh login polls until the deal count is stable across consecutive
    reads (WR-02: across two full intervals). Here the first read is empty and every
    later one is the full ledger, so the helper must read FOUR times (empty, full,
    then two full-again confirmations) and persist the full series. On the pre-phase code the single empty read was
    refused permanently."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=[],
        deals_by_call=[[], _canonical_deals()],
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        f"a late-arriving history must be waited for, not refused; "
        f"kind={result.error_kind!r} msg={result.error_message!r}"
    )
    assert transport.calls.count("history_deals_get") == 4
    rows = _csv_rows(capture)
    # The same hand literals test_mt5_routes_one_backbone asserts (NEVER read back
    # from the SUT).
    assert rows["2025-06-02"] == pytest.approx(400 / 100_000, abs=1e-12)
    assert rows["2025-06-03"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2025-06-04"] == pytest.approx(300 / 100_400, abs=1e-12)
    assert rows["2025-06-05"] == pytest.approx(-200 / 110_700, abs=1e-12)
    # No permanent "failed" stamp on the strategy.
    for name, payload, _oc in capture["upserts"]:
        if name == "strategy_analytics" and isinstance(payload, dict):
            assert payload.get("computation_status") != "failed", payload


# ---------------------------------------------------------------------------
# 2c — 164.6.6.3 / D-04, D-05, D-15: fresh versus cached is decided per
# (terminal, key) BEFORE login, and only a fresh login pays the wait or the
# raised bound.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_a_second_derive_of_a_settled_key_pays_no_wait(monkeypatch) -> None:
    """D-04 "an account whose history is already cached pays no wait", through the
    whole job. The first derive of the key is fresh and settles (three reads: the
    first and its two confirmations). The second derive of the SAME key finds it the
    terminal's previous holder AND settled, so it makes exactly one
    ``history_deals_get``. If the freshness decision were taken AFTER `login()`
    (which stamps the holder registry) or ignored the settled record, this count
    would be wrong in one direction or the other."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    account = {"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}

    first = _FakeMt5Transport(account=account, deals=_canonical_deals())
    ctx1, _cap1 = _build_ctx(first)
    with _apply(_patches(ctx1)):
        r1 = await run_derive_broker_dailies_job(_job())
    assert r1.outcome == DispatchOutcome.DONE
    assert first.calls.count("history_deals_get") == 3

    second = _FakeMt5Transport(account=account, deals=_canonical_deals())
    ctx2, _cap2 = _build_ctx(second)
    with _apply(_patches(ctx2)):
        r2 = await run_derive_broker_dailies_job(_job())
    assert r2.outcome == DispatchOutcome.DONE
    assert second.calls.count("history_deals_get") == 1


@pytest.mark.asyncio
async def test_the_derive_bound_adds_the_wait_only_for_a_fresh_login(
    monkeypatch,
) -> None:
    """D-05: the outer bound is the read budget PLUS the settle wait for a fresh
    login, and the read budget alone for a cached one (the 40 s wedge detector must
    not slacken for a cached read). Both are read from `jw` at call time.

    Each `history_deals_get` takes 0.4 s against a 0.3 s read budget and a 2.0 s
    wait. The fresh first run makes three reads (1.2 s, WR-02) and fits the raised bound.
    The cached second run makes one read (0.4 s) and must hit the TIMEOUT arm
    (shutdown, transient) — proof that the wait is added only when fresh."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setattr(jw, "_MT5_DERIVE_READ_TIMEOUT_S", 0.3)
    monkeypatch.setattr(jw, "_MT5_HISTORY_WAIT_S", 2.0)
    account = {"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}

    first = _FakeMt5Transport(account=account, deals=_canonical_deals(), hang_s=0.4)
    ctx1, _cap1 = _build_ctx(first)
    with _apply(_patches(ctx1)):
        r1 = await run_derive_broker_dailies_job(_job())
    assert r1.outcome == DispatchOutcome.DONE, (r1.error_kind, r1.error_message)
    assert "shutdown" not in first.calls

    second = _FakeMt5Transport(account=account, deals=_canonical_deals(), hang_s=0.4)
    ctx2, _cap2 = _build_ctx(second)
    with _apply(_patches(ctx2)):
        r2 = await run_derive_broker_dailies_job(_job())
    assert r2.outcome == DispatchOutcome.FAILED
    assert r2.error_kind == "transient"
    assert "shutdown" in second.calls, (
        "a cached read keeps the plain read budget, so its 0.4 s read reaches the "
        "timeout arm and the terminal restart"
    )


@pytest.mark.asyncio
async def test_the_fresh_derive_bound_budgets_one_trailing_read(monkeypatch) -> None:
    """Review WR-01: a fresh read's outer bound is read budget + settle wait + ONE
    trailing read's own timeout, because the settle loop's last read can start right
    at its deadline and then run for a whole rpyc timeout.

    The reads take 0.4 s each and a fresh run makes three (1.2 s). Read budget 0.3 s
    plus wait 0.5 s is 0.8 s: under the OLD formula (no trailing allowance) the outer
    `wait_for` fires first, the terminal is restarted mid-download and the job
    reports transient. With a 1.0 s trailing allowance the bound is 1.8 s and the run
    completes. Both knobs are patched where `jw` reads them at call time."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setattr(jw, "_MT5_DERIVE_READ_TIMEOUT_S", 0.3)
    monkeypatch.setattr(jw, "_MT5_HISTORY_WAIT_S", 0.5)
    monkeypatch.setattr(mt5_conc, "_MT5_HISTORY_TRAILING_READ_S", 1.0)
    account = {"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}

    transport = _FakeMt5Transport(account=account, deals=_canonical_deals(), hang_s=0.4)
    ctx, _cap = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        result.error_kind,
        result.error_message,
    )
    assert "shutdown" not in transport.calls, (
        "the outer bound fired mid-settle and restarted the terminal: it does not "
        "budget the trailing read (review WR-01, D-05)"
    )


# ---------------------------------------------------------------------------
# 2d — 164.6.6.3 / D-06, D-13: an expired wait is TRANSIENT and LOUD, never
# permanent, and never restarts the terminal.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_unsettled_history_is_transient_error_no_stamp(
    monkeypatch, caplog
) -> None:
    """A funded account (equity 110_500) whose deal history never arrives: the wait
    budget runs out and the derive must come back as a RETRYABLE transient with its
    own fixed message and one ERROR line (D-06, D-13).

    * never `permanent` and never a `strategy_analytics` failed stamp — the key is
      fine and the history is late, so blaming the strategy owner would be wrong;
    * never a terminal restart — a restart would kill the very download being
      waited for (`len(connects) == 1`, no `shutdown`);
    * the message is a fixed constant that classifies blame-free through the REAL
      `classify_mt5_login_error` (it lands in re-classifiable
      `compute_jobs.error_message`, D-42), and carries no equity, login or server.

    No new DB `error_kind` (D-13): that would be a migration that auto-applies to
    PROD with no reviewer gate.

    2026-10-07 (Phase 164.6.6.3.2 D-06): the arm now stamps on the FINAL attempt only.
    This test carries NO ``attempts`` / ``max_attempts`` on the job, so it pins the
    missing-count path (read as not-final, today's behaviour); the non-final and
    final-attempt paths have their own tests below. The "never a stamp" bullet above
    holds for every non-final path and is kept as written for lineage."""
    import logging

    from services.mt5_validation import classify_mt5_login_error

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=[],
    )
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    with caplog.at_level(logging.ERROR, logger="quantalyze.analytics"):
        with _apply(_patches(ctx)):
            result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient", (
        "an expired history wait is the most retryable condition there is; "
        "permanent burns a funded strategy to failed_final"
    )
    assert result.error_message == jw._MT5_HISTORY_UNSETTLED_MESSAGE
    _persisted_nothing(capture)  # no csv series and NO strategy_analytics stamp
    assert len(connects) == 1 and "shutdown" not in transport.calls, (
        "the wait expiry must never restart a healthy terminal"
    )
    errors = [
        r for r in caplog.records
        if r.levelno == logging.ERROR
        and "did not settle within the wait budget" in r.getMessage()
    ]
    assert len(errors) == 1, [r.getMessage() for r in caplog.records]
    shown = errors[0].getMessage() + (result.error_message or "")
    assert "110500" not in shown and "110_500" not in shown
    assert "Broker-Live" not in shown and "123456" not in shown
    assert (
        classify_mt5_login_error(Mt5ClientError(0, result.error_message or ""))
        == "transient"
    )


@pytest.mark.asyncio
async def test_unsettled_history_on_the_final_attempt_stamps_the_cause_sentence(
    monkeypatch,
) -> None:
    """Phase 164.6.6.3.2 / D-03, D-06 — on the FINAL attempt (the claim RPC returns the
    row after ``attempts = attempts + 1``, and ``mark_compute_job_failed`` makes a
    transient failure final when ``attempts >= max_attempts``) the history-unsettled
    arm writes ONE failed stamp carrying the curated user sentence and the 164.2
    provenance pair, so the wizard can name the real cause instead of "the fault is
    in our pipeline".

    The job still comes back FAILED / transient with the operator message: no new
    ``error_kind``, no terminal restart (164.6.6.3 D-13)."""
    from services.strategy_analytics_provenance import provenance_source

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=[],
    )
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    job = {**_job(), "attempts": 3, "max_attempts": 3}
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(job)

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert result.error_message == jw._MT5_HISTORY_UNSETTLED_MESSAGE
    stamps = [u for u in capture["upserts"] if u[0] == "strategy_analytics"]
    assert len(stamps) == 1, [u[0] for u in capture["upserts"]]
    payload = stamps[0][1]
    assert payload["computation_status"] == "failed"
    assert payload["computation_error"] == jw._MT5_HISTORY_UNSETTLED_USER_SENTENCE
    assert payload["computation_error_job_id"] == "j-mt5"
    assert payload["computation_error_source"] == provenance_source("j-mt5")
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert len(connects) == 1 and "shutdown" not in transport.calls, (
        "the wait expiry must never restart a healthy terminal"
    )


def _history_unsettled_transport() -> _FakeMt5Transport:
    """A funded account (material equity) whose deal history never arrives: the wait
    budget expires and the derive reaches the history-unsettled arm."""
    return _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=[],
    )


def _assert_reached_the_history_arm(result) -> None:  # noqa: ANN001
    """Without these three assertions a run that failed EARLIER for an unrelated reason
    would satisfy every "nothing was stamped" check vacuously."""
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert result.error_message == jw._MT5_HISTORY_UNSETTLED_MESSAGE


@pytest.mark.asyncio
async def test_unsettled_history_before_the_final_attempt_stamps_nothing(
    monkeypatch,
) -> None:
    """Phase 164.6.6.3.2 / D-06 — attempt 2 of 3 still retries, so the wizard must not
    flip to failed yet: same FAILED / transient result, and NO strategy_analytics write
    and no series (T-164.6.6.3.2-12)."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _history_unsettled_transport()
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    job = {**_job(), "attempts": 2, "max_attempts": 3}
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(job)

    _assert_reached_the_history_arm(result)
    _persisted_nothing(capture)
    assert len(connects) == 1 and "shutdown" not in transport.calls


@pytest.mark.asyncio
async def test_unsettled_history_with_one_missing_count_stamps_nothing(
    monkeypatch,
) -> None:
    """Phase 164.6.6.3.2 / D-06 — a job row carrying only ONE of the two counts cannot
    prove finality, so it reads as not-final (today's behaviour), whichever count is
    missing. ``attempts`` already past ``max_attempts`` by value would be final; the
    absence of ``max_attempts`` must not be read as zero."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    for partial in ({"attempts": 3}, {"max_attempts": 3}, {"attempts": None, "max_attempts": None}):
        transport = _history_unsettled_transport()
        ctx, capture = _build_ctx(transport)
        with _apply(_patches(ctx)):
            result = await run_derive_broker_dailies_job({**_job(), **partial})
        _assert_reached_the_history_arm(result)
        _persisted_nothing(capture)


@pytest.mark.asyncio
async def test_unsettled_history_in_key_mode_stamps_nothing_even_on_the_final_attempt(
    monkeypatch,
) -> None:
    """Phase 164.6.6.3.2 / D-06 — an ``api_key_id`` job owns no strategy_analytics row:
    ``_stamp_strategy_analytics_failed`` returns early in key mode, so the final-attempt
    arm writes nothing there. The reached-the-arm assertions prove the key-mode run got
    as far as the history wait rather than failing earlier."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _history_unsettled_transport()
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    job = {
        "id": "j-mt5-key",
        "kind": "derive_broker_dailies",
        "api_key_id": "key-mt5",
        "attempts": 3,
        "max_attempts": 3,
    }
    with _apply(
        _patches(ctx)
        + [
            patch(
                "services.job_worker._allocator_key_preflight",
                new=AsyncMock(return_value=ctx),
            )
        ]
    ):
        result = await run_derive_broker_dailies_job(job)

    _assert_reached_the_history_arm(result)
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"]), [
        u[0] for u in capture["upserts"]
    ]
    assert len(connects) == 1 and "shutdown" not in transport.calls


def test_unsettled_history_user_sentence_is_scrub_invariant_and_carries_no_email() -> None:
    """Phase 164.6.6.3.2 / D-05, T-164.6.6.3.2-10 — the stamped sentence is curated user
    copy that renders verbatim, so it must survive ``scrub_freeform_string`` UNCHANGED
    (a scrub that rewrote it would silently break the wizard's exact-equality match) and
    must name no contact address: the contact form is the pointer."""
    from services.redact import scrub_freeform_string

    sentence = jw._MT5_HISTORY_UNSETTLED_USER_SENTENCE
    assert sentence == str(scrub_freeform_string(sentence))
    assert "@" not in sentence


# ---------------------------------------------------------------------------
# 3 — uPnL wedge → complete_with_warnings.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_upnl_wedge_flags(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # equity 110_000, balance 100_000 → wedge 10_000; 10_000/110_000 ≈ 0.0909 > 0.05.
    # The canonical 4-day ledger keeps >=2 usable days (floor not tripped).
    transport = _FakeMt5Transport(
        account={"equity": 110_000.0, "balance": 100_000.0, "currency": "USD", "login": 123456}, deals=_canonical_deals()
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
# 3b — NEGATIVE CONTROL: a flat equity==balance account (wedge 0) must NOT
# stamp unrealized_pnl_in_anchor on the mt5 derive branch specifically. The
# positive test above pins that the flag FIRES; without this, a wiring bug that
# spuriously always-stamps the flag on the mt5 open_unrealized_usd = equity −
# balance seam (broker_dailies.py) would pass every mt5 test. The non-mt5 "no
# wedge → no flag" controls live in test_job_worker.py, so the mt5 wiring needs
# its own. Reddens if the flag is always-on.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_no_wedge_does_not_flag(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # equity == balance == 100_000 → wedge 0 → 0/100_000 = 0.0 < 0.05 ratio.
    # Same canonical 4-day ledger (>=2 usable days, floor not tripped) as the
    # positive test, so the ONLY difference is the zeroed uPnL wedge.
    transport = _FakeMt5Transport(
        account={"equity": 100_000.0, "balance": 100_000.0, "currency": "USD", "login": 123456}, deals=_canonical_deals()
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    flags = _dq_flags(capture)
    assert flags.get("unrealized_pnl_in_anchor") is not True, (
        f"a flat equity==balance account has NO uPnL wedge — the flag must not be "
        f"stamped (guards against an always-on wiring bug); got flags={flags!r}"
    )


# ---------------------------------------------------------------------------
# 4 — a mid-read error fails the WHOLE job; nothing partial persists.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_read_error_fails_whole_job(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
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


@pytest.mark.asyncio
async def test_wrong_server_at_derive_is_transient_not_permanent(monkeypatch) -> None:
    """RED-TEAM: at DERIVE the key ALREADY validated, so a connection/bridge error
    must be TRANSIENT (retry, NO user-blame stamp), NOT a permanent 'bad
    credentials or wrong broker server' failure. A routine gateway redeploy
    mid-derive must never permanently kill a valid strategy and blame the user's
    creds. Reddens against the old `_kind in ('auth','wrong_server') -> permanent`
    classification.

    ⚠️ 164.5.4: the classifier itself used to MANUFACTURE the 'wrong_server' this
    arm has to absorb — its table carried the bare tokens 'connect', 'network' and
    'terminal', so any bridge error matched. `_WRONG_SERVER_PHRASES` is anchored
    now and such text degrades to 'transient' by the refusal rule. ⛔ The ROUTING
    is still what this case pins and it must not be relaxed: the derive arm must
    absorb a 'wrong_server' verdict whatever text produced it, because a genuine
    broker-server rejection at derive time is still OUR problem to retry, not the
    user's to be blamed for."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=[],
        # str contains "connection" → the 'connect' wrong_server token.
        read_exc=ConnectionResetError("Connection reset by peer during history read"),
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"  # NOT permanent — the key validated once
    # A transient must NOT stamp a terminal user-blame analytics row.
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"])


@pytest.mark.asyncio
async def test_balance_flow_with_none_profit_does_not_crash(monkeypatch) -> None:
    """RED-TEAM: a BALANCE/CREDIT deal with an explicit profit=None PASSES the
    combine (which None-coalesces to 0.0) — the worker's flow-EVIDENCE loop must
    None-coalesce IDENTICALLY. A raw float(None) there would raise TypeError AFTER
    the series was already computed, burning transient retries to failed_final with
    no stamp. The job must COMPLETE. Reddens against the raw float(profit) fold."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    deals = _canonical_deals()
    # The canonical BALANCE deposit (type=2) but with a missing profit field.
    deals[1] = {**deals[1], "profit": None}
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}, deals=deals
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    # No TypeError crash — the evidence fold tolerated what the money fold does.
    assert result.outcome == DispatchOutcome.DONE


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
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456}, deals=deals
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
        account={"equity": 100_250.0, "balance": 100_250.0, "currency": "USD", "login": 123456}, deals=deals
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
async def test_long_fetch_tail_wiring(monkeypatch) -> None:
    """MT5RECON-01: an mt5 onboard routes the queued long-fetch through the
    ledger tail (derive_broker_dailies) and NEVER the fill pipeline — mt5's
    Mt5Adapter.fetch_raw/compute_metrics raise by design. Mirrors the deribit/
    sfox tail-wiring tests."""
    from services.ingestion.adapter import ValidationResult

    # Go-live state: the RED-TEAM long_fetch kill-switch (mt5 + not
    # mt5_enabled_server() → permanent skip before adapter.validate) requires the
    # server flag ON for the tail to run. The disabled default is pinned separately
    # in test_long_fetch_mt5_disabled_skips_probe below.
    monkeypatch.setenv("MT5_ENABLED", "true")

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


@pytest.mark.asyncio
async def test_long_fetch_mt5_disabled_skips_probe(monkeypatch) -> None:
    """RED-TEAM defense-in-depth kill-switch: an mt5 onboard/resync job that drains
    AFTER an incident rollback (MT5_ENABLED off) must FAIL CLOSED permanent WITHOUT
    firing a live probe — adapter.validate is never called. Mirrors the worker
    derive arm + the TS/router gates. Reddens if the long_fetch gate is removed."""
    monkeypatch.delenv("MT5_ENABLED", raising=False)

    job = {
        "id": "job-mt5-off",
        "kind": "process_key_long",
        "strategy_id": "s-mt5",
        "metadata": {
            "unified_backbone_at_claim": "true",
            "verification_id": "v-mt5-off",
            "source": "mt5",
            "flow_type": "onboard",
            "correlation_id": "cid-mt5-off",
            "context": {
                "strategy_id": "s-mt5", "api_key": "123456", "api_secret": "pw",
                "passphrase": "Broker-Live",
            },
        },
    }
    adapter = MagicMock()
    adapter.validate = AsyncMock(
        side_effect=AssertionError("no live probe when MT5_ENABLED is off")
    )
    sb = _ledger_supabase_mock()

    with patch("services.ingestion.long_fetch.get_adapter", return_value=adapter), \
         patch("services.ingestion.long_fetch.get_supabase", return_value=sb):
        result = await run_process_key_long_job(job)

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "not yet available" in (result.error_message or "").lower()
    adapter.validate.assert_not_called()


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
        account={"equity": terminal_equity, "balance": terminal_equity, "currency": "USD", "login": 123456},
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
# 9 — MT5CONC-01: a hung terminal read times out, is ACTIVELY restarted, and the
# job returns transient — never wedging the worker, never persisting anything.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_hung_read_restart_on_timeout(monkeypatch) -> None:
    """A wedged history_deals_get blows past the read bound → the wait_for fires →
    the terminal is ACTIVELY restarted (connect re-invoked AND shutdown called) →
    the job returns transient with NOTHING persisted, while a concurrent ticker
    proves the event loop never blocked. This is a WIRING test: it reddens if the
    _mt5_bounded_restart call is removed from the TimeoutError branch."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    # Read bound well under the hang so the wait_for fires; the hang is a BOUNDED
    # real sleep so the abandoned reader thread drains and can never hang CI.
    monkeypatch.setattr(jw, "_MT5_DERIVE_READ_TIMEOUT_S", 0.1)
    # 164.6.6.3 / D-05: a fresh login's bound is the read budget PLUS the settle
    # wait PLUS one trailing read's timeout (review WR-01); zero both so the bound
    # this test measures stays 0.1 s.
    monkeypatch.setattr(jw, "_MT5_HISTORY_WAIT_S", 0.0)
    monkeypatch.setattr(mt5_conc, "_MT5_HISTORY_TRAILING_READ_S", 0.0)
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
        hang_s=1.0,
    )
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    assert len(connects) == 1  # the Mt5Client ctor connected once

    # A loop-liveness ticker: if the read blocked the event loop (rather than
    # running off it via to_thread), this task could never advance during the hang.
    ticks = {"n": 0}

    async def _ticker() -> None:
        while True:
            ticks["n"] += 1
            await asyncio.sleep(0.01)

    ticker_task = asyncio.create_task(_ticker())
    try:
        with _apply(_patches(ctx)):
            result = await run_derive_broker_dailies_job(_job())
    finally:
        ticker_task.cancel()

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"  # NEVER permanent from a single hang
    # The terminal was ACTIVELY restarted: shutdown fired AND connect re-invoked so
    # the next retry hits a fresh terminal (fails if the restart call is removed).
    assert "shutdown" in transport.calls
    assert len(connects) == 2, (
        f"the timeout branch must actively restart (re-connect) the terminal; "
        f"connect invocations={len(connects)!r}"
    )
    # The event loop stayed live throughout the in-thread hang.
    assert ticks["n"] > 0, "the event loop was blocked during the mt5 read hang"
    # NO fabricated partial series and NO terminal stamp on the timeout path.
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"])


# ---------------------------------------------------------------------------
# 10 — MT5CONC-01: the restart is ITSELF bounded — a terminal too wedged to even
# tear down can never nest-wedge the worker; the job still returns transient fast.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_restart_itself_bounded(monkeypatch) -> None:
    """The read hangs (→ restart), and the restart's own shutdown ALSO hangs past a
    tiny restart bound. The job must STILL return transient PROMPTLY (bounded wall-
    clock, well under the summed genuine hang durations) — the never-nested-wedge
    proof. Without the to_thread + wait_for bound on the restart, the hung shutdown
    would wedge the sequential worker exactly as the original read hang would.

    151 review E2 — THE TWO PATCH TARGETS ARE DIFFERENT MODULES, ON PURPOSE.
    `job_worker` READS `_MT5_DERIVE_READ_TIMEOUT_S` at its own call sites, so
    patching `jw` binds it. It does NOT read `_MT5_RESTART_TIMEOUT_S` — it only
    re-exports the name; `_mt5_bounded_restart` reads it from
    `services.mt5_concurrency`, where Phase 151 moved it. Patching `jw` for that
    one is a SILENT no-op: the real ~10s bound stays in force and the assertion
    passes on the shutdown hang alone, which is exactly the bound the test is
    supposed to prove fires. Re-point either patch at the wrong module and this
    test stops testing what its name claims WITHOUT going red."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setattr(jw, "_MT5_DERIVE_READ_TIMEOUT_S", 0.1)
    # 164.6.6.3 / D-05: a fresh login's bound is the read budget PLUS the settle
    # wait PLUS one trailing read's timeout (review WR-01); zero both so the bound
    # this test measures stays 0.1 s.
    monkeypatch.setattr(jw, "_MT5_HISTORY_WAIT_S", 0.0)
    monkeypatch.setattr(mt5_conc, "_MT5_HISTORY_TRAILING_READ_S", 0.0)
    monkeypatch.setattr(mt5_conc, "_MT5_RESTART_TIMEOUT_S", 0.05)
    read_hang, shutdown_hang = 0.3, 1.0  # genuine hangs the bounds must cut short
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
        hang_s=read_hang,
        shutdown_hang_s=shutdown_hang,
    )
    ctx, capture = _build_ctx(transport)

    start = time.monotonic()
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())
    elapsed = time.monotonic() - start

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    # 151 review E2 — THE BAR IS `shutdown_hang` ALONE, NOT THE SUM.
    #
    # The old bar (`read_hang + shutdown_hang`) could not distinguish a restart
    # bound that fired from one that did not: with the read bound at 0.1s an
    # UNBOUNDED restart returns at ~0.1 + shutdown_hang, which sat comfortably
    # under the summed bar and passed. So the assertion held even while the
    # `_MT5_RESTART_TIMEOUT_S` patch was aimed at the wrong module and the real
    # ~10s bound was in force — the test was green on the shutdown hang running
    # to completion, i.e. on the very failure it exists to catch.
    #
    # Below `shutdown_hang` there is only one way to arrive: the restart's own
    # wait_for cut the hung teardown short. Bounded ⇒ ~0.15s (0.1 read + 0.05
    # restart); unbounded ⇒ ≥ 0.1 + shutdown_hang, which EXCEEDS this bar by
    # construction, so the failure mode is deterministic rather than timing-lucky.
    assert elapsed < shutdown_hang, (
        f"the bounded restart must return before the hung shutdown "
        f"({shutdown_hang}s) could even have completed; elapsed={elapsed:.3f}s"
    )


# ---------------------------------------------------------------------------
# 11 — MT5CONC-02: two concurrent mt5 syncs CANNOT interleave on the ONE shared
# terminal — serialized by the module-level per-terminal asyncio.Lock keyed by
# host:port. Deterministic in BOTH directions (embedded negative control): with the
# lock the first job's terminal block is contiguous (its exit precedes the second
# job's enter); with a neutered lock (a fresh Lock per call — the Session-attached
# anti-pattern) the second job's login is DRIVEN into the first job's read window
# and the contiguity guarantee reddens. Bounded waits ONLY — a broken lock reds,
# never hangs CI.
# ---------------------------------------------------------------------------
class _OrderedMt5Transport(_FakeMt5Transport):
    """Records an (tag, enter/exit) bracket into a SHARED cross-job order log so a
    cross-job interleave on the terminal is observable. Job A parks (bounded) in its
    read until job B logs in; under the lock B cannot log in while A holds it, so A
    times out and its block stays contiguous."""

    def __init__(self, tag, *, order, b_login_done, **kw):  # noqa: ANN001
        super().__init__(**kw)
        self._tag = tag
        self._order = order
        self._b_login_done = b_login_done

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self._order.append((self._tag, "enter"))
        if self._tag == "B":
            self._b_login_done.set()
        return super().login(login, password, server, timeout)

    def history_deals_get(self, from_ts, to_ts):  # noqa: ANN001
        if self._tag == "A":
            # Bounded park: under the lock, B is blocked on the SAME terminal lock
            # and can never set this, so A times out and its block stays contiguous.
            # Without the lock, B logs in during this park and the interleave is
            # recorded. 0.25s bound → a broken lock reds, never hangs CI.
            self._b_login_done.wait(0.25)
        out = super().history_deals_get(from_ts, to_ts)
        self._order.append((self._tag, "exit"))
        return out


async def _run_two_concurrent_mt5(neuter_lock: bool) -> list:
    order: list = []
    b_login_done = threading.Event()

    def _mk(tag: str):
        t = _OrderedMt5Transport(
            tag,
            order=order,
            b_login_done=b_login_done,
            account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
            deals=_canonical_deals(),
        )
        ctx, _cap = _build_ctx(t)
        return ctx

    ctx_by_sid = {"strat-a": _mk("A"), "strat-b": _mk("B")}

    async def _preflight(job, _name):  # noqa: ANN001
        return ctx_by_sid[job["strategy_id"]]

    patchers = [
        patch(
            "services.job_worker._exchange_preflight",
            new=AsyncMock(side_effect=_preflight),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.job_worker.db_execute",
            new=AsyncMock(side_effect=lambda fn: fn()),
        ),
    ]
    if neuter_lock:
        # A FRESH Lock per call serializes NOTHING — this is exactly what a
        # Session-attached lock (fresh session per job) would do.
        #
        # ⚠️ 151 review E2, RE-POINTED by WIZFORM-ABANDON / plan 153.5-03. The
        # target used to be `services.job_worker._mt5_terminal_lock_for`, which
        # bound because job_worker READ that name at its own `async with`. It no
        # longer does: the acquisition goes through `mt5_terminal_lease`, which
        # resolves `_mt5_terminal_lock_for` from `services.mt5_concurrency`'s OWN
        # globals. A patch left aimed at `job_worker` is now a SILENT NO-OP.
        #
        # ⭐ This one is self-detecting rather than silent, which is why it is safe
        # to rely on: with the patch mis-aimed the real registry serializes the two
        # jobs and the interleave assertion below reddens with the fully-contiguous
        # order log [('A','enter'),('A','exit'),('B','enter'),('B','exit')] —
        # OBSERVED during 153.5-03 before the re-point. Green here therefore means
        # the patch genuinely bound.
        patchers.append(
            patch(
                "services.mt5_concurrency._mt5_terminal_lock_for",
                new=lambda _k: asyncio.Lock(),
            )
        )
        # ⭐ ONE CONTROL, ONE VARIABLE (WIZFORM-ABANDON / plan 153.5-03). This arm
        # isolates the **LOCK**; the abandoned-session **FENCE** is a DIFFERENT
        # variable and must be held still, or the control stops measuring what it
        # names.
        #
        # Why it must be held still here specifically: with the lock neutered, A
        # and B genuinely interleave against a LIVE epoch registry. Both clients
        # bind epoch 0 at login; B's lease release bumps it to 1 while A is still
        # mid-read, so A's POST-read `account_info()` legitimately raises
        # `Mt5SessionAbandoned`. `run_derive_broker_dailies_job` has no arm for it
        # (the D-40 classification arms are plan 153.5-04's), so it escapes the job
        # and fails the bare `asyncio.gather` below INSTEAD of the interleave
        # assertion this test exists to make.
        #
        # OBSERVED, not predicted: 2 failures in 10 consecutive local runs before
        # this patch was added, each
        #   `services.mt5_client.Mt5SessionAbandoned: MT5 session abandoned: the
        #    lease under which it operated has ended`  (mt5_client.py:688)
        # — i.e. a genuinely timing-ordered flake, the exact kind D-37 forbids
        # adding to this suite.
        #
        # ⛔ Do NOT "fix" this by catching `Mt5SessionAbandoned` in the harness. A
        # harness that swallows a refusal stays green when a future change makes
        # the fence fire on a path it should not — the same blindness the E2
        # re-point above just removed.
        #
        # ⚠️ The target is `services.mt5_concurrency`, NOT `services.mt5_client`
        # that DEFINES the function: `mt5_terminal_lease` binds the name into
        # mt5_concurrency's globals at import, so that is the reader (E2). MEASURED
        # in-session — patching `services.mt5_client.bump_mt5_terminal_epoch` leaves
        # the observed per-lease epoch delta at 1 (a silent no-op); patching
        # `services.mt5_concurrency.bump_mt5_terminal_epoch` takes it to 0.
        patchers.append(
            patch(
                "services.mt5_concurrency.bump_mt5_terminal_epoch",
                new=lambda _k: 0,
            )
        )

    async def _run_a():
        return await run_derive_broker_dailies_job(
            {"id": "j-a", "kind": "derive_broker_dailies", "strategy_id": "strat-a"}
        )

    async def _run_b():
        # A tiny head start for A so the ordering under test is deterministic (A
        # acquires the terminal lock first); bounded and independent of the lock.
        await asyncio.sleep(0.05)
        return await run_derive_broker_dailies_job(
            {"id": "j-b", "kind": "derive_broker_dailies", "strategy_id": "strat-b"}
        )

    with _apply(patchers):
        await asyncio.gather(_run_a(), _run_b())
    return order


@pytest.mark.asyncio
async def test_mt5_concurrent_syncs_serialized(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")

    # WITH the lock: the first job to enter completes its terminal block (exit)
    # before the second job enters — no interleave on the shared terminal.
    order = await _run_two_concurrent_mt5(neuter_lock=False)
    first_tag = order[0][0]
    first_exit = order.index((first_tag, "exit"))
    other_enter = next(
        i for i, (t, ev) in enumerate(order) if t != first_tag and ev == "enter"
    )
    assert other_enter > first_exit, (
        f"two concurrent mt5 syncs interleaved on the ONE shared terminal — the "
        f"per-terminal lock did not serialize them: {order!r}"
    )

    # TEETH (embedded negative control): neuter the lock (a fresh Lock per call) and
    # the second job's login is driven into the first job's read window — the
    # contiguity guarantee reddens, proving the positive assertion is not vacuous.
    neutered = await _run_two_concurrent_mt5(neuter_lock=True)
    n_first = neutered[0][0]
    n_first_exit = neutered.index((n_first, "exit"))
    n_other_enter = next(
        i for i, (t, ev) in enumerate(neutered) if t != n_first and ev == "enter"
    )
    assert n_other_enter < n_first_exit, (
        f"with the lock neutered the concurrent syncs MUST interleave (else the "
        f"positive assertion is vacuous); got {neutered!r}"
    )


# ---------------------------------------------------------------------------
# 11b — WIZFORM-ABANDON / D-36 / ABANDON-05: the derive job's terminal RELEASE
# advances the epoch. This is the precondition for the whole fence: the derive
# read is finding #5's OWN path, and at HEAD it acquired the raw Lock, which has
# no release hook. A bump that lived only in `mt5_terminal_lease` would have left
# this path bumping NOTHING — with every existing test green.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_derive_release_bumps_the_terminal_epoch_exactly_once(
    monkeypatch,
) -> None:
    """EXACT delta, hand-typed, not "changed" and not `len(holds)`.

    A healthy derive job takes the terminal lease exactly ONCE (one
    `async with mt5_terminal_lease(...)` around the whole IPC region — the
    post-read combine/persist is deliberately outside it), so the epoch must
    advance by exactly 1. A "non-zero / it changed" assertion would pass for a
    DOUBLE bump too, and a double bump is not harmless: the extra generation
    fences a successor that legitimately holds the terminal (the F8 failure mode
    plan 01 already had to design against).
    """
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
    )
    ctx, capture = _build_ctx(transport)
    # ⭐ The SHIPPED property, never a retyped "host:port" — a hand-typed key that
    # drifts from `Mt5Client.terminal_key` would measure an unrelated registry slot
    # and read 0 → 0 forever, i.e. pass by measuring nothing.
    key = ctx.exchange.client.terminal_key
    before = _mt5_epoch_for(key)

    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    # The read really happened (otherwise a fails-closed job would "prove" the
    # bump by never taking the lease at all).
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert "history_deals_get" in transport.calls

    assert _mt5_epoch_for(key) - before == 1, (
        f"the derive job's terminal release must advance the epoch by EXACTLY 1 "
        f"(one lease hold); got {_mt5_epoch_for(key) - before} for key={key!r}. "
        f"0 means the acquisition bypassed `mt5_terminal_lease` and released "
        f"through the raw Lock, which has no release hook — every downstream "
        f"abandoned-session fence is disarmed on THE path finding #5 runs on."
    )


def _persisted_nothing(capture: dict) -> None:
    """MT5CONC-02 assertion helper: a login-bracket mismatch persists NOTHING — no
    daily series AND (critically) no user-attributed strategy_analytics 'failed'
    stamp (a mismatch is a terminal/infra fault, never user-blame)."""
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"]), (
        f"a login-bracket mismatch must NOT persist any daily series; "
        f"upserts={[u[0] for u in capture['upserts']]!r}"
    )
    assert not any(u[0] == "strategy_analytics" for u in capture["upserts"]), (
        f"a login-bracket mismatch must NOT stamp a user-blame analytics row; "
        f"upserts={[u[0] for u in capture['upserts']]!r}"
    )


# ---------------------------------------------------------------------------
# 12 — MT5CONC-02: the PRE-read login bracket. The terminal presents a DIFFERENT
# account than the connected key → fail loud (transient), restart, persist NOTHING,
# never user-blame; the message carries ONLY the two int logins, never a secret.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_login_bracket_pre_mismatch(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # account_info().login (999999) != the connected key's login (123456).
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 999_999},
        deals=_canonical_deals(),
    )
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    # A mis-routed terminal is a stale-pipe INFRA fault → transient + restart (A3),
    # never a permanent user-blame failure.
    assert result.error_kind == "transient"
    assert "shutdown" in transport.calls  # bounded restart fired
    assert len(connects) == 2, "the mismatch branch must actively restart (re-connect)"
    _persisted_nothing(capture)
    # The message names BOTH int logins but NEVER the server/password.
    msg = result.error_message or ""
    assert "123456" in msg and "999999" in msg
    assert "Broker-Live" not in msg and "pw" not in msg
    # The PRE bracket fired BEFORE the deal read — history_deals_get never ran.
    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# 13 — MT5CONC-02: the POST-read login bracket (independent of the PRE bracket). A
# mid-read terminal re-login (account_info returns the right login first, a wrong
# one second) is caught AFTER the deal read → same fail-loud/persist-nothing outcome.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_login_bracket_post_hijack(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # PRE account_info → login 123456 (matches); POST account_info → login 999999
    # (a mid-read hijack). Only the POST bracket can catch this.
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
        second_account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 999_999},
    )
    connects: list = []
    ctx, capture = _build_ctx(transport, connects=connects)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    assert len(connects) == 2, "the POST-bracket mismatch must also restart"
    # The deal read DID run (PRE passed), then the POST bracket re-read and rejected
    # — the first ten terminal calls are the full read sequence (a trailing
    # "shutdown" from the bounded restart follows).
    assert transport.calls[:10] == [
        "initialize",
        "login",
        "account_info",
        "history_deals_get",
        # MT5DEAL-01: deals materialize on the FAR side of the wire, so the
        # source crossing is a real round-trip and is recorded as one.
        "execute",
        # 164.6.6.3 / D-04 + WR-02: this is a FRESH login (the registry is empty), so
        # the settle loop makes TWO confirmation reads (the count must hold across
        # two full intervals) before the POST bracket.
        "history_deals_get",
        "execute",
        "history_deals_get",
        "execute",
        "account_info",
    ]
    assert "shutdown" in transport.calls  # the bounded restart fired
    _persisted_nothing(capture)
    msg = result.error_message or ""
    assert "123456" in msg and "999999" in msg
    assert "Broker-Live" not in msg and "pw" not in msg


# ---------------------------------------------------------------------------
# 14 — MT5CONC-02: a MISSING login field must FAIL LOUD (never default-match). A
# terminal snapshot without "login" is a degenerate/mis-routed read — treat it
# exactly like a mismatch (Pitfall 3), never silently accept it.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_login_field_missing_fails_loud(monkeypatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "true")
    # No "login" key at all — the bracket must NOT default-match against the key.
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD"},
        deals=_canonical_deals(),
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    _persisted_nothing(capture)
    # The PRE bracket fired before the deal read (missing field never reaches it).
    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# 15 — IN-01: a TRANSIENT transport blip on the ASSERTION-ONLY POST login bracket
# re-read (the correct account's deals were ALREADY fetched) must be classified
# TRANSIENT (re-queue), NOT routed through the permanent login-failure classify/
# stamp arm. A generic post-read blip whose scrubbed text classifies as
# auth/wrong_server would otherwise burn the job to a PERMANENT user-blame 'failed'
# even though the economic read of the correct account succeeded.
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_mt5_post_read_transient_blip_is_not_permanent(monkeypatch) -> None:
    """The PRE bracket + login + deal fetch all succeed on the CORRECT account; the
    POST re-read then hits a transient transport blip ("connection reset ...") that
    ``classify_mt5_login_error`` read as ``wrong_server`` while its table carried
    the bare "connect" token → PERMANENT + user-blame stamp under the old
    shared-arm routing. IN-01 reroutes it: a failure to RE-CONFIRM the
    already-verified account is a retry-worthy verification gap, so the job is
    TRANSIENT with NOTHING stamped.

    ⚠️ 164.5.4 narrowed the OTHER half: `_WRONG_SERVER_PHRASES` is anchored on the
    broker-server lookup, so this blip's text now degrades to ``transient`` at the
    classifier too. ⛔ That is belt AND braces, not a reason to drop the reroute —
    the reroute must hold for a message that genuinely IS recognised, and the
    refusal rule governs only the ones that are not.

    Reds against the pre-fix code (error_kind == "permanent" and a strategy_analytics
    'failed' stamp present). Trust is untouched: a genuine wrong-account POST read
    raises Mt5AccountMismatchError (covered by test_mt5_login_bracket_post_hijack),
    not the transient blip exercised here.
    """
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
        # A raw transport blip on the POST re-read. The client wraps it into a
        # scrubbed Mt5ClientError; its text carries the "connect" token, so the
        # login-failure classifier would call it wrong_server (permanent) — exactly
        # the mis-classification IN-01 prevents.
        post_read_exc=RuntimeError("connection reset during account re-read"),
    )
    ctx, capture = _build_ctx(transport)
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.FAILED
    # THE IN-01 assertion: a POST-read blip is retry-worthy, never a permanent
    # credential verdict.
    assert result.error_kind == "transient"
    # The blip fired on the POST re-read: the full 4-call read sequence ran (login →
    # PRE account_info → deal fetch → POST account_info which raised).
    assert transport.calls == [
        "initialize",
        "login",
        "account_info",
        "history_deals_get",
        # MT5DEAL-01: deals materialize on the FAR side of the wire, so the
        # source crossing is a real round-trip and is recorded as one.
        "execute",
        # 164.6.6.3 / D-04 + WR-02: this is a FRESH login (the registry is empty), so
        # the settle loop makes TWO confirmation reads (the count must hold across
        # two full intervals) before the POST bracket.
        "history_deals_get",
        "execute",
        "history_deals_get",
        "execute",
        "account_info",
    ]
    # NO permanent user-blame stamp and NO partial series (the economic read
    # succeeded but we refuse to persist an unconfirmed-account result).
    _persisted_nothing(capture)


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


def test_classify_no_ipc_connection_is_transient_not_wrong_server():
    """Regression (red-team FABLE, 2026-07-25): -10004 'No IPC connection' means the
    terminal bridge isn't attached (gateway down / mid-redeploy) — a TRANSIENT infra
    fault, NOT a wrong broker server. Its 'ipc' text matched the pre-164.5.4
    wrong-server table, which carried the bare token 'ipc', so without the
    code-gate it classified as 'wrong_server' → a PERMANENT user-blame rejection of
    a VALID key during a gateway outage (more likely now that login() calls
    initialize() first, making -10004 the canonical first-touch bridge error).

    ⚠️ 164.5.4: `_WRONG_SERVER_PHRASES` is anchored now ('trade server not found')
    and carries no 'ipc' member, so the TEXT alone would already degrade to
    'transient' by the refusal rule. The code-gate is still what this case pins,
    and it still runs FIRST: a transport verdict must not depend on broker-supplied
    text, which a future phrase could always start matching."""
    from services.mt5_validation import classify_mt5_login_error

    err = Mt5ClientError(-10004, "No IPC connection")
    assert classify_mt5_login_error(err) == "transient"  # pre-fix returned "wrong_server"


# ---------------------------------------------------------------------------
# WIZFORM-ABANDON / D-40 — the refusal's CLASSIFICATION on the DERIVE path
#
# WHY this matters (Rule 9). `Mt5SessionAbandoned` is a plain `Exception` (D-42),
# so it matches NONE of this branch's four existing `except` arms. Before the arm
# under test it escaped `run_derive_broker_dailies_job` entirely — measured, not
# theorised: plan 153.5-03 observed it escape into a bare `asyncio.gather` on 2 of
# 10 consecutive runs of `_run_two_concurrent_mt5(neuter_lock=True)`.
#
# Three properties, and each is a different way of getting the blame wrong:
#   * transient, so the DB backoff retries instead of burning to failed_final;
#   * NO `_stamp_strategy_analytics_failed` — an operator-side refusal must never
#     write a user-attributed 'failed' analytics row;
#   * NO `_mt5_bounded_restart` — a fence refusal means the terminal belongs to
#     SOMEONE ELSE now, so restarting it would do to them precisely what this
#     phase exists to stop.
# ---------------------------------------------------------------------------


class _EpochBumpingTransport(_FakeMt5Transport):
    """The ONE shared Wine terminal, whose `login()` advances the terminal
    generation — i.e. the lease this session began under releases mid-read.

    Bumping from INSIDE the transport is what makes the next session touch be
    refused by the SHIPPED `_assert_live` rather than by a hand-thrown stand-in,
    so the test proves the refusal can actually ARRIVE at this arm.
    """

    def __init__(self, *, terminal_key: str, **kwargs) -> None:
        super().__init__(**kwargs)
        self._terminal_key = terminal_key

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        out = super().login(login, password=password, server=server, timeout=timeout)
        # The SHIPPED release hook — the same call `mt5_terminal_lease`'s finally
        # makes. Never a hand-poked registry entry.
        bump_mt5_terminal_epoch(self._terminal_key)
        return out


@pytest.mark.asyncio
async def test_mt5_abandoned_session_is_transient_with_no_stamp_and_no_restart(
    monkeypatch,
) -> None:
    """⭐ The D-40 derive arm, driven by the SHIPPED fence.

    ⚠️ PERSPECTIVE. On the genuinely-abandoned path nobody awaits the read, so
    this arm never runs — asyncio discards the zombie's raise (D-39). It exists
    for the FALSE-POSITIVE path: a legitimate read that trips the fence must be
    retried, never blamed on the strategy owner and never answered by seizing a
    terminal that now belongs to someone else.
    """
    monkeypatch.setenv("MT5_ENABLED", "true")
    restarts: list[object] = []

    async def _spy_restart(client):
        restarts.append(client)

    # §Q6 patch-target table: `_mt5_bounded_restart` is one of the four names
    # `job_worker` itself READS, so it is patched on `jw`. (`_MT5_RESTART_TIMEOUT_S`
    # would be a silent no-op here — see the module header's E2 map.)
    monkeypatch.setattr(jw, "_mt5_bounded_restart", _spy_restart)

    transport = _EpochBumpingTransport(
        terminal_key="h:1",  # matches `_session`'s Mt5Client("h", 1, ...)
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
    )
    ctx, capture = _build_ctx(transport)
    # The key is DERIVED from the shipped property, so a drifted literal above
    # cannot silently bump an unrelated registry slot and make the case vacuous.
    assert ctx.exchange.client.terminal_key == "h:1"

    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    # The fence really fired: login ran, and the PRE-read `account_info` never
    # reached the terminal.
    assert transport.calls == ["initialize", "login"], (
        f"the fence did not refuse the PRE-read account_info; calls={transport.calls!r}"
    )

    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient", (
        "an abandoned-session refusal is the most retryable condition there is; "
        "anything permanent here burns a valid strategy to failed_final"
    )
    # ⛔ No user-blame analytics row and no partial series (the effect-based form
    # of "the strategy-analytics failure stamp was not invoked" — the helper is a
    # closure inside the job, and its ONLY observable is the upsert it makes).
    _persisted_nothing(capture)
    # ⛔ And no self-harm: the terminal now belongs to the next holder.
    assert restarts == [], (
        "the refusal arm restarted the terminal — but a fence refusal MEANS the "
        "terminal was handed on, so this restart lands on SOMEONE ELSE's session, "
        "which is exactly the -10004 cross-holder outage this phase closes"
    )


@pytest.mark.asyncio
async def test_the_abandoned_derive_error_message_carries_no_classifier_token(
    monkeypatch,
) -> None:
    """⭐ T-153.5-13 — the text that lands in `compute_jobs.error_message`.

    That text is operator-visible AND re-classifiable, so it must come back
    BLAME-FREE from `classify_mt5_login_error`. Before 164.5.4 the tables were
    substring-matched bare words and the ones an author would naturally reach for
    here — "terminal", "session", "connect", "login" — were literally members.
    The documented incident is `routers/exchange.py:678-684`, where an
    operator-side refusal became a 400 telling the user their BROKER SERVER was
    wrong. The tables are anchored phrases now, so the hazard is NARROWER — a
    message must name the broker-server lookup or the credential outright — but it
    is not gone, and an unrecognised message degrades to `transient` by the
    refusal rule rather than to a guess.

    ⚠️ The verdict comes from the LIVE seam in `services/mt5_validation.py`,
    deliberately. The invariant is safety against whatever the classifier does
    TODAY; a hand-copied table would go stale and stay green while the real
    classifier changed. It is not self-referential — the seam lives in a DIFFERENT
    module from the one under test.

    ⭐ 164.5.4 — the assertion moved from substring-absence to the classifier
    itself. The old loop had teeth only because the members were short common
    words; anchored phrases would have left it trivially green while measuring
    nothing.
    """
    from services.mt5_client import Mt5ClientError
    from services.mt5_validation import (
        _AUTH_PHRASES,
        _WRONG_SERVER_PHRASES,
        classify_mt5_login_error,
    )

    monkeypatch.setenv("MT5_ENABLED", "true")

    async def _spy_restart(client):
        raise AssertionError("the refusal arm must not restart the terminal")

    monkeypatch.setattr(jw, "_mt5_bounded_restart", _spy_restart)
    transport = _EpochBumpingTransport(
        terminal_key="h:1",
        account={"equity": 110_500.0, "balance": 110_500.0, "currency": "USD", "login": 123456},
        deals=_canonical_deals(),
    )
    ctx, _capture = _build_ctx(transport)

    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.error_kind == "transient"
    message = result.error_message or ""
    assert message, "the transient arm wrote no error_message at all"
    # Non-empty tables, or a "transient" verdict proves only that the classifier
    # had nothing to match on.
    assert _WRONG_SERVER_PHRASES and _AUTH_PHRASES
    # Code 0 so `_IPC_TRANSPORT_CODES` cannot answer for the text.
    verdict = classify_mt5_login_error(Mt5ClientError(0, message))
    assert verdict == "transient", (
        f"the derive arm's error_message classifies {verdict!r} — this text is "
        "operator-visible in compute_jobs and, when it is fed to "
        "classify_mt5_login_error, a working key gets blamed for our own "
        "abandoned thread (D-42)"
    )


# ---------------------------------------------------------------------------
# 164.6.6.2 / plan 03 — the account's own unit (D-01, D-02, D-08, D-14, D-20).
# ---------------------------------------------------------------------------
_BTC_SCALE = 1e-6


def _scaled_deals(scale: float) -> list[dict]:
    """The canonical deal ledger with every money field multiplied by ``scale`` (times
    are untouched), so a BTC account whose ledger is the USD canonical one in a unit a
    million times smaller has the SAME return series."""
    out: list[dict] = []
    for d in _canonical_deals():
        row = dict(d)
        for k in ("profit", "swap", "commission", "fee"):
            row[k] = row[k] * scale
        out.append(row)
    return out


def _btc_account(currency: str = "BTC") -> dict:
    # Canonical anchor 110_500 scaled by 1e-6: initial NAV 0.1 BTC, terminal 0.1105,
    # every NAV above the 1e-7 BTC dust floor (D-24) and far below the 1000 USD one.
    return {
        "equity": 0.1105,
        "balance": 0.1105,
        "currency": currency,
        "login": 123456,
    }


def _api_key_updates(capture: dict) -> list[dict]:
    return [p for (name, p) in capture["updates"] if name == "api_keys"]


@pytest.mark.asyncio
async def test_btc_account_derives_a_native_series_end_to_end(monkeypatch) -> None:
    """THE tracer (D-01, D-02, D-08, D-14, D-20). An MT5 account whose PRE
    ``account_info`` says BTC is judged against BTC floors, not the 1000 USD dust NAV
    that read every day of a 0.1 BTC account as dust. Hand literals are the canonical
    USD ones (the ledger is that ledger times 1e-6): 400/100_000 etc. are RATIOS, so
    they survive the change of unit exactly.

    Also pins the persisted unit: ONE service-role ``api_keys`` UPDATE that stores the
    code and the native balance AND nulls ``account_balance_usdt`` in the same
    statement (the sync arm may have written BTC there before this phase), and the
    ``native_unit`` flag in the pre-stamp, which is a flag and never a dust guard."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account=_btc_account(), deals=_scaled_deals(_BTC_SCALE)
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        f"kind={result.error_kind!r} msg={result.error_message!r}"
    )
    rows = _csv_rows(capture)
    assert rows["2025-06-02"] == pytest.approx(400 / 100_000, abs=1e-12)
    assert rows["2025-06-03"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2025-06-04"] == pytest.approx(300 / 100_400, abs=1e-12)
    assert rows["2025-06-05"] == pytest.approx(-200 / 110_700, abs=1e-12)

    flags = _dq_flags(capture)
    assert flags.get("native_unit") == "BTC"
    assert "dust_nav_guard" not in flags, (
        "a 0.1 BTC account is not dust; the guard fired against a USD-sized floor"
    )
    # D-25: every NAV of this account is ~0.1 BTC, far above the 1e-4 material equity.
    assert "small_base_measured" not in flags
    assert _api_key_updates(capture) == [
        {
            "account_currency": "BTC",
            "account_balance_native": 0.1105,
            "account_balance_usdt": None,
        }
    ]


@pytest.mark.asyncio
async def test_btc_account_on_a_very_small_balance_is_measured_exactly_and_flagged(
    monkeypatch,
) -> None:
    """D-25 end to end through the derive job. The canonical ledger scaled by 1e-10 puts
    every NAV between 1.0e-5 and 1.1e-5 BTC: above the 1e-7 dust floor (so every day is
    MEASURED), under the 1e-4 material equity (so the days are FLAGGED). The returns are the
    same hand-literal ratios as the 0.1 BTC tracer, because a ratio does not depend on the
    unit; the pre-stamp carries `small_base_measured` and nothing else new, and it is no
    guard: no dust guard, and the unit flag is untouched."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={"equity": 1.105e-5, "balance": 1.105e-5, "currency": "BTC",
                 "login": 123456},
        deals=_scaled_deals(1e-10),
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE, (
        f"kind={result.error_kind!r} msg={result.error_message!r}"
    )
    rows = _csv_rows(capture)
    assert rows["2025-06-02"] == pytest.approx(400 / 100_000, abs=1e-9)
    assert rows["2025-06-04"] == pytest.approx(300 / 100_400, abs=1e-9)
    assert rows["2025-06-05"] == pytest.approx(-200 / 110_700, abs=1e-9)
    flags = _dq_flags(capture)
    assert flags.get("small_base_measured") is True
    assert flags.get("native_unit") == "BTC"
    assert "dust_nav_guard" not in flags
    assert "twr_chain_broken" not in flags
    # A BOOL only: the smallest prior NAV is an account-size magnitude (T-73-02).
    assert "small_base_measured_days" not in flags
    assert "small_base_measured_min_nav" not in flags


@pytest.mark.asyncio
async def test_usd_account_derives_as_before_and_writes_only_its_code(
    monkeypatch,
) -> None:
    """D-04: a USD-family account is byte-identical to today. Its ``api_keys`` UPDATE
    carries the code alone, so the sync arm's ``account_balance_usdt`` is never touched
    and no native balance is invented; no ``native_unit`` flag is stamped."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account={
            "equity": 110_500.0, "balance": 110_500.0, "currency": "USD",
            "login": 123456,
        },
        deals=_canonical_deals(),
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())

    assert result.outcome == DispatchOutcome.DONE
    rows = _csv_rows(capture)
    assert rows["2025-06-02"] == pytest.approx(400 / 100_000, abs=1e-12)
    assert rows["2025-06-05"] == pytest.approx(-200 / 110_700, abs=1e-12)
    assert "native_unit" not in _dq_flags(capture)
    assert _api_key_updates(capture) == [{"account_currency": "USD"}]


# ---------------------------------------------------------------------------
# 164.6.6.2 / plan 03 Task 2 — every way a currency read can be wrong ends in a
# NAMED, correctly-classed failure that writes nothing it should not (D-01, D-03,
# D-06, D-07).
# ---------------------------------------------------------------------------
_MALFORMED_STAMP = (
    "The account currency could not be read as a currency code, so no metric is computed."
)


def _stamps(capture: dict) -> list[str]:
    """Every ``computation_error`` the derive wrote to ``strategy_analytics``."""
    return [
        p["computation_error"]
        for (name, p, _oc) in capture["upserts"]
        if name == "strategy_analytics"
        and isinstance(p, dict)
        and p.get("computation_error")
    ]


def _assert_nothing_written(capture: dict) -> None:
    assert capture["upserts"] == [], capture["upserts"]
    assert capture["deletes"] == [], capture["deletes"]
    assert capture["updates"] == [], capture["updates"]
    assert not any(c[0] == "enqueue_compute_job" for c in capture["rpc_calls"])


async def _derive_with_currency(
    monkeypatch, currency: object, *, stored: str | None = None
):
    monkeypatch.setenv("MT5_ENABLED", "true")
    account = _btc_account()
    account["currency"] = currency
    transport = _FakeMt5Transport(account=account, deals=_scaled_deals(_BTC_SCALE))
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    if stored is not None:
        ctx.key_row["account_currency"] = stored
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())
    return result, capture


@pytest.mark.asyncio
async def test_blank_currency_fails_transient_and_writes_nothing(
    monkeypatch, caplog
) -> None:
    """D-01: a terminal that has not reported its currency is not a verdict on the
    account. Transient, no stamp (a user-attributed 'failed' row for a fault that is
    not theirs), no series write, no api_keys write. One WARNING says why."""
    with caplog.at_level("WARNING", logger="quantalyze.analytics.job_worker"):
        result, capture = await _derive_with_currency(monkeypatch, "")
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    _assert_nothing_written(capture)
    assert any(
        r.levelname == "WARNING" and "currency" in r.getMessage() for r in caplog.records
    )


@pytest.mark.asyncio
async def test_malformed_currency_fails_permanent_with_the_curated_stamp(
    monkeypatch,
) -> None:
    """D-06: text that is not a currency code at all is refused, never looked up. The
    curated sentence is the ONLY thing that reaches the user; the raw broker text
    appears nowhere."""
    result, capture = await _derive_with_currency(monkeypatch, "b!tc")
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert _stamps(capture) == [_MALFORMED_STAMP]
    assert "b!tc" not in repr(capture["upserts"]) and "b!tc" not in (
        result.error_message or ""
    )
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert capture["updates"] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("code", ["EUR", "ETH"])
async def test_unsupported_currency_fails_permanent_naming_the_code(
    monkeypatch, code: str
) -> None:
    """D-06: a well-formed code with no floors defined is refused, and the sentence
    names the code. Never a guess, never a success row with null metrics."""
    result, capture = await _derive_with_currency(monkeypatch, code)
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert _stamps(capture) == [
        f"Returns in {code} are not supported yet, so no metric is computed."
    ]
    assert not any(u[0] == "csv_daily_returns" for u in capture["upserts"])
    assert capture["updates"] == []


@pytest.mark.asyncio
async def test_a_changed_currency_refuses_before_any_write(
    monkeypatch, caplog
) -> None:
    """D-03 / T-164.6.6.2-08: the broker re-denominated the account. Mixing the two
    units in one series is the harm, so NOTHING may be written: not a csv upsert, not
    a delete (the existing series is kept), not a stamp, not an api_keys update. The
    ERROR names both codes and no amount."""
    with caplog.at_level("ERROR", logger="quantalyze.analytics.job_worker"):
        result, capture = await _derive_with_currency(monkeypatch, "BTC", stored="USD")
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "transient"
    _assert_nothing_written(capture)
    errors = [r.getMessage() for r in caplog.records if r.levelname == "ERROR"]
    assert errors and "USD" in errors[0] and "BTC" in errors[0]
    assert "0.1105" not in errors[0]


@pytest.mark.asyncio
async def test_a_matching_stored_currency_derives_normally(monkeypatch) -> None:
    """The D-03 compare is a refusal on DIFFERENCE only: the second derive of a BTC key
    (stored BTC, read BTC, any case or padding) is the normal path."""
    result, capture = await _derive_with_currency(monkeypatch, " btc ", stored="BTC")
    assert result.outcome == DispatchOutcome.DONE
    assert _csv_rows(capture)


@pytest.mark.asyncio
async def test_a_column_missing_from_prod_degrades_to_a_warning(
    monkeypatch, caplog
) -> None:
    """T-164.6.6.2-12: the worker may deploy before PROD has the columns. PostgREST
    answers PGRST204 and writes nothing; that must not fail every derive."""
    from postgrest.exceptions import APIError

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account=_btc_account(), deals=_scaled_deals(_BTC_SCALE)
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl = original(name)
        if name == "api_keys":
            def _update(payload: object, **kw: object) -> MagicMock:
                chain = MagicMock()
                chain.eq.return_value = chain
                chain.execute.side_effect = APIError(
                    {"code": "PGRST204", "message": "column not found",
                     "details": None, "hint": None}
                )
                return chain

            tbl.update.side_effect = _update
        return tbl

    ctx.supabase.table.side_effect = _table
    with caplog.at_level("WARNING", logger="quantalyze.analytics.job_worker"):
        with _apply(_patches(ctx)):
            result = await run_derive_broker_dailies_job(_job())
    assert result.outcome == DispatchOutcome.DONE
    assert _csv_rows(capture), "the series is still written in the deploy window"
    assert any(
        r.levelname == "WARNING" and "PGRST204" in r.getMessage() for r in caplog.records
    )


@pytest.mark.asyncio
async def test_any_other_api_error_on_the_unit_write_is_not_swallowed(
    monkeypatch,
) -> None:
    """Only PGRST204 is the deploy window. A permission denial or constraint violation
    on the same write must surface, not be absorbed as a warning."""
    from postgrest.exceptions import APIError

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(
        account=_btc_account(), deals=_scaled_deals(_BTC_SCALE)
    )
    ctx, _capture = _build_ctx(transport, asset_class="traditional")
    original = ctx.supabase.table.side_effect

    def _table(name: str) -> MagicMock:
        tbl = original(name)
        if name == "api_keys":
            def _update(payload: object, **kw: object) -> MagicMock:
                chain = MagicMock()
                chain.eq.return_value = chain
                chain.execute.side_effect = APIError(
                    {"code": "23514", "message": "check violation",
                     "details": None, "hint": None}
                )
                return chain

            tbl.update.side_effect = _update
        return tbl

    ctx.supabase.table.side_effect = _table
    with _apply(_patches(ctx)):
        with pytest.raises(APIError):
            await run_derive_broker_dailies_job(_job())


@pytest.mark.asyncio
async def test_material_btc_equity_with_no_usable_days_fails_loud_in_btc(
    monkeypatch,
) -> None:
    """D-07: a broken key holding 5 BTC still fails loud. The floor is the unit's own
    (0.0001 BTC), not the 100 USD one that read 5 as 'immaterial'; and the message
    prints the amount in BTC, never '~5 USD' / '~0 USD'."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    one_day = [
        {"type": 1, "entry": 1, "profit": 0.001, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 2)},
    ]
    transport = _FakeMt5Transport(
        account={"equity": 5.0, "balance": 5.0, "currency": "BTC", "login": 123456},
        deals=one_day,
    )
    ctx, capture = _build_ctx(transport, asset_class="traditional")
    with _apply(_patches(ctx)):
        result = await run_derive_broker_dailies_job(_job())
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    msg = result.error_message or ""
    assert "material equity" in msg and "BTC" in msg and "USD" not in msg, msg
    assert capture["updates"] == [], "a refused account's unit is not persisted"


def test_every_new_derive_message_is_blame_free_for_the_mt5_classifier() -> None:
    """T-164.6.6.2-10: the fixed texts land in re-classifiable fields
    (``compute_jobs.error_message``, ``computation_error``). Run through the REAL
    classifier none may read as a credential or wrong-server verdict, and none may
    carry an amount, a login or a server."""
    from services.mt5_validation import (
        _AUTH_PHRASES,
        _WRONG_SERVER_PHRASES,
        classify_mt5_login_error,
    )

    assert _WRONG_SERVER_PHRASES and _AUTH_PHRASES
    texts = [
        jw._MT5_CURRENCY_BLANK_MESSAGE,
        jw._MT5_CURRENCY_CHANGED_MESSAGE,
        jw._MT5_CURRENCY_REFUSED_MESSAGE,
        _MALFORMED_STAMP,
        "Returns in EUR are not supported yet, so no metric is computed.",
        "Returns in BTC are not supported yet, so no metric is computed.",
    ]
    for text in texts:
        verdict = classify_mt5_login_error(Mt5ClientError(0, text))
        assert verdict == "transient", (text, verdict)
