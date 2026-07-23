"""Allocated-capital returns denominator (per-strategy override, Zavara-only).

A strategy MAY carry a ``returns_denominator_config`` — a NULLABLE ``jsonb`` column
on ``strategies``. When PRESENT, that strategy's daily returns are

    r(d) = daily_pnl_usd(d) / allocated_capital(d)

against an externally-scheduled capital base, rather than the NAV backward-roll.
This path DELIBERATELY bypasses ``reconstruct_native_nav_and_twr`` and its §5
inception gate: the denominator is a fixed schedule (not a reconstructed NAV), so
the §5 straddle / open-book reconciliation concerns are irrelevant here — which is
exactly why the removed V₀ machinery does not affect this factsheet. Every OTHER
strategy (config ABSENT) stays on the unchanged NAV path, byte-identical.

``daily_pnl_usd`` reuses the VALIDATED native series (the zavara verification's
quantity), never ``txn_rows_to_daily_records``:

    daily_pnl_usd(d) = Σ_ccy native_pnl[ccy][d] × mark_ccy(d)      (USD-family ≡ 1.0)

``native_pnl`` is ``txn_rows_to_native_daily`` output (spot Bug-B extraction legs
already excluded); ``marks`` are the dense daily settlement marks — both taken off
``build_deribit_native_ledger``. Using ``txn_rows_to_daily_records`` instead would
leak spot-extraction legs into the denominatored returns → a wrong factsheet.

Metric conventions (zavara — capital resets across the schedule, so returns are NOT
geometrically chain-linked):
  * cumulative = ARITHMETIC sum of daily % (Σ r, capital-reset convention);
  * Sharpe / Sortino annualised √365;
  * max drawdown on the CUMULATIVE-% (running-sum) series;
  * headline = ACTIVE-day (nonzero-P&L days) — calendar-day also exposed.

Pure / pandas-aware; NO ccxt / supabase / network. Fails loud on malformed config
or an unmarkable P&L day (never silently zero or mis-scale realized cash).
"""
from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from services.external_flows import USD_FAMILY

# Trading days per year — the √365 annualiser (crypto trades every calendar day;
# zavara's headline uses the 365-day convention, not 252).
_ANNUALISATION_DAYS: float = 365.0

DENOMINATOR_ALLOCATED_CAPITAL: str = "allocated_capital"
_VALID_DENOMINATORS: frozenset[str] = frozenset({DENOMINATOR_ALLOCATED_CAPITAL})
# The accrual bases a config may name (mirrors deribit_txn._PNL_BASES; imported
# lazily-by-value here to keep this module ccxt/supabase-free — the string set is
# the contract, validated identically).
_VALID_PNL_BASES: frozenset[str] = frozenset(
    {"cash_settlement", "mark_to_market", "smoothed_mtm"}
)
METRICS_BASIS_ACTIVE_DAY: str = "active_day"
METRICS_BASIS_CALENDAR_DAY: str = "calendar_day"
_VALID_METRICS_BASES: frozenset[str] = frozenset(
    {METRICS_BASIS_ACTIVE_DAY, METRICS_BASIS_CALENDAR_DAY}
)
# The cumulative-return convention the SHIPPED factsheet path (compute_all_metrics)
# uses for this strategy. "geometric" = compounding cumprod (the platform default,
# every non-config strategy); "simple" = arithmetic Σ of daily % (the capital-reset
# convention an allocated-capital mandate reports on — capital is re-scheduled, not
# geometrically chain-linked). Absent ⇒ "geometric" (the platform default; a config
# must OPT IN to simple). The UI-switchable general toggle is a deferred follow-up —
# this only ships the config-driven value.
CUMULATIVE_GEOMETRIC: str = "geometric"
CUMULATIVE_SIMPLE: str = "simple"
_VALID_CUMULATIVE_METHODS: frozenset[str] = frozenset(
    {CUMULATIVE_GEOMETRIC, CUMULATIVE_SIMPLE}
)

