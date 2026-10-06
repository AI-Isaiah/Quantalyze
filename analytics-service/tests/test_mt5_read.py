"""164.5.4 / D-01 — the contract of the ONE shared MT5 deal-ledger read
(``services/mt5_read.py``), pinned AT THE HELPER rather than through a job.

Until this file existed, the MT5CONC-02 login brackets were only ever exercised
THROUGH ``run_derive_broker_dailies_job`` (``tests/test_mt5_derive_branch.py``:
``test_mt5_login_bracket_pre_mismatch``, ``test_mt5_login_bracket_post_hijack``,
``test_mt5_login_field_missing_fails_loud``). Those job-level WIRING tests stay —
they are what proves the derive branch actually invokes the helper. What they
cannot do is protect a SECOND caller: the full-backfill branch (plan 06) calls the
same helper, and pinning the brackets here is what makes that caller safe BY
CONSTRUCTION instead of by its author remembering.

⛔ NOTHING here asserts an exception DISPOSITION (transient vs permanent, stamp vs
no-stamp, restart vs no-restart) and nothing here touches the terminal lease or the
``asyncio.wait_for`` bound. Those live at the CALL SITES, deliberately and with
their rationale, because the derive job and the backfill job answer some of the
same exceptions differently. A helper test that asserted a disposition would pin
the helper to one caller's policy — the opposite of why it was extracted.

⭐ The transport double is the derive suite's ``_FakeMt5Transport``, imported, not
re-implemented: a second fake is a second contract, and it is the one that drifts.
No live terminal, no ``mt5linux`` install, no network, no credential.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from services.mt5_client import (
    HOLDER_HOUSE,
    HOLDER_UNKNOWN,
    Mt5AccountMismatchError,
    Mt5ClientError,
    _note_terminal_holder,
    begin_mt5_lease_holder,
    begin_mt5_lease_occupancy,
    bump_mt5_terminal_epoch,
    end_mt5_lease_holder,
    end_mt5_lease_occupancy,
    mt5_history_wait_due,
    mt5_terminal_holder,
    note_mt5_history_settled,
)
from services.mt5_concurrency import (
    _MT5_HISTORY_POLL_S,
    _MT5_HISTORY_WAIT_S,
    _Mt5PostReadVerificationError,
)
from services.mt5_read import (
    _MT5_DEAL_FETCH_MARGIN_S,
    _MT5_MAX_SERVER_UTC_OFFSET_S,
    Mt5HistoryUnsettledError,
    read_mt5_deal_ledger,
)
# The ONE offline transport double (tests/test_mt5_derive_branch.py). Imported
# from the module that OWNS it — the same discipline test_mt5_abandon_fence.py
# follows for `_FakeMt5` and test_mt5_concurrency.py for the relogin doubles.
from tests.test_mt5_derive_branch import (  # noqa: PLC2701 — deliberate reuse
    _FakeMt5Transport,
    _session,
)

# The login `_session()` binds. Synthetic, like every other MT5 fixture in this
# repo: a real account number is a secret and this repo is public.
_EXPECTED_LOGIN = 123456
_OTHER_LOGIN = 999999

_NOW = datetime(2026, 9, 20, 12, 0, 0, tzinfo=timezone.utc)

_DEALS: list[dict[str, Any]] = [
    {"ticket": 1, "type": 2, "profit": 300.0, "time": 1_700_000_000},
]


def _account(login: int | None, *, equity: float = 110_500.0) -> dict[str, Any]:
    """An ``account_info()`` snapshot. ``login=None`` OMITS the field entirely —
    the Pitfall-3 shape, where a bracket that used a default would silently
    match."""
    snap: dict[str, Any] = {"equity": equity, "balance": equity}
    if login is not None:
        snap["login"] = login
    return snap


class _BoundRecordingTransport(_FakeMt5Transport):
    """``_FakeMt5Transport`` plus the one thing it does not record: the epoch
    bounds ``history_deals_get`` was actually called with. An extension of the ONE
    double, never a second double."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.deal_fetch_bounds: list[tuple[Any, Any]] = []

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> Any:
        self.deal_fetch_bounds.append((from_ts, to_ts))
        return super().history_deals_get(from_ts, to_ts)


