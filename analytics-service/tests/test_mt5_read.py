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

from services.mt5_client import Mt5AccountMismatchError, Mt5ClientError
from services.mt5_concurrency import _Mt5PostReadVerificationError
from services.mt5_read import (
    _MT5_DEAL_FETCH_MARGIN_S,
    _MT5_MAX_SERVER_UTC_OFFSET_S,
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