# S3 — the SINGLE owner of the allocated-capital warn-promotion rule. Meta keys
# that, when truthy, promote computation_status to complete_with_warnings. Iterated
# at BOTH bridge sites (run_csv_strategy_analytics + run_derive_broker_dailies_job)
# exactly as ``NAV_TWR_GUARD_KEYS`` is, so a new allocated warn flag is added ONCE
# here instead of hand-copied into two branches (the known warning-drop-at-boundary
# hazard). Deliberately NOT a member of ``NAV_TWR_GUARD_KEYS``: these originate in
# the allocated_capital meta, not ``NavTWRMeta`` — folding them in would break the
# NavTWRMeta-subset invariant test.
ALLOCATED_CAPITAL_GUARD_KEYS: frozenset[str] = frozenset(
    {"mandate_window_excluded_days"}
)


class ReturnsDenominatorConfigError(ValueError):
    """A ``returns_denominator_config`` is structurally malformed — permanent, never
    a transient condition. Fail loud rather than ship a factsheet on a guessed
    capital base."""


class AllocatedCapitalValuationError(ValueError):
    """A P&L day could not be valued to USD against the dense marks, or precedes the
    capital schedule — permanent. Never silently zero or mis-scale realized cash."""


@dataclass(frozen=True)
class CapitalScheduleEntry:
    """One capital tranche: ``capital_usd`` applies FROM ``effective_from``
    (inclusive) until the next entry's ``effective_from`` (exclusive)."""

    effective_from: date
    capital_usd: float

    def __post_init__(self) -> None:
        # S2 — the invariant lives in the TYPE, not only the parse factory: a
        # directly-constructed entry (tests / future callers) that bypasses
        # ``parse_returns_denominator_config`` still cannot hold a non-positive /
        # non-finite capital base (a zero/neg denominator divides-by-zero or
        # sign-flips every return). Pure, no I/O.
        if isinstance(self.capital_usd, bool) or not isinstance(
            self.capital_usd, (int, float)
        ):
            raise ReturnsDenominatorConfigError(
                f"CapitalScheduleEntry.capital_usd must be a number, got "
                f"{self.capital_usd!r}"
            )
        if not (float(self.capital_usd) > 0.0) or not np.isfinite(self.capital_usd):
            raise ReturnsDenominatorConfigError(
                f"CapitalScheduleEntry.capital_usd ({self.capital_usd!r}) must be a "
                "finite positive number"
            )


@dataclass(frozen=True)
class ReturnsDenominatorConfig:
    """A parsed, VALIDATED per-strategy returns-denominator override."""

    denominator: str
    pnl_basis: str
    capital_schedule: tuple[CapitalScheduleEntry, ...]
    metrics_basis: str
    # Defaulted so a direct constructor (tests / a future caller) that omits the
    # v1.8 additions degrades to the platform default (geometric, unbounded end) —
    # BYTE-IDENTICAL to the pre-Fix-A/B behaviour. ``parse_returns_denominator_config``
    # always passes both explicitly.
    cumulative_method: str = CUMULATIVE_GEOMETRIC
    # The mandate REPORTING window end (inclusive). The schedule's first
    # ``effective_from`` bounds the START; ``mandate_end`` (when set) bounds the
    # END. P&L days after ``mandate_end`` (the post-mandate winding-down tail —
    # a Deribit txn-log runs to today, long past an allocated mandate's close)
    # are EXCLUDED from the reported track, with a telemetry count. ``None`` ⇒ the
    # window runs to the last P&L day (unbounded end, prior behaviour).
    mandate_end: date | None = None

    def __post_init__(self) -> None:
        # S2 — enum + structural invariants owned by the TYPE, so a directly
        # constructed config (bypassing the parse factory) cannot hold a bad enum,
        # an empty / non-ascending schedule, or a mandate_end that kills a later
        # tranche. Pure, no I/O; mirrors the parse-factory validation.
        if self.denominator not in _VALID_DENOMINATORS:
            raise ReturnsDenominatorConfigError(
                f"denominator {self.denominator!r} is not one of "
                f"{sorted(_VALID_DENOMINATORS)}"
            )
        if self.pnl_basis not in _VALID_PNL_BASES:
            raise ReturnsDenominatorConfigError(
                f"pnl_basis {self.pnl_basis!r} is not one of {sorted(_VALID_PNL_BASES)}"
            )
        if self.metrics_basis not in _VALID_METRICS_BASES:
            raise ReturnsDenominatorConfigError(
                f"metrics_basis {self.metrics_basis!r} is not one of "
                f"{sorted(_VALID_METRICS_BASES)}"
            )
        if self.cumulative_method not in _VALID_CUMULATIVE_METHODS:
            raise ReturnsDenominatorConfigError(
                f"cumulative_method {self.cumulative_method!r} is not one of "
                f"{sorted(_VALID_CUMULATIVE_METHODS)}"
            )
        if not self.capital_schedule:
            raise ReturnsDenominatorConfigError(
                "capital_schedule is empty — refusing a capital base with no tranches"
            )
        prev: date | None = None
        for entry in self.capital_schedule:
            if prev is not None and entry.effective_from <= prev:
                raise ReturnsDenominatorConfigError(
                    "capital_schedule dates must be STRICTLY ASCENDING; "
                    f"{entry.effective_from.isoformat()} is not after "
                    f"{prev.isoformat()}"
                )
            prev = entry.effective_from
        # S2 — mandate_end must be STRICTLY AFTER the LAST tranche's effective_from:
        # a mandate_end on/before a later tranche silently makes that tranche dead
        # (its capital never applies before the window closes).
        if self.mandate_end is not None:
            last_from = self.capital_schedule[-1].effective_from
            if self.mandate_end <= last_from:
                raise ReturnsDenominatorConfigError(
                    f"mandate_end ({self.mandate_end.isoformat()}) must be strictly "
                    f"after the LAST tranche's effective_from ({last_from.isoformat()}) "
                    "— an earlier mandate_end kills that tranche"
                )