# ---------------------------------------------------------------------------
# PRE bracket (MT5CONC-02) — refuse BEFORE the economic read.
# ---------------------------------------------------------------------------
def test_pre_bracket_mismatch_refuses_before_the_deal_fetch() -> None:
    """A terminal presenting a DIFFERENT account must be refused before any deal
    is fetched. The ordering is the guarantee, not a nicety: deals fetched from
    the wrong account are numbers that could be reconstructed and persisted, and
    `api_verified` must never be stamped on another account's money."""
    transport = _FakeMt5Transport(account=_account(_OTHER_LOGIN), deals=_DEALS)
    session = _session(transport)

    with pytest.raises(Mt5AccountMismatchError):
        read_mt5_deal_ledger(session, now=_NOW)

    assert "history_deals_get" not in transport.calls, (
        "the PRE bracket must refuse BEFORE the deal fetch; the wrong account's "
        f"deals were read anyway (calls={transport.calls!r})"
    )


def test_pre_bracket_missing_login_field_fails_loud() -> None:
    """An ``account_info()`` with NO ``login`` field fails loud (Pitfall 3). A
    bracket written as ``info.get("login", expected)`` would DEFAULT-MATCH and
    wave through a terminal that told us nothing about which account it was on."""
    transport = _FakeMt5Transport(account=_account(None), deals=_DEALS)
    session = _session(transport)

    with pytest.raises(Mt5AccountMismatchError):
        read_mt5_deal_ledger(session, now=_NOW)

    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# POST bracket (MT5CONC-02 / IN-01) — re-assert AFTER the read.
