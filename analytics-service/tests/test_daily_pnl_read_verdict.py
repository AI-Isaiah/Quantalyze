"""Phase 186 DERIVEGAPS (plan 05, D-05): the derive's reader of the realized DQ buffer.

``services.exchange.daily_pnl_read_verdict`` is the ONE reader the per-key derive uses on
what ``fetch_daily_pnl`` left in the buffer. Two older readers already exist and stay as they
are: ``routers/cron.py::_fetch_degradation`` (the trade sync's) and
``services/okx_archive_job.py::_check_live_realized_flags`` (the OKX archive job's rate-limit
decision). The derive must judge a flag buffer EXACTLY as they do, or a key the trade sync calls
short would be read as whole by the derive (or the reverse). So the parity test below enumerates
every flag combination through all three and fails on the first disagreement.
"""

from __future__ import annotations

import itertools
from typing import Any

import ccxt.async_support as ccxt
import pytest

from routers.cron import _fetch_degradation
from services.exchange import (
    DAILY_PNL_RATE_LIMIT_CLASSES,
    DailyPnlReadVerdict,
    daily_pnl_read_verdict,
)
from services.okx_archive_job import _check_live_realized_flags

_FETCH_ERROR_ABSENT_OR_TRUE: tuple[bool | None, ...] = (None, True)
_CLASSES: tuple[str | None, ...] = (
    None,
    "RateLimitExceeded",
    "DDoSProtection",
    "NetworkError",
    "ExchangeError",
    "not a name",
)
_FLAG_STATES: tuple[bool | None, ...] = (None, True)
#: Flags beside the base ones, one at a time plus absent. The deadline flags are the only ones the
#: derive's verdict names that the two older readers do not (review WR-06): only the derive's opt-in
#: ``read_deadline_s`` can set them. The malformed-row flags (a row the walk had to drop) are in the
#: matrix to pin founder decision D-12 (2026-11-04): NO reader names them, the derive included, so
#: they stay a data-quality flag and never a refusal. They were derive-only (review SFH-5) until D-12.
_DERIVE_ONLY_FLAGS: tuple[str | None, ...] = (
    None,
    "daily_pnl_deadline_okx",
    "daily_pnl_deadline_bybit",
    "daily_pnl_malformed_okx",
    "daily_pnl_malformed_bybit",
)


def _combinations() -> list[dict[str, Any]]:
    """Every combination of the flag dimensions, absent keys left out of the dict."""
    out: list[dict[str, Any]] = []
    for fetch_error, klass, trunc_okx, trunc_bybit, income, derive_only in itertools.product(
        _FETCH_ERROR_ABSENT_OR_TRUE,
        _CLASSES,
        _FLAG_STATES,
        _FLAG_STATES,
        _FLAG_STATES,
        _DERIVE_ONLY_FLAGS,
    ):
        flags: dict[str, Any] = {}
        if fetch_error:
            flags["daily_pnl_fetch_error"] = True
        if klass is not None:
            flags["daily_pnl_fetch_error_class"] = klass
        if trunc_okx:
            flags["daily_pnl_truncated_okx"] = True
        if trunc_bybit:
            flags["daily_pnl_truncated_bybit"] = True
        if income:
            flags["daily_pnl_binance_income_fallback"] = True
        if derive_only is not None:
            flags[derive_only] = True
        out.append(flags)
    return out


def test_a_truncated_okx_walk_is_one_reason_and_not_rate_limited() -> None:
    verdict = daily_pnl_read_verdict({"daily_pnl_truncated_okx": True})
    assert isinstance(verdict, DailyPnlReadVerdict)
    assert verdict.reasons == ("daily_pnl_truncated_okx",)
    assert verdict.error_class is None
    assert verdict.rate_limited is False


def test_an_empty_buffer_is_a_trustworthy_read() -> None:
    verdict = daily_pnl_read_verdict({})
    assert verdict.reasons == ()
    assert verdict.error_class is None
    assert verdict.rate_limited is False