def parse_returns_denominator_config(
    raw: Mapping[str, Any] | None,
) -> ReturnsDenominatorConfig | None:
    """Parse + VALIDATE a raw ``returns_denominator_config`` (the ``strategies``
    JSONB column). ``None`` / empty ⇒ ``None`` (the NORMAL NAV path — every
    non-override strategy). A present-but-malformed config FAILS LOUD
    (``ReturnsDenominatorConfigError``): a wrong capital base silently mis-scales
    every return, so we never coalesce a bad config to a default.

    Validates: ``denominator`` ∈ {allocated_capital}; ``pnl_basis`` ∈
    {cash_settlement, mark_to_market}; ``metrics_basis`` ∈ {active_day,
    calendar_day}; ``capital_schedule`` a NON-EMPTY list of
    ``{effective_from: ISO-date, capital_usd: >0}`` with STRICTLY ASCENDING dates;
    ``cumulative_method`` ∈ {geometric, simple} (OPTIONAL, default geometric);
    ``mandate_end`` an OPTIONAL ISO date strictly after the schedule start (the
    reporting-window END cap; null ⇒ unbounded end)."""
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise ReturnsDenominatorConfigError(
            f"returns_denominator_config must be an object, got {type(raw).__name__}"
        )
    if not raw:
        return None  # an empty object is treated as "no override" (NAV path).

    denominator = raw.get("denominator")
    if denominator not in _VALID_DENOMINATORS:
        raise ReturnsDenominatorConfigError(
            f"returns_denominator_config.denominator {denominator!r} is not one of "
            f"{sorted(_VALID_DENOMINATORS)}"
        )
    pnl_basis = raw.get("pnl_basis")
    if pnl_basis not in _VALID_PNL_BASES:
        raise ReturnsDenominatorConfigError(
            f"returns_denominator_config.pnl_basis {pnl_basis!r} is not one of "
            f"{sorted(_VALID_PNL_BASES)}"
        )
    metrics_basis = raw.get("metrics_basis")
    if metrics_basis not in _VALID_METRICS_BASES:
        raise ReturnsDenominatorConfigError(
            f"returns_denominator_config.metrics_basis {metrics_basis!r} is not one "
            f"of {sorted(_VALID_METRICS_BASES)}"
        )
    # cumulative_method is OPTIONAL — absent ⇒ the platform default (geometric).
    # A present value must be one of the valid methods (never coalesce garbage).
    raw_cum = raw.get("cumulative_method")
    if raw_cum is None:
        cumulative_method = CUMULATIVE_GEOMETRIC
    elif raw_cum in _VALID_CUMULATIVE_METHODS:
        cumulative_method = str(raw_cum)
    else:
        raise ReturnsDenominatorConfigError(
            f"returns_denominator_config.cumulative_method {raw_cum!r} is not one of "
            f"{sorted(_VALID_CUMULATIVE_METHODS)}"
        )

    raw_schedule = raw.get("capital_schedule")
    if not isinstance(raw_schedule, Sequence) or isinstance(raw_schedule, (str, bytes)):
        raise ReturnsDenominatorConfigError(
            "returns_denominator_config.capital_schedule must be a non-empty list"
        )
    if len(raw_schedule) == 0:
        raise ReturnsDenominatorConfigError(
            "returns_denominator_config.capital_schedule is empty — refusing a "
            "capital base with no tranches"
        )
    entries: list[CapitalScheduleEntry] = []
    prev_date: date | None = None
    for i, item in enumerate(raw_schedule):
        if not isinstance(item, Mapping):
            raise ReturnsDenominatorConfigError(
                f"capital_schedule[{i}] must be an object, got {type(item).__name__}"
            )
        raw_from = item.get("effective_from")
        if not isinstance(raw_from, str) or not raw_from.strip():
            raise ReturnsDenominatorConfigError(
                f"capital_schedule[{i}].effective_from must be an ISO date string, "
                f"got {raw_from!r}"
            )
        try:
            eff = date.fromisoformat(raw_from.strip())
        except ValueError as e:
            raise ReturnsDenominatorConfigError(
                f"capital_schedule[{i}].effective_from {raw_from!r} is not a valid "
                "ISO date (YYYY-MM-DD)"
            ) from e
        raw_cap = item.get("capital_usd")
        if isinstance(raw_cap, bool) or not isinstance(raw_cap, (int, float)):
            raise ReturnsDenominatorConfigError(
                f"capital_schedule[{i}].capital_usd must be a number, got {raw_cap!r}"
            )
        cap = float(raw_cap)
        if not (cap > 0.0) or not np.isfinite(cap):
            raise ReturnsDenominatorConfigError(
                f"capital_schedule[{i}].capital_usd ({raw_cap!r}) must be a finite "
                "positive number — refusing a non-positive capital base (a zero/neg "
                "denominator would divide-by-zero or sign-flip every return)"
            )
        if prev_date is not None and eff <= prev_date:
            raise ReturnsDenominatorConfigError(
                f"capital_schedule dates must be STRICTLY ASCENDING; entry {i} "
                f"({eff.isoformat()}) is not after the previous ({prev_date.isoformat()})"
            )
        prev_date = eff
        entries.append(CapitalScheduleEntry(effective_from=eff, capital_usd=cap))

    # mandate_end is OPTIONAL — absent/null ⇒ unbounded reporting-window end (prior
    # behaviour). When present it must be a valid ISO date STRICTLY AFTER the LAST
    # tranche's ``effective_from`` (S2): a mandate_end on/before a later tranche
    # silently makes that tranche dead (its capital never applies before the window
    # closes) — fail loud rather than report a window that kills scheduled capital.
    raw_end = raw.get("mandate_end")
    mandate_end: date | None = None
    if raw_end is not None:
        if not isinstance(raw_end, str) or not raw_end.strip():
            raise ReturnsDenominatorConfigError(
                f"returns_denominator_config.mandate_end must be an ISO date string "
                f"or null, got {raw_end!r}"
            )
        try:
            mandate_end = date.fromisoformat(raw_end.strip())
        except ValueError as e:
            raise ReturnsDenominatorConfigError(
                f"returns_denominator_config.mandate_end {raw_end!r} is not a valid "
                "ISO date (YYYY-MM-DD)"
            ) from e
        last_from = entries[-1].effective_from
        if mandate_end <= last_from:
            raise ReturnsDenominatorConfigError(
                f"returns_denominator_config.mandate_end ({mandate_end.isoformat()}) "
                f"must be after the LAST tranche's effective_from "
                f"({last_from.isoformat()}) — an earlier mandate_end kills that "
                "tranche (its capital never applies before the window closes)"
            )

    return ReturnsDenominatorConfig(
        denominator=denominator,
        pnl_basis=pnl_basis,
        capital_schedule=tuple(entries),
        metrics_basis=metrics_basis,
        cumulative_method=cumulative_method,
        mandate_end=mandate_end,
    )