# ---------------------------------------------------------------------------
def test_post_bracket_catches_a_mid_read_hijack() -> None:
    """The terminal is SHARED and single-account-at-a-time, and an ``asyncio.Lock``
    serializes nothing ACROSS REPLICAS. So another actor can re-log it between the
    PRE bracket and the end of the deal fetch. The POST re-read is the net for
    exactly that window, and it must fail INDEPENDENTLY of the PRE bracket — which
    passed."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN),
        deals=_DEALS,
        second_account=_account(_OTHER_LOGIN),
    )
    session = _session(transport)

    with pytest.raises(Mt5AccountMismatchError):
        read_mt5_deal_ledger(session, now=_NOW)

    # The PRE bracket PASSED and the deals WERE fetched — otherwise this test
    # would be re-testing the PRE bracket under a different name.
    assert "history_deals_get" in transport.calls, (
        "this must exercise the POST bracket: the PRE bracket had to pass and the "
        f"deal fetch had to happen first (calls={transport.calls!r})"
    )


def test_post_read_transport_blip_is_not_a_client_error() -> None:
    """A transport blip on the ASSERTION-ONLY POST re-read surfaces as
    ``_Mt5PostReadVerificationError``, NEVER as ``Mt5ClientError`` (IN-01).

    WHY THE TYPE IS THE POINT. The economic read of the CORRECT account already
    succeeded — login, PRE bracket and the deal fetch all passed. A failure to
    RE-CONFIRM the account afterwards is therefore a retry-worthy verification
    gap, never a credential fault. Callers route ``Mt5ClientError`` through
    ``classify_mt5_login_error``, whose ``auth`` arm writes a PERMANENT,
    USER-ATTRIBUTED failure; because ``_Mt5PostReadVerificationError`` is a plain
    ``Exception`` and not an ``Mt5ClientError``, that arm is STRUCTURALLY unable to
    absorb this blip and blame a working credential for a terminal hiccup. A
    phrase table is a bet; a type is a guarantee.
    """
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN),
        deals=_DEALS,
        post_read_exc=Mt5ClientError(0, "connection reset during re-read"),
    )
    session = _session(transport)

    with pytest.raises(_Mt5PostReadVerificationError) as excinfo:
        read_mt5_deal_ledger(session, now=_NOW)

    assert not isinstance(excinfo.value, Mt5ClientError), (
        "_Mt5PostReadVerificationError must NOT be an Mt5ClientError — the "
        "classify/stamp arm would then be able to absorb it into a permanent "
        "user-blamed credential verdict"
    )
    assert "history_deals_get" in transport.calls


# ---------------------------------------------------------------------------
# WR-02 — the deal-fetch upper-bound margin travelled with the read.
# ---------------------------------------------------------------------------
def test_deal_fetch_upper_bound_carries_the_server_offset_margin() -> None:
    """``history_deals_get``'s upper bound is built from UTC ``now``, but MT5 deal
    ``time`` values are in the broker's SERVER timezone. A server AHEAD of UTC
    stamps a just-happened deal with an epoch LATER than UTC ``now``, so without a
    margin that same-day deal is silently CLIPPED — under-counted terminal PnL, a
    wrong but entirely plausible series, and no error anywhere.

    The relationship between the two constants is asserted as well as the call
    argument: the module-level ``assert`` in ``services/mt5_read.py`` enforces it at
    import, and reading both here is what keeps a moved constant legible instead of
    looking like an arbitrary 86_400."""
    assert _MT5_DEAL_FETCH_MARGIN_S >= _MT5_MAX_SERVER_UTC_OFFSET_S, (
        "the fetch margin must cover the maximum plausible server-ahead-of-UTC "
        "offset, or a same-day deal on an ahead-of-UTC broker is clipped"
    )

    transport = _BoundRecordingTransport(
        account=_account(_EXPECTED_LOGIN), deals=_DEALS
    )
    session = _session(transport)

    read_mt5_deal_ledger(session, now=_NOW)

    assert len(transport.deal_fetch_bounds) == 1
    from_ts, to_ts = transport.deal_fetch_bounds[0]
    assert from_ts == 0, "the ledger read is FULL history, never a window"
    assert to_ts == int(_NOW.timestamp()) + _MT5_DEAL_FETCH_MARGIN_S
    # The concrete consequence, stated as money rather than as arithmetic: a deal
    # stamped by the most ahead-of-UTC broker server there is still lands inside
    # the window.
    assert int(_NOW.timestamp()) + _MT5_MAX_SERVER_UTC_OFFSET_S <= to_ts


# ---------------------------------------------------------------------------
# Passthrough — the helper classifies NOTHING.
# ---------------------------------------------------------------------------
def test_login_rejection_passes_through_unchanged() -> None:
    """A login rejection leaves the helper as an ``Mt5ClientError``, unwrapped and
    unclassified. The helper performs the read; deciding whether a rejection is
    ``auth`` (permanent, user-blamed) or ``transient`` belongs to each caller, and
    the derive and backfill jobs do not answer it identically."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN),
        deals=_DEALS,
        login_ok=False,
        last_error=(0, "Invalid account"),
    )
    session = _session(transport)

    from services.mt5_client import Mt5LoginRefusedError

    with pytest.raises(Mt5ClientError) as excinfo:
        read_mt5_deal_ledger(session, now=_NOW)

    # Phase 167 CR-01 — `Mt5Client.login` itself now raises its login-stage
    # marker subclass for a falsy sign-in, so "unchanged" means exactly THAT
    # type reaches the caller: the helper neither re-wraps it nor erases the
    # stage marker by re-raising the base class.
    assert type(excinfo.value) is Mt5LoginRefusedError, (
        "the helper must not re-signal a login rejection as some other type; "
        f"got {type(excinfo.value).__name__}"
    )
    assert "account_info" not in transport.calls
    assert "history_deals_get" not in transport.calls


