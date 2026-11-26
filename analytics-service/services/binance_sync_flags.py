"""Phase 253 BINANCECURSOR (SC-3, D-08, D-09): the sync-time ``binance_*`` data-quality keys,
carried through every follow-on writer of ``strategy_analytics.data_quality_flags`` and cleared
by the next Binance sync that does not raise them.

WHY THIS EXISTS. ``run_sync_trades_job`` writes ``binance_stop_below_cursor`` and the other
``binance_*`` keys onto ``data_quality_flags`` (they name a span of fills the read left unread).
The chained ``derive_broker_dailies`` prestamp and the ``run_csv_strategy_analytics`` rebuild
both replace that column wholesale, so before this module the WARNING log was the only lasting
signal (round-3 WR-02). The re-read guarantee itself never depended on these keys: it lives in
``strategy_fills_reread_bounds``. They are an operator-facing signal, nothing more.

THE ALLOWLIST IS EXPLICIT, never a prefix match. Nine keys, each with a validated shape, so a
future ``binance_*`` key written for another purpose is never carried by accident, and a
tampered or malformed value is dropped instead of being republished. ``daily_pnl_malformed_binance``
and ``daily_pnl_binance_income_fallback`` belong to the daily-P&L path and have their own carry;
they are NOT in the allowlist.

LEAF MODULE. Imports only ``logging``, ``copy`` and ``typing`` so ``services/job_worker.py`` and
``services/analytics_runner.py`` can both import it without a cycle. ``read_binance_sync_flags``
takes the client as a parameter for the same reason.

NONE OF THE NINE KEYS IS A WARNING. None is in ``NAV_TWR_GUARD_KEYS`` or
``ALLOCATED_CAPITAL_GUARD_KEYS``, so carrying one can never promote ``computation_status`` to
``complete_with_warnings`` or set ``computation_warned``.
"""

from __future__ import annotations

import copy
import logging
from collections.abc import Mapping
from typing import Any, Final

logger = logging.getLogger("quantalyze.analytics.binance_sync_flags")

# True only.
_TRUE_KEYS: Final[tuple[str, ...]] = (
    "binance_fills_reach_clamped",
    "binance_fill_cursor_advance_plus1",
    "binance_stop_below_cursor",
)
# A non-empty list of str (symbol names).
_SYMBOL_LIST_KEYS: Final[tuple[str, ...]] = (
    "binance_partial_symbols",
    "binance_unlisted_symbols",
    "binance_page_cap_symbols",
    "binance_untimed_page_symbols",
    "binance_deadline_symbols",
)
# An int (not a bool), at least 0: an epoch-millisecond instant.
_NON_NEGATIVE_INT_KEYS: Final[tuple[str, ...]] = ("binance_read_through_ms",)

BINANCE_SYNC_FLAG_KEYS: Final[tuple[str, ...]] = (
    *_TRUE_KEYS,
    *_SYMBOL_LIST_KEYS,
    *_NON_NEGATIVE_INT_KEYS,
)


def _valid(key: str, value: object) -> bool:
    """Whether ``value`` has the shape ``key`` is allowed to carry. Pure, never raises."""
    if key in _TRUE_KEYS:
        return value is True
    if key in _SYMBOL_LIST_KEYS:
        return (
            isinstance(value, list)
            and len(value) > 0
            and all(isinstance(item, str) for item in value)
        )
    if key in _NON_NEGATIVE_INT_KEYS:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0
    return False


def carry_binance_sync_flags(flags: object) -> dict[str, Any]:
    """The allowlisted sync-time keys of ``flags`` whose value has the key's shape, as deep copies.

    Pure: ``isinstance`` checks only, never raises, logs nothing (the ``_last_success_snapshot``
    posture). A non-dict input is ``{}``. A key outside the allowlist, such as
    ``sync_truncated_okx``, is never carried.
    """
    if not isinstance(flags, dict):
        return {}
    return {
        key: copy.deepcopy(flags[key])
        for key in BINANCE_SYNC_FLAG_KEYS
        if key in flags and _valid(key, flags[key])
    }


def clear_absent_binance_sync_flags(
    existing: dict[str, Any], fresh: Mapping[str, Any]
) -> bool:
    """Pop from ``existing`` every allowlisted key that ``fresh`` does not carry (D-09).

    ``fresh`` is what the sync that just ran raised. Returns whether anything was popped, so the
    caller can write the row even when nothing else changed. The caller owns WHEN this is safe
    (a read that ran and did not raise, a Binance key, a flag load that succeeded); this function
    only does the removal.
    """
    cleared = False
    for key in BINANCE_SYNC_FLAG_KEYS:
        if key in existing and key not in fresh:
            existing.pop(key)
            cleared = True
    return cleared


def read_binance_sync_flags(supabase: Any, strategy_id: str) -> dict[str, Any]:
    """The carried sync-time keys currently stored on ``strategy_id``'s ``data_quality_flags``.

    For the WHOLESALE FAILURE writers (the derive's failed stamp and the CSV runner's
    insufficient-history, truncated and config-failed arms), which build their flags as
    ``{"csv_source": True}`` and have no prior row in scope. One ``strategy_analytics`` read.

    NEVER RAISES. A failed stamp must land, so any exception here logs ONE WARNING naming the
    strategy and the exception class and returns ``{}``: the stamp then carries nothing, which is
    the pre-Phase-253 behaviour, and the re-read guarantee does not depend on it.
    """
    try:
        res = (
            supabase.table("strategy_analytics")
            .select("data_quality_flags")
            .eq("strategy_id", strategy_id)
            .maybe_single()
            .execute()
        )
        row = getattr(res, "data", None)
        if not isinstance(row, dict):
            return {}
        return carry_binance_sync_flags(row.get("data_quality_flags"))
    except Exception as exc:  # noqa: BLE001 - a failure stamp must land, whatever this read does
        logger.warning(
            "binance_sync_flags: could not read the stored data_quality_flags for strategy %s "
            "(%s); the failure stamp carries no binance_* sync keys",
            strategy_id,
            type(exc).__name__,
        )
        return {}