def exclude_spot_extraction_for(config: "ReturnsDenominatorConfig | None") -> bool:
    """F1 — the SINGLE source of the Bug-B spot-extraction coupling: net-daily spot
    extraction is dropped from ``native_pnl`` IFF the strategy is config-bearing (the
    ALLOCATED / Zavara path). Both the worker (``run_derive_broker_dailies_job``) and
    the acceptance harness (``scripts.zavara_acceptance``) route their
    ``build_deribit_native_ledger(exclude_spot_extraction=...)`` through this, so the
    harness can never silently validate a DIFFERENT mode than production ships
    (the coupling invariant documented on ``broker_dailies.combine_native_ledger``)."""
    return config is not None


def metrics_day_basis(metrics_basis: str) -> str:
    """B2 — the EXHAUSTIVE, fail-loud map from a config ``metrics_basis``
    (``active_day`` / ``calendar_day``) to the ``compute_all_metrics`` ``day_basis``
    (``active`` / ``calendar``). An unknown value RAISES
    ``ReturnsDenominatorConfigError`` (permanent) rather than silently defaulting to
    the calendar Sharpe basis on the money path — mirrors the double-gated fail-loud
    of pnl_basis / cumulative_method / day_basis. The single owner of this mapping
    (used by both the CSV runner and the acceptance harness)."""
    if metrics_basis == METRICS_BASIS_ACTIVE_DAY:
        return "active"
    if metrics_basis == METRICS_BASIS_CALENDAR_DAY:
        return "calendar"
    raise ReturnsDenominatorConfigError(
        f"returns_denominator_config.metrics_basis {metrics_basis!r} is not one of "
        f"{sorted(_VALID_METRICS_BASES)} — refusing to silently ship a default "
        "risk-metric day-basis on the allocated-capital factsheet"
    )