# ---------------------------------------------------------------------------
# Happy path — which snapshot comes back.
# ---------------------------------------------------------------------------
def test_returns_the_pre_snapshot_and_discards_the_post_one() -> None:
    """The PRE ``account_info()`` is the returned ECONOMIC ANCHOR (equity/balance,
    byte-preserved from Phase 136); the POST read is assertion-only and its dict is
    thrown away.

    The two snapshots deliberately carry the SAME login and DIFFERENT equity, so
    returning the POST dict — which would silently re-anchor the whole
    reconstruction on a later, unrelated equity reading — reddens this test instead
    of passing quietly."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN, equity=110_500.0),
        deals=_DEALS,
        second_account=_account(_EXPECTED_LOGIN, equity=999_999.0),
    )
    session = _session(transport)

    info, deals = read_mt5_deal_ledger(session, now=_NOW)

    assert info["equity"] == 110_500.0, (
        "the PRE snapshot is the economic anchor; the POST re-read is "
        f"assertion-only and must be discarded (got {info['equity']!r})"
    )
    assert info["login"] == _EXPECTED_LOGIN
    assert [d["ticket"] for d in deals] == [1]
    assert [d["profit"] for d in deals] == [300.0]


# ---------------------------------------------------------------------------
# 164.6.6.3 / D-04, D-06, D-15 — the settle loop and the settled record.
#
# ⛔ Same discipline as above: no lease, no `asyncio.wait_for`. The holder context
# is set with the ContextVar pair the lease itself calls, and the clock is the
# autouse fake from `conftest.py` (`_mt5_read_never_sleeps_for_real`), so a
# 30-second budget costs no wall time and a never-settling case cannot spin.
# ---------------------------------------------------------------------------
_FLOOR = 100.0  # the derive's `_DERIBIT_EMPTY_LEDGER_FLOOR_USD`
_KEY = "key-1"


def _terminal_key() -> str:
    transport = _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=[])
    return _session(transport).client.terminal_key


def _settle_read(transport: _FakeMt5Transport) -> list[dict[str, Any]]:
    _info, deals = read_mt5_deal_ledger(
        _session(transport),
        now=_NOW,
        settle_history=True,
        material_equity_floor_usd=_FLOOR,
    )
    return deals


def test_cached_account_reads_once(_mt5_read_never_sleeps_for_real) -> None:
    """D-04: an account whose history is already cached pays NO wait. With
    ``settle_history=False`` the helper is today's single read: exactly one
    ``history_deals_get`` and not one sleep."""
    transport = _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)

    read_mt5_deal_ledger(_session(transport), now=_NOW)

    assert transport.calls.count("history_deals_get") == 1
    assert _mt5_read_never_sleeps_for_real.sleeps == []


def test_fresh_login_waits_for_history_to_settle(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """Finding C at the helper: empty, empty, then the ledger. Two empty reads a
    second apart LOOK stable, and under material equity that must not count; the
    ledger then has to repeat across two full intervals before it does (WR-02).
    Five reads, and the deals the LAST read returned (no extra read after the
    settle)."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN),
        deals=[],
        deals_by_call=[[], [], _DEALS],
    )

    deals = _settle_read(transport)

    assert transport.calls.count("history_deals_get") == 5
    assert [d["ticket"] for d in deals] == [1]
    assert _mt5_read_never_sleeps_for_real.sleeps == [_MT5_HISTORY_POLL_S] * 4


_TWO_DEALS: list[dict[str, Any]] = _DEALS + [
    {"ticket": 2, "type": 2, "profit": 50.0, "time": 1_700_000_100},
]


def test_one_stable_interval_is_not_settled(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """WR-02. One equal pair of reads is not proof: a fresh login can be served the
    account's stale on-disk cache first, and the delta lands later than one poll
    interval, so the second read repeats the stale count. Settled needs the count
    to hold across TWO consecutive full intervals (three equal reads).

    Here the count is stable for exactly one interval (1, 1) and then grows (2),
    so the loop must keep going and return the grown ledger, not the first pair's.
    Five reads: the stale pair, the growth, then two intervals that agree."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN),
        deals=[],
        deals_by_call=[_DEALS, _DEALS, _TWO_DEALS, _TWO_DEALS, _TWO_DEALS],
    )

    deals = _settle_read(transport)

    assert [d["ticket"] for d in deals] == [1, 2], (
        "settled on the stale first pair: the delta that landed after one interval "
        "was never read"
    )
    assert transport.calls.count("history_deals_get") == 5
    assert _mt5_read_never_sleeps_for_real.sleeps == [_MT5_HISTORY_POLL_S] * 4


def test_two_stable_intervals_settle(_mt5_read_never_sleeps_for_real) -> None:
    """The other edge of WR-02: three equal reads settle, and not one read more."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN), deals=_DEALS
    )

    deals = _settle_read(transport)

    assert [d["ticket"] for d in deals] == [1]
    assert transport.calls.count("history_deals_get") == 3
    assert _mt5_read_never_sleeps_for_real.sleeps == [_MT5_HISTORY_POLL_S] * 2