def test_a_swallowed_rate_limit_is_rate_limited_and_keeps_its_class() -> None:
    verdict = daily_pnl_read_verdict(
        {
            "daily_pnl_fetch_error": True,
            "daily_pnl_fetch_error_class": "RateLimitExceeded",
        }
    )
    assert verdict.rate_limited is True
    assert verdict.error_class == "RateLimitExceeded"
    assert verdict.reasons == ("daily_pnl_fetch_error",)


def test_a_network_error_is_a_failed_read_that_is_not_a_rate_limit() -> None:
    verdict = daily_pnl_read_verdict(
        {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "NetworkError"}
    )
    assert verdict.rate_limited is False
    assert verdict.error_class == "NetworkError"
    assert verdict.reasons == ("daily_pnl_fetch_error",)


def test_a_class_that_is_not_an_identifier_is_dropped_never_kept() -> None:
    """T-186-13: venue text must never ride a class name into a stored flag."""
    verdict = daily_pnl_read_verdict(
        {"daily_pnl_fetch_error": True, "daily_pnl_fetch_error_class": "not a name"}
    )
    assert verdict.error_class is None
    assert verdict.rate_limited is False


def test_a_rate_limit_class_without_the_error_flag_is_not_rate_limited() -> None:
    """The class alone is not a failure: the verdict needs the error flag too, exactly as the
    OKX archive job's reader does."""
    verdict = daily_pnl_read_verdict({"daily_pnl_fetch_error_class": "RateLimitExceeded"})
    assert verdict.rate_limited is False


def test_a_deadline_hit_is_a_reason_of_its_own_and_not_a_truncation() -> None:
    """Review WR-06: the derive must be able to tell a deadline (retryable) from a cap hit."""
    verdict = daily_pnl_read_verdict({"daily_pnl_deadline_bybit": True})
    assert verdict.reasons == ("daily_pnl_deadline_bybit",)
    assert verdict.rate_limited is False


@pytest.mark.parametrize("flag", ["daily_pnl_malformed_okx", "daily_pnl_malformed_bybit", "daily_pnl_malformed_binance"])
def test_a_dropped_malformed_row_is_not_a_reason_the_key_keeps_publishing(flag: str) -> None:
    """Founder decision D-12 (2026-11-04), reversing review SFH-5. A malformed realized row is
    stamped as a data-quality flag but is not a refusal: it is the row's content, so a refusal would
    recur on every daily derive for as long as the row stays in the walk (TODOS
    ``[186-REALIZED-MALFORMED-COUNT]`` books the production count before refusing is reconsidered)."""
    verdict = daily_pnl_read_verdict({flag: True})
    assert verdict.reasons == ()
    assert verdict.rate_limited is False


def test_the_rate_limit_class_set_is_the_two_ccxt_rate_limit_names() -> None:
    assert DAILY_PNL_RATE_LIMIT_CLASSES == frozenset({"RateLimitExceeded", "DDoSProtection"})


def test_the_parity_matrix_has_the_documented_size() -> None:
    # 2 (fetch_error) x 6 (class) x 2 x 2 x 2 (truncated_okx, truncated_bybit, income fallback)
    # x 5 (none, or one of the two deadline flags or the two malformed-row flags)
    assert len(_combinations()) == 480


@pytest.mark.parametrize("flags", _combinations(), ids=lambda f: ",".join(sorted(f)) or "empty")
def test_the_verdict_reads_a_buffer_exactly_as_the_trade_sync_and_the_archive_job_do(
    flags: dict[str, Any],
) -> None:
    verdict = daily_pnl_read_verdict(flags)
    cron_reasons, cron_class = _fetch_degradation(dict(flags))
    # The verdict is the trade sync's reading plus the deadline flags it alone can see. The
    # malformed-row flags add nothing (D-12).
    derive_only = [
        name
        for name in _DERIVE_ONLY_FLAGS
        if name is not None and name.startswith("daily_pnl_deadline_") and flags.get(name)
    ]
    assert verdict.reasons == tuple(sorted([*cron_reasons, *derive_only]))
    assert verdict.error_class == cron_class

    raised_rate_limit = False
    try:
        _check_live_realized_flags(flags)
    except ccxt.RateLimitExceeded:
        raised_rate_limit = True
    except Exception:  # noqa: BLE001 - the archive job's own _Stop for other failures
        pass
    assert raised_rate_limit is verdict.rate_limited
