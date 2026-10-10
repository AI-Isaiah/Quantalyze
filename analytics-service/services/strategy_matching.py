"""Phase 19 / PR-X5 — shared strategy correlation matching.

Extracted from analytics-service/routers/portfolio.py:1024-1051 (the legacy
``verify_strategy`` endpoint's inline correlation block). Now shared
between:

  - The legacy ``verify_strategy`` endpoint (rollback target — stays for
    the kill-switch auto-rollback path until the BACKBONE-09 stability
    window proves the unified path healthy and the legacy endpoint can
    be removed).
  - The unified ``/process-key`` pipeline
    (analytics-service/routers/process_key.py) — runs the same match for
    EVERY flow_type (teaser, csv, internal_report, onboard, resync) per
    D7 unification (PR-X5 handover §"D7"). The matched_strategy_id rides
    on the ``metrics_snapshot`` payload in the ``metrics_captured``
    transition and surfaces in the endpoint response.

Sharing the implementation here keeps the two surfaces from drifting —
e.g., the 95% correlation threshold and the 30-overlap-day floor are
defined in exactly one place.
"""

from __future__ import annotations

import logging
from typing import Any

import pandas as pd

from services.benchmark import BtcClosesReadError, read_btc_closes
from services.dispersion import dispersing_corrwith
from services.native_to_usd import UsdSeriesConverter, native_units_by_id
from services.wealth_returns import daily_returns_from_row

logger = logging.getLogger("quantalyze.analytics")

# Correlation threshold above which a candidate published strategy is
# considered a "match." Tuned in the legacy verify_strategy block; keep
# in sync if the threshold ever moves.
_MATCH_CORRELATION_THRESHOLD = 0.95

# Minimum number of overlapping daily-return observations between the
# target returns series and a candidate published strategy's series
# before we trust a correlation calculation. Below this, correlations
# are noise.
_MIN_OVERLAP_DAYS = 30

# Cap on the number of published strategies we pull for the match. The
# legacy block used 100; we preserve that to keep query cost bounded.
_PUBLISHED_STRATEGIES_LIMIT = 100


async def _best_effort_btc_closes() -> pd.Series | None:
    """The stored BTC closes for the scan's USD conversion (164.6.6.2.1 SFH-01).

    Matching is best-effort, so a failed read still yields ``None`` (native candidates are
    then left out of the scan, never correlated raw, and USD candidates are scanned as
    usual). But the cause is logged here: a read that failed must not hide behind the
    same "no price source" an empty table gives.
    """
    try:
        return await read_btc_closes()
    except BtcClosesReadError as exc:
        logger.warning(
            "find_matched_strategy: stored BTC closes unreadable (%s); native-unit "
            "candidates are left out of the scan",
            exc,
        )
        return None


async def find_matched_strategy(
    returns: pd.Series,
    supabase: Any,
) -> str | None:
    """Find the published strategy_id whose returns series correlates
    >= 95% with ``returns`` over a 30-day-min overlap window. Returns
    ``None`` if no candidate clears the threshold, if there are no
    published strategies, or if the call to Supabase fails.

    Vectorized: builds one DataFrame of all candidate series and runs
    a single ``corrwith`` instead of looping per-strategy.

    Phase 164.6.6.2.1 (D-04, D-02): candidates are compared in USD. ``returns``
    is the trade-derived USD series, so a BTC-unit candidate's stored returns
    are converted to USD first (the ``portfolio_bridge`` idiom,
    ``UsdSeriesConverter``); correlating its raw BTC series against a USD target
    would compare two currencies. A native candidate that cannot be converted
    (no BTC price source, or no priced interval) is absent from the scan, never
    correlated raw.

    Logs warnings on Supabase errors but never raises — matching is
    a best-effort enrichment, not a load-bearing primitive.
    """
    try:
        published_result = (
            supabase.table("strategies")
            .select("id")
            .eq("status", "published")
            .limit(_PUBLISHED_STRATEGIES_LIMIT)
            .execute()
        )
        published_ids = [
            row["id"] for row in (published_result.data or [])
        ]

        if not published_ids:
            return None

        sa_result = (
            supabase.table("strategy_analytics")
            .select("strategy_id, returns_series, daily_returns, data_quality_flags")
            .in_("strategy_id", published_ids)
            .execute()
        )

        existing: dict[str, pd.Series] = {}
        for row in sa_result.data or []:
            # Phase 164.6.6.2.2 (D-06, D-01, D-02): ``returns_series`` is the
            # stored cumulative CURVE, so correlating it against the target's
            # DAILY RETURNS compared levels with returns and could report a
            # duplicate on a trend. The shared boundary hands back daily returns
            # (the row's ``daily_returns`` when present, else derived from the
            # curve by its cumulative method). A pure services module, so it is
            # imported directly rather than copied.
            #
            # ``keep_absent=True`` keeps an undefined day as NaN so the USD
            # conversion below prices a one-day move over that one day (the
            # ``portfolio_bridge`` idiom); the ``dropna`` on the aligned frame
            # discards it from the correlation either way.
            s = daily_returns_from_row(row, name=row["strategy_id"], keep_absent=True)
            if s is not None:
                existing[row["strategy_id"]] = s

        # D-04 / D-02: BEFORE the frame is built, every native-unit candidate is
        # put in USD. An unconvertible one is dropped from ``existing``. Only a
        # count is logged, never an id or an amount.
        existing, unconvertible = await UsdSeriesConverter(_best_effort_btc_closes).convert(
            existing, native_units_by_id(sa_result.data or [])
        )
        if unconvertible:
            logger.info(
                "find_matched_strategy: %d native-unit candidate(s) could not be "
                "converted to USD and were left out of the scan",
                len(unconvertible),
            )

        if not existing:
            return None

        df = pd.DataFrame(existing)
        aligned = pd.concat(
            [returns.rename("_target"), df], axis=1
        ).dropna()

        if len(aligned) < _MIN_OVERLAP_DAYS:
            return None

        # Phase 166.1 (C8, D-02): only legs that really disperse can match. A
        # raw corrwith gave two strategies with the same compounding constant
        # yield a 1.0 correlation (a false match), and an all-flat candidate set
        # an all-NaN Series whose idxmax raised into the except below, logging
        # "matching failed" on ordinary data. No dispersing pair is an explicit
        # no-match, so that warning keeps meaning a real failure.
        corrs = dispersing_corrwith(
            aligned.drop(columns=["_target"]), aligned["_target"]
        ).dropna()
        if corrs.empty:
            return None
        best = corrs.idxmax()
        if corrs[best] > _MATCH_CORRELATION_THRESHOLD:
            # ``best`` is a DataFrame column label sourced from
            # ``row["strategy_id"]`` (see ``existing`` above), i.e. a strategy_id
            # string; ``str()`` is a no-op coercion that makes the Any-typed
            # pandas ``idxmax()`` result honestly ``str``.
            return str(best)
        return None

    except Exception as exc:  # noqa: BLE001
        logger.warning("find_matched_strategy: matching failed: %s", exc)
        return None