def test_retry_after_unsettled_expiry_waits_again() -> None:
    """THE D-15 hole. After an expiry the retry sees ITSELF as the terminal's
    previous holder, so "previous holder == this key" alone would call it cached
    and read a partial history — a permanent stamp, or worse a plausible wrong
    series. Only a read whose history SETTLED may make the key cached."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        with pytest.raises(Mt5HistoryUnsettledError):
            _settle_read(
                _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=[])
            )
        # The login stamped the holder registry, so the OLD rule would say cached.
        assert mt5_terminal_holder(tk) == _KEY
        assert mt5_history_wait_due(tk, _KEY) is True

        _settle_read(
            _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
        )
        assert mt5_history_wait_due(tk, _KEY) is False
    finally:
        end_mt5_lease_holder(token)


def test_a_recycle_makes_a_settled_key_fresh_again() -> None:
    """D-07 flip interaction: a terminal recycle stamps ``HOLDER_UNKNOWN`` and, with
    the trades scrub on, every account is new to the terminal afterwards. A key that
    had settled must therefore wait again."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        _settle_read(
            _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
        )
        assert mt5_history_wait_due(tk, _KEY) is False

        _note_terminal_holder(tk, HOLDER_UNKNOWN, stage="terminal_recycle")

        assert mt5_history_wait_due(tk, _KEY) is True
    finally:
        end_mt5_lease_holder(token)


@pytest.mark.parametrize(
    "displacing_holder",
    [HOLDER_UNKNOWN, HOLDER_HOUSE, "key-2"],
    ids=["scrub_or_recycle", "house_relaunch", "another_key"],
)
def test_a_settled_record_does_not_outlive_the_holder_it_vouched_for(
    displacing_holder: str,
) -> None:
    """SFH-M1. The settled record vouches for a deal cache that sits on the terminal's
    disk. Any event that moves the holder away from the settled key (a scrub that
    deletes the trades cache and stamps ``HOLDER_UNKNOWN``, a house relaunch,
    another key's login) takes that cache away, so the claim must go with it.

    The hole: settle K, scrub, then a FRESH read for K whose wait EXPIRES. That read's
    login stamps K as the holder again, so "holder == K and settled == K" would call
    K cached on the next read, which would then take an empty or partial cache as
    the complete history. Only a read that actually settled may make K cached."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        _settle_read(
            _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
        )
        assert mt5_history_wait_due(tk, _KEY) is False

        _note_terminal_holder(tk, displacing_holder, stage="terminal_scrub")
        assert mt5_history_wait_due(tk, _KEY) is True

        with pytest.raises(Mt5HistoryUnsettledError):
            _settle_read(
                _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=[])
            )
        # The expired read's login made K the previous holder again; the OLD record
        # must not be there to complete the pair.
        assert mt5_terminal_holder(tk) == _KEY
        assert mt5_history_wait_due(tk, _KEY) is True
    finally:
        end_mt5_lease_holder(token)


def test_a_re_stamp_of_the_settled_holder_keeps_the_record() -> None:
    """The invalidation must not over-fire: a lease that logs the SAME settled key in
    again (the cached read's own login) stamps the same holder, and the key stays
    cached. Dropping it there would make every cached read pay the wait."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        _settle_read(
            _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
        )
        _note_terminal_holder(tk, _KEY, stage="login")

        assert mt5_history_wait_due(tk, _KEY) is False
    finally:
        end_mt5_lease_holder(token)