def capital_on_date(
    schedule: Sequence[CapitalScheduleEntry], day: pd.Timestamp
) -> float:
    """The allocated capital in force on ``day``: the LAST tranche whose
    ``effective_from`` ≤ ``day`` (a tranche applies until the next one starts). A
    day BEFORE the first tranche fails loud (``AllocatedCapitalValuationError``) —
    a P&L day with no scheduled capital is a real gap, never valued at a guess."""
    d = day.date() if isinstance(day, pd.Timestamp) else day
    chosen: float | None = None
    for entry in schedule:  # schedule is validated strictly-ascending
        if entry.effective_from <= d:
            chosen = entry.capital_usd
        else:
            break
    if chosen is None:
        first = schedule[0].effective_from.isoformat() if schedule else "<empty>"
        raise AllocatedCapitalValuationError(
            f"P&L day {d.isoformat()} precedes the capital schedule start ({first}); "
            "refusing to value a return against an undefined capital base"
        )
    return chosen


def daily_pnl_usd_series(
    native_pnl: Mapping[str, pd.Series],
    marks: Mapping[str, pd.Series],
) -> pd.Series:
    """Compose per-currency native daily P&L into a single USD daily-P&L Series
    (Option 2): ``Σ_ccy native_pnl[ccy][d] × mark_ccy(d)``, USD-family mark ≡ 1.0.

    An INDEXED (non-USD-family) currency's P&L day with NO dense mark fails loud
    (``AllocatedCapitalValuationError``) — mirrors the native core's
    ``missing_daily_marks`` refusal; a realized coin P&L is never valued at 1.0.
    Returns a float Series on the ascending union DatetimeIndex (empty ⇒ empty).

    Finding 4b (INTENTIONAL, stricter than the NAV core): a mark is required on
    EVERY native_pnl day — INCLUDING a net-zero-P&L day — whereas the NAV core
    tolerates a missing mark on a zero day (0 × mark = 0 regardless). This is a
    DELIBERATE fail-loud for the allocated path: the dense settlement marks
    ``build_deribit_native_ledger`` produces cover every native_pnl day by
    construction, so a hole here signals a real mark-coverage gap (never benign) and
    we refuse to ship rather than paper over it. No behaviour change intended — the
    marks are dense, so this branch never fires on well-formed input."""
    per_ccy_usd: list[pd.Series] = []
    for ccy, pnl in native_pnl.items():
        if pnl is None or len(pnl) == 0:
            continue
        cu = str(ccy).upper()
        if cu in USD_FAMILY:
            per_ccy_usd.append(pnl.astype(float))
            continue
        mark = marks.get(ccy)
        if mark is None or len(mark) == 0:
            raise AllocatedCapitalValuationError(
                f"currency {cu!r} carries native P&L but has no daily USD marks — "
                "refusing to value realized coin cash without an index (Option-2 "
                "valuation requires a same-day mark on every P&L day)"
            )
        aligned = mark.reindex(pnl.index)
        if bool(aligned.isna().any()):
            missing = [
                str(ts.date()) for ts in pnl.index[aligned.isna().to_numpy()]
            ]
            raise AllocatedCapitalValuationError(
                f"currency {cu!r} has native P&L on day(s) {missing} with no same-day "
                "USD mark — refusing to value realized coin cash without an index "
                "(never a current/period-end fallback, D-07)"
            )
        # LOW-1 (red-team): a NaN mark is caught above (no same-day mark). A mark
        # that is PRESENT but ZERO / NEGATIVE / non-finite is just as unusable: a
        # 0.0 mark silently ZEROES that day's realized coin P&L; a negative mark
        # SIGN-FLIPS it; an inf mark yields an inf USD day. All three are corrupt
        # index reads, never a valid valuation — fail loud rather than ship a
        # silently-wrong factsheet (mirrors the schedule's positive-capital guard).
        aligned_f = aligned.astype(float)
        arr = aligned_f.to_numpy()
        invalid = ~np.isfinite(arr) | (arr <= 0.0)
        if bool(invalid.any()):
            bad_days = [str(ts.date()) for ts in pnl.index[invalid]]
            raise AllocatedCapitalValuationError(
                f"currency {cu!r} has a non-finite or non-positive USD mark on "
                f"day(s) {bad_days} — refusing to value realized coin cash against a "
                "zero / negative / inf index (would silently zero, sign-flip, or "
                "inf the day's P&L)"
            )
        per_ccy_usd.append(pnl.astype(float) * aligned_f)
    if not per_ccy_usd:
        return pd.Series(dtype=float, name="daily_pnl_usd")
    combined = per_ccy_usd[0]
    for s in per_ccy_usd[1:]:
        combined = combined.add(s, fill_value=0.0)
    combined = combined.sort_index()
    combined.name = "daily_pnl_usd"
    return combined