def test_another_holder_in_between_makes_a_settled_key_fresh_again() -> None:
    """Settled is per (terminal, key) AND the key must still be the terminal's
    previous holder: if another key logged in meanwhile, this one is new to the
    terminal again."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        _settle_read(
            _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
        )
    finally:
        end_mt5_lease_holder(token)
    other = begin_mt5_lease_holder("key-2")
    try:
        _note_terminal_holder(tk, stage="login")
    finally:
        end_mt5_lease_holder(other)

    assert mt5_history_wait_due(tk, _KEY) is True


def test_missing_equity_skips_the_wait_and_records_nothing(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """No usable equity means no way to tell a funded account from an empty one,
    so the loop does not guess: one read, no sleep, and the key is NOT recorded as
    settled (the callers' step-(c) guards fail loud on the missing equity)."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        transport = _FakeMt5Transport(
            account={"login": _EXPECTED_LOGIN, "balance": 1.0}, deals=_DEALS
        )
        _settle_read(transport)

        assert transport.calls.count("history_deals_get") == 1
        assert _mt5_read_never_sleeps_for_real.sleeps == []
        assert mt5_history_wait_due(tk, _KEY) is True
    finally:
        end_mt5_lease_holder(token)


def test_a_single_read_never_records_settled() -> None:
    """``settle_history=False`` proves nothing about the history, so it must not
    make the key cached."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        read_mt5_deal_ledger(
            _session(
                _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)
            ),
            now=_NOW,
        )
        assert mt5_history_wait_due(tk, _KEY) is True
    finally:
        end_mt5_lease_holder(token)


def test_a_holder_that_is_not_a_real_key_never_records_settled() -> None:
    """The four ``HOLDER_*`` literals and a missing holder are not api_key_ids: a
    settled read under one of them must not mint a record that a later REAL key of
    the same spelling could match."""
    tk = _terminal_key()
    _settle_read(_FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS))

    assert mt5_terminal_holder(tk) == "unattributed"
    assert mt5_history_wait_due(tk, "unattributed") is True
    assert mt5_history_wait_due(tk, None) is True
    assert mt5_history_wait_due(tk, "") is True


def test_a_lease_that_already_ended_records_nothing() -> None:
    """The epoch guard, in the holder registry's own shape: a thread whose lease
    was released (the epoch bumped) must not record a settled history, or it would
    be attributed to whoever holds the terminal now."""
    tk = _terminal_key()
    holder = begin_mt5_lease_holder(_KEY)
    occupancy = begin_mt5_lease_occupancy(tk)
    try:
        bump_mt5_terminal_epoch(tk)  # the lease "released" under this thread
        note_mt5_history_settled(tk)
    finally:
        end_mt5_lease_occupancy(occupancy)
        end_mt5_lease_holder(holder)
    # Make the holder registry agree so ONLY the settled record can answer.
    holder2 = begin_mt5_lease_holder(_KEY)
    try:
        _note_terminal_holder(tk, _KEY)
    finally:
        end_mt5_lease_holder(holder2)

    assert mt5_history_wait_due(tk, _KEY) is True


def test_zero_deals_under_material_equity_is_not_settled(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """Finding C's exact shape: a funded account (equity 110_500) whose history
    never arrives. A count stable at ZERO is not settled while equity is material,
    so the loop runs the whole budget and RAISES: it never returns the empty ledger
    as if it were the account's history.

    The exception carries counts and a boolean only — never the equity, the login
    or the server."""
    transport = _FakeMt5Transport(
        account=_account(_EXPECTED_LOGIN, equity=110_500.0), deals=[]
    )

    with pytest.raises(Mt5HistoryUnsettledError) as excinfo:
        _settle_read(transport)

    exc = excinfo.value
    assert exc.deal_count == 0
    assert exc.material is True
    clock = _mt5_read_never_sleeps_for_real
    assert sum(clock.sleeps) >= _MT5_HISTORY_WAIT_S
    assert max(clock.sleeps) <= _MT5_HISTORY_POLL_S
    text = str(exc)
    assert "110500" not in text and "110_500" not in text
    assert str(_EXPECTED_LOGIN) not in text and "Broker-Live" not in text
    assert not isinstance(exc, (Mt5ClientError, TimeoutError)), (
        "a plain Exception: an Mt5ClientError is classified as a credential "
        "verdict, a TimeoutError restarts a healthy terminal"
    )


class _TimedGrowingTransport(_FakeMt5Transport):
    """A history that keeps growing in FAKE time, where every read COSTS time.

    The conftest clock makes a read cost 0 s, so every settle iteration lands on a
    whole poll boundary and the loop's tail is always a full interval: that is the
    reason CR-01 (a sub-interval sliver before the deadline) hid. Here a read
    advances the clock by ``cost_s``, so the iteration length is ``poll + cost``
    and the deadline falls part-way through an interval.

    The count is ONE deal per whole fake second, sampled at the read's START.
    Two reads a full poll interval (2 s) apart can therefore never be equal, while
    two reads under a second apart often are: exactly the shape that lets a
    shortened tail interval fake a stable history."""

    def __init__(
        self, clock: Any, cost_s: float, offset_s: float = 0.0, **kwargs: Any
    ) -> None:
        super().__init__(**kwargs)
        self._clock = clock
        self._cost_s = cost_s
        # Where in its growth second the history is when the read starts, so the
        # case can place the tail's two reads inside ONE growth second.
        self._t0 = clock.now - offset_s

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> Any:
        grown = int(self._clock.now - self._t0)
        self._deals = [
            {"ticket": i, "type": 2, "profit": 1.0, "time": 1_700_000_000}
            for i in range(grown)
        ]
        out = super().history_deals_get(from_ts, to_ts)
        self._clock.now += self._cost_s
        return out


# (read cost, growth-second offset). Measured against the pre-fix loop: 0.3 s with
# offsets 0.5 and 0.75 RETURNED ``settled=True`` on a still-growing history (the
# defect itself); the others raised, but only after a sub-interval sleep.
@pytest.mark.parametrize(
    ("cost_s", "offset_s"), [(0.3, 0.0), (0.3, 0.5), (0.3, 0.75), (0.45, 0.0)]
)
def test_a_history_still_growing_never_settles_on_a_short_tail_interval(
    _mt5_read_never_sleeps_for_real, cost_s: float, offset_s: float
) -> None:
    """CR-01. Every comparison across a FULL poll interval sees the history grow,
    so the wait must run out and RAISE. The old loop shortened its last sleep to
    ``deadline - now`` and compared two reads taken almost back to back, which a
    growing history can satisfy by luck: it returned ``settled=True`` on a partial
    ledger and ``read_mt5_deal_ledger`` then wrote the settled record.

    The pin is the property, not the arithmetic: no sleep is ever shorter than
    ``_MT5_HISTORY_POLL_S`` (reads are only compared a full interval apart), the
    loop raises rather than settles, and the key is not recorded as cached."""
    clock = _mt5_read_never_sleeps_for_real
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        transport = _TimedGrowingTransport(
            clock, cost_s, offset_s, account=_account(_EXPECTED_LOGIN), deals=[]
        )

        with pytest.raises(Mt5HistoryUnsettledError):
            _settle_read(transport)

        assert clock.sleeps, "the loop never slept: this case measured nothing"
        assert all(s == _MT5_HISTORY_POLL_S for s in clock.sleeps), (
            "a sleep shorter than the poll interval lets two near-simultaneous "
            f"reads compare equal (sleeps={clock.sleeps!r})"
        )
        assert mt5_history_wait_due(tk, _KEY) is True
    finally:
        end_mt5_lease_holder(token)


class _WorstCaseTrailingReadTransport(_FakeMt5Transport):
    """The slowest legal run of a fresh read that never settles, in FAKE time.

    The read budget (`_MT5_DERIVE_READ_TIMEOUT_S`) is spent whole on the three
    round-trips before the loop (login, PRE ``account_info``, first read). The count
    grows on every read, so nothing ever settles. In-loop reads are instant until one
    STARTS exactly at the settle deadline, which is the latest the loop allows; that
    one then takes a whole rpyc timeout, the review's trailing slow read."""

    def __init__(self, clock: Any, read_s: float, request_s: float, **kw: Any) -> None:
        super().__init__(**kw)
        self._clock = clock
        self._pre_cost_s = read_s / 3
        self._trailing_cost_s = request_s
        self._reads = 0
        self.deadline: float | None = None
        self.read_starts: list[float] = []

    def login(self, login, password=None, server=None, timeout=None):  # noqa: ANN001
        self._clock.now += self._pre_cost_s
        return super().login(login, password, server, timeout)

    def account_info(self):
        out = super().account_info()
        if self._account_info_calls == 1:
            self._clock.now += self._pre_cost_s
        return out

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> Any:
        self.read_starts.append(self._clock.now)
        self._reads += 1
        self._deals = [
            {"ticket": i, "type": 2, "profit": 1.0, "time": 1_700_000_000}
            for i in range(self._reads)
        ]
        out = super().history_deals_get(from_ts, to_ts)
        if self._reads == 1:
            self._clock.now += self._pre_cost_s
            self.deadline = self._clock.now + _MT5_HISTORY_WAIT_S
        elif self.deadline is not None and self._clock.now >= self.deadline:
            self._clock.now += self._trailing_cost_s
        return out


def test_the_fresh_outer_bound_covers_a_trailing_read_that_starts_at_the_deadline(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """Review WR-01, behaviourally. Drive the REAL ``read_mt5_deal_ledger`` through
    the slowest legal fresh run (see the transport) and require that the clock it
    consumes before raising ``Mt5HistoryUnsettledError`` fits the outer bound
    ``mt5_derive_read_bound_s`` hands the call sites' ``asyncio.wait_for``.

    If it does not fit, ``wait_for`` fires first, takes the TIMEOUT arm and restarts
    the terminal mid-download, which D-05 forbids. The oracle is the elapsed fake time
    of a real run, not a restatement of the formula; the rpyc timeout is imported from
    ``mt5_client``."""
    from services.mt5_client import MT5_REQUEST_TIMEOUT_S
    from services.mt5_concurrency import (
        _MT5_DERIVE_READ_TIMEOUT_S,
        mt5_derive_read_bound_s,
    )

    clock = _mt5_read_never_sleeps_for_real
    transport = _WorstCaseTrailingReadTransport(
        clock,
        _MT5_DERIVE_READ_TIMEOUT_S,
        MT5_REQUEST_TIMEOUT_S,
        account=_account(_EXPECTED_LOGIN),
        deals=[],
    )
    started = clock.now

    with pytest.raises(Mt5HistoryUnsettledError):
        _settle_read(transport)

    elapsed = clock.now - started
    assert transport.deadline is not None
    assert transport.read_starts[-1] >= transport.deadline, (
        "no read started at the settle deadline: this case did not exercise the "
        f"trailing read it exists to budget (starts={transport.read_starts!r})"
    )
    bound = mt5_derive_read_bound_s(
        read_s=_MT5_DERIVE_READ_TIMEOUT_S, wait_s=_MT5_HISTORY_WAIT_S, fresh=True
    )
    assert elapsed <= bound, (
        f"a fresh read ran {elapsed}s of clock before settling out, past the outer "
        f"bound {bound}s: the outer wait_for would fire first and restart the "
        "terminal mid-download (review WR-01, D-05)"
    )


def test_immaterial_equity_stable_zero_returns_at_once(
    _mt5_read_never_sleeps_for_real,
) -> None:
    """D-06: zero equity is an honest empty result. "At once" means the FIRST stable
    read run (two confirmations after the first read, WR-02), not "without reading
    three times" — the clock advances two poll intervals and never the whole
    budget."""
    tk = _terminal_key()
    token = begin_mt5_lease_holder(_KEY)
    try:
        transport = _FakeMt5Transport(
            account=_account(_EXPECTED_LOGIN, equity=50.0), deals=[]
        )

        deals = _settle_read(transport)

        assert deals == []
        assert transport.calls.count("history_deals_get") == 3
        assert _mt5_read_never_sleeps_for_real.sleeps == [_MT5_HISTORY_POLL_S] * 2
        # A settled-at-zero history for a non-material account is settled.
        assert mt5_history_wait_due(tk, _KEY) is False
    finally:
        end_mt5_lease_holder(token)


def test_settle_without_a_floor_is_a_caller_bug() -> None:
    """``settle_history=True`` with no floor cannot tell material from immaterial
    equity. It raises BEFORE touching the terminal rather than guessing one."""
    transport = _FakeMt5Transport(account=_account(_EXPECTED_LOGIN), deals=_DEALS)

    with pytest.raises(ValueError):
        read_mt5_deal_ledger(_session(transport), now=_NOW, settle_history=True)

    assert transport.calls == []