def _annualised_sharpe(returns: pd.Series) -> float:
    """Mean / std × √365. ``nan`` when fewer than 2 points or zero variance."""
    if len(returns) < 2:
        return float("nan")
    sd = float(returns.std(ddof=1))
    if sd == 0.0 or not np.isfinite(sd):
        return float("nan")
    return float(returns.mean()) / sd * float(np.sqrt(_ANNUALISATION_DAYS))


def _annualised_sortino(returns: pd.Series) -> float:
    """Mean / downside-deviation × √365 (downside dev = √mean(min(r,0)²)). ``nan``
    when fewer than 2 points or no downside."""
    if len(returns) < 2:
        return float("nan")
    downside = returns.clip(upper=0.0)
    dd = float(np.sqrt((downside**2).mean()))
    if dd == 0.0 or not np.isfinite(dd):
        return float("nan")
    return float(returns.mean()) / dd * float(np.sqrt(_ANNUALISATION_DAYS))


def _max_drawdown_pct(cumulative_pct: pd.Series) -> float:
    """Max drawdown on the CUMULATIVE-% (running-sum) series, as a non-positive %:
    ``min_t (cum[t] − running_peak[t])``. ``0.0`` for a monotone / empty series.

    F2: the running high-water is seeded at 0.0 (``.clip(lower=0.0)``) — the
    from-INCEPTION baseline (starting capital is cumulative 0%). A negative day-1
    then shows as underwater instead of being hidden by a peak seeded at day-1's own
    negative cum. This makes the allocated meta agree with the shipped
    ``compute_all_metrics`` simple-branch maxDD AND the harness
    ``stitched_arithmetic_maxdd_pct`` comparator (both peak-0)."""
    if len(cumulative_pct) == 0:
        return 0.0
    running_peak = cumulative_pct.cummax().clip(lower=0.0)
    drawdown = cumulative_pct - running_peak
    return float(drawdown.min())


def allocated_capital_returns_and_metrics(
    native_pnl: Mapping[str, pd.Series],
    marks: Mapping[str, pd.Series],
    config: ReturnsDenominatorConfig,
) -> tuple[pd.Series, dict[str, Any]]:
    """The allocated-capital returns + zavara-convention metrics for a strategy
    carrying a ``returns_denominator_config``.

    Returns ``(returns, meta)`` where ``returns`` is the daily-return FRACTION Series
    (name ``"returns"``, ascending DatetimeIndex — the SAME shape the NAV path yields
    so downstream persistence is untouched) and ``meta`` carries the pre-computed
    zavara-convention headline metrics (arithmetic-sum cumulative, √365 Sharpe/
    Sortino, cumulative-% max drawdown) for BOTH active-day and calendar-day, plus a
    ``returns_denominator`` marker so the factsheet layer knows this strategy took
    the allocated-capital path (not the NAV reconstruction)."""
    pnl_usd = daily_pnl_usd_series(native_pnl, marks)
    # Restrict to the MANDATE WINDOW [mandate_start, mandate_end]. The track begins
    # on the schedule's first ``effective_from`` and (when ``mandate_end`` is set)
    # ends on it — inclusive on both bounds.
    #   * P&L days BEFORE the mandate started (the account's pre-mandate trading
    #     history — a Deribit txn-log reaches inception, long before an allocated
    #     mandate) are EXCLUDED BY DESIGN: not traded on this allocated capital.
    #   * P&L days AFTER ``mandate_end`` (the post-mandate winding-down tail — the
    #     txn-log runs to today) are EXCLUDED so the factsheet reports the mandate's
    #     actual life, not the drag of post-close residual activity (MEDIUM-2 /
    #     reconciliation: the uncapped end pulled in post-04-30 noise, a spurious
    #     -7.83% DD vs the real -4.11%).
    # Both exclusions are the DEFINED reporting window, NOT a silent drop —
    # ``capital_on_date`` still fails loud if an IN-window day ever precedes the
    # schedule (it cannot, post-filter), and both exclusion counts ride in ``meta``
    # with a warn flag whenever nonzero.
    mandate_start = pd.Timestamp(config.capital_schedule[0].effective_from)
    mandate_end_ts = (
        pd.Timestamp(config.mandate_end) if config.mandate_end is not None else None
    )
    n_pre_mandate_days_excluded = 0
    n_post_mandate_days_excluded = 0
    if len(pnl_usd) > 0:
        # L1: count ACTIVITY days only (pnl_usd != 0), matching the docstring +
        # n_active_days semantics. A pre/post-mandate NET-ZERO P&L day is not
        # "activity" and must NOT spuriously raise mandate_window_excluded_days →
        # complete_with_warnings on an otherwise-clean mandate.
        activity = pnl_usd != 0.0
        n_pre_mandate_days_excluded = int(
            ((pnl_usd.index < mandate_start) & activity).sum()
        )
        if mandate_end_ts is not None:
            n_post_mandate_days_excluded = int(
                ((pnl_usd.index > mandate_end_ts) & activity).sum()
            )
        in_window = pnl_usd.index >= mandate_start
        if mandate_end_ts is not None:
            in_window = in_window & (pnl_usd.index <= mandate_end_ts)
        pnl_usd = pnl_usd[in_window]
    if len(pnl_usd) == 0:
        returns_empty = pd.Series(dtype=float, name="returns")
        empty_meta = _empty_meta(config)
        empty_meta["n_pre_mandate_days_excluded"] = n_pre_mandate_days_excluded
        empty_meta["n_post_mandate_days_excluded"] = n_post_mandate_days_excluded
        if n_pre_mandate_days_excluded or n_post_mandate_days_excluded:
            empty_meta["mandate_window_excluded_days"] = True
        return returns_empty, empty_meta

    capital = pd.Series(
        [capital_on_date(config.capital_schedule, ts) for ts in pnl_usd.index],
        index=pnl_usd.index,
        dtype=float,
    )
    returns = (pnl_usd / capital).astype(float)
    returns.name = "returns"

    # Active-day = nonzero-P&L days (zavara's headline basis). Calendar-day =
    # EVERY calendar day in [first, last] with 0.0 on no-activity days (identical to
    # broker_dailies.gap_fill_daily_returns, which combine_native_ledger applies to
    # the returned Series), so the calendar-day risk metrics match the shipped
    # dense series.
    active = returns[pnl_usd != 0.0]
    dense_index = pd.date_range(returns.index.min(), returns.index.max(), freq="D")
    calendar = returns.reindex(dense_index, fill_value=0.0)

    # Cumulative is the ARITHMETIC sum (capital-reset convention) — identical for
    # active/calendar (zero days add nothing); computed on calendar for the DD path.
    cumulative_pct_series = calendar.cumsum() * 100.0

    meta: dict[str, Any] = {
        "returns_denominator": config.denominator,
        "returns_pnl_basis": config.pnl_basis,
        "returns_metrics_basis": config.metrics_basis,
        "returns_cumulative_method": config.cumulative_method,
        "cumulative_return_pct": float(calendar.sum() * 100.0),
        "max_drawdown_pct": _max_drawdown_pct(cumulative_pct_series),
        "n_active_days": int((pnl_usd != 0.0).sum()),
        "n_calendar_days": int(len(calendar)),
        # Mandate-window exclusion telemetry (MEDIUM-2 / reconciliation): how many
        # ACTIVITY days fell outside [mandate_start, mandate_end]. Nonzero raises a
        # warn flag that the worker bridges to data_quality_flags.
        "n_pre_mandate_days_excluded": n_pre_mandate_days_excluded,
        "n_post_mandate_days_excluded": n_post_mandate_days_excluded,
        # Headline (active-day) risk metrics.
        "sharpe_active_day": _annualised_sharpe(active),
        "sortino_active_day": _annualised_sortino(active),
        # Calendar-day exposed alongside for comparison.
        "sharpe_calendar_day": _annualised_sharpe(calendar),
        "sortino_calendar_day": _annualised_sortino(calendar),
    }
    if n_pre_mandate_days_excluded or n_post_mandate_days_excluded:
        meta["mandate_window_excluded_days"] = True
    # Headline Sharpe/Sortino resolve to the configured basis.
    headline_active = config.metrics_basis == METRICS_BASIS_ACTIVE_DAY
    meta["sharpe"] = (
        meta["sharpe_active_day"] if headline_active else meta["sharpe_calendar_day"]
    )
    meta["sortino"] = (
        meta["sortino_active_day"] if headline_active else meta["sortino_calendar_day"]
    )
    return returns, meta


def _empty_meta(config: ReturnsDenominatorConfig) -> dict[str, Any]:
    """The zero-activity meta (no P&L days) — every metric neutral/nan, still marked
    as the allocated-capital path."""
    return {
        "returns_denominator": config.denominator,
        "returns_pnl_basis": config.pnl_basis,
        "returns_metrics_basis": config.metrics_basis,
        "returns_cumulative_method": config.cumulative_method,
        "cumulative_return_pct": 0.0,
        "max_drawdown_pct": 0.0,
        "n_active_days": 0,
        "n_calendar_days": 0,
        "n_pre_mandate_days_excluded": 0,
        "n_post_mandate_days_excluded": 0,
        "sharpe_active_day": float("nan"),
        "sortino_active_day": float("nan"),
        "sharpe_calendar_day": float("nan"),
        "sortino_calendar_day": float("nan"),
        "sharpe": float("nan"),
        "sortino": float("nan"),
    }
