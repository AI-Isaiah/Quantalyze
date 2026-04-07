"""Perfect Match Engine — scores quant strategies for each allocator.

Founder-amplifier model (see docs/superpowers/plans/2026-04-07-perfect-match-engine.md):
this module produces a ranked candidate list that ONLY the founder admin sees in
/admin/match. Allocators never see the score directly — the founder picks 3 candidates
per allocator and ships them via the existing intro flow.

Key design decisions baked in from the dual-voice eng review:
- Hard vs soft eligibility split: hard exclusions (owned, thumbs_down, excluded_exchange)
  are NEVER relaxed; soft exclusions (sharpe, track, dd) get relaxed when <5 candidates.
- add_weight derived from target_ticket_size_usd / portfolio_aum, not hardcoded 0.10.
- corr_with_portfolio returns None (not 0.0) when overlap is insufficient.
- Single-element candidate set falls back to absolute scoring (no NaN from min-max).
- Helpers imported via alias from portfolio_optimizer (no extraction risk).
- Two modes: 'personalized' (uses portfolio_fit) and 'screening' (cold-start, no portfolio).
- Deterministic: same inputs → identical output (modulo dict ordering).

The function signature matches the plan's Task 4. Tests in tests/test_match_engine.py.
"""

import json
import math
from typing import Any, Optional

import numpy as np
import pandas as pd

# Import existing private helpers without extracting them. Aliased for the file
# so the regression test can import them from this module too.
from services.portfolio_optimizer import (
    _avg_corr,
    _compute_sharpe,
    _max_drawdown,
)
from services.match_defaults import merge_with_defaults

# Public re-exports so callers can import from either location.
compute_sharpe = _compute_sharpe
avg_corr = _avg_corr
max_drawdown = _max_drawdown


# Versioning for the engine + weight set. Bump on any change to the scoring math
# so historical batches are reproducible / debuggable.
ENGINE_VERSION = "v1.0.0"
WEIGHTS_VERSION = "v1.0.0"

# Top-N candidates returned per batch
TOP_N_CANDIDATES = 30
# Cap on excluded rows persisted (closest-to-threshold first)
TOP_N_EXCLUDED = 50

# Weights for the personalized score
W_PORTFOLIO_FIT = 0.40
W_PREFERENCE_FIT = 0.30
W_TRACK_RECORD = 0.15
W_CAPACITY_FIT = 0.15

# Weights for the screening (cold-start) score
W_SCREENING_PREFERENCE_FIT = 0.60
W_SCREENING_TRACK_RECORD = 0.25
W_SCREENING_CAPACITY_FIT = 0.15

# Sub-weights inside portfolio_fit
W_SHARPE_LIFT = 0.50
W_CORR_REDUCTION = 0.30
W_DD_IMPROVEMENT = 0.20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_float(value: Any) -> Optional[float]:
    """Float conversion that returns None for NaN/Inf. Same shape as services.metrics."""
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _normalize_min_max(values: list[Optional[float]]) -> list[float]:
    """Min-max normalize a list to [0, 1]. Handles single-element and all-None edge cases.

    - None values become 0.0 in the output (no contribution to score).
    - If only one finite value, clamp it to [0, 1] directly (don't just hand out
      a 1.0 sky-high normalized score for a single negative value — that would
      reward a candidate that actively hurts the portfolio).
    - If all values are equal, returns 0.5 for all (no signal).
    """
    finite = [v for v in values if v is not None]
    if not finite:
        return [0.0] * len(values)
    if len(finite) == 1:
        return [_clamp(v, 0.0, 1.0) if v is not None else 0.0 for v in values]
    lo = min(finite)
    hi = max(finite)
    if hi == lo:
        return [0.5 if v is not None else 0.0 for v in values]
    span = hi - lo
    return [(v - lo) / span if v is not None else 0.0 for v in values]


def _compute_corr_with_portfolio(
    portfolio_returns: pd.Series,
    candidate_returns: pd.Series,
    min_overlap_days: int = 10,
) -> Optional[float]:
    """Returns the correlation of a candidate to the weighted portfolio returns.

    Returns None if the overlap is shorter than min_overlap_days. The previous
    behavior in find_improvement_candidates was to return 0.0 for short overlap,
    which silently misled the reason generator. None is the honest signal.
    """
    if portfolio_returns.empty or candidate_returns.empty:
        return None
    aligned = pd.concat(
        [portfolio_returns.rename("port"), candidate_returns.rename("cand")],
        axis=1,
    ).dropna()
    if len(aligned) < min_overlap_days:
        return None
    corr = aligned["port"].corr(aligned["cand"])
    return _safe_float(corr)


# ---------------------------------------------------------------------------
# Eligibility (hard + soft split)
# ---------------------------------------------------------------------------


HARD_EXCLUSION_REASONS = {"owned", "thumbs_down", "excluded_exchange"}
SOFT_EXCLUSION_REASONS = {
    "below_min_sharpe",
    "below_min_track_record",
    "exceeds_max_dd",
    "off_mandate_type",
}


def _eligibility_check(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    owned_set: set[str],
    thumbs_down_set: set[str],
) -> tuple[Optional[str], Optional[str]]:
    """Run eligibility checks. Returns (exclusion_reason, exclusion_provenance) or (None, None).

    Hard exclusions are checked first. Soft exclusions only run if no hard exclusion fired.
    """
    sid = candidate["strategy_id"]

    # Hard exclusions
    if sid in owned_set:
        return ("owned", "portfolio")
    if sid in thumbs_down_set:
        return ("thumbs_down", "match_decision")
    excluded_exchanges = preferences.get("excluded_exchanges") or []
    excluded_exchanges_lower = {e.lower() for e in excluded_exchanges}
    cand_exchange = (candidate.get("exchange") or "").lower()
    if cand_exchange and cand_exchange in excluded_exchanges_lower:
        return ("excluded_exchange", cand_exchange)

    # Soft exclusions
    sharpe = candidate.get("sharpe")
    if sharpe is not None and preferences.get("min_sharpe") is not None:
        if sharpe < preferences["min_sharpe"]:
            return ("below_min_sharpe", f"{sharpe:.2f}")

    track_days = candidate.get("track_record_days") or 0
    if preferences.get("min_track_record_days") is not None:
        if track_days < preferences["min_track_record_days"]:
            return ("below_min_track_record", str(track_days))

    max_dd = candidate.get("max_drawdown_pct")
    if max_dd is not None and preferences.get("max_drawdown_tolerance") is not None:
        if abs(max_dd) > preferences["max_drawdown_tolerance"]:
            return ("exceeds_max_dd", f"{abs(max_dd):.2f}")

    pref_types = preferences.get("preferred_strategy_types") or []
    if pref_types:
        cand_type = candidate.get("strategy_type")
        if cand_type and cand_type not in pref_types:
            return ("off_mandate_type", cand_type)

    return (None, None)


def _eligibility_check_hard_only(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    owned_set: set[str],
    thumbs_down_set: set[str],
) -> tuple[Optional[str], Optional[str]]:
    """Same as _eligibility_check but only the hard rules. Used during relaxation."""
    sid = candidate["strategy_id"]
    if sid in owned_set:
        return ("owned", "portfolio")
    if sid in thumbs_down_set:
        return ("thumbs_down", "match_decision")
    excluded_exchanges_lower = {(e or "").lower() for e in (preferences.get("excluded_exchanges") or [])}
    cand_exchange = (candidate.get("exchange") or "").lower()
    if cand_exchange and cand_exchange in excluded_exchanges_lower:
        return ("excluded_exchange", cand_exchange)
    return (None, None)


# ---------------------------------------------------------------------------
# Sub-scores
# ---------------------------------------------------------------------------


def _compute_preference_fit(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
) -> float:
    """Three sub-components averaged: sharpe headroom, track-record headroom, DD headroom."""
    sub_scores = []

    sharpe = candidate.get("sharpe")
    min_sharpe = preferences.get("min_sharpe") or 0.0
    if sharpe is not None:
        # Headroom above the floor, scaled by the floor itself (with a small
        # lower bound so floor=0 still produces meaningful scores).
        # Smooth across min_sharpe — no kink at min_sharpe=1.0.
        cap = max(min_sharpe, 0.5) * 2
        if cap > 0:
            sub_scores.append(_clamp((sharpe - min_sharpe) / cap, 0, 1))

    track = candidate.get("track_record_days") or 0
    min_track = preferences.get("min_track_record_days") or 1
    if min_track > 0:
        sub_scores.append(_clamp((track - min_track) / min_track, 0, 1))

    max_dd = candidate.get("max_drawdown_pct")
    max_dd_tol = preferences.get("max_drawdown_tolerance")
    if max_dd is not None and max_dd_tol is not None and max_dd_tol > 0:
        sub_scores.append(_clamp(1 - (abs(max_dd) / max_dd_tol), 0, 1))

    if not sub_scores:
        return 0.5
    return sum(sub_scores) / len(sub_scores)


def _compute_track_record_score(candidate: dict[str, Any]) -> float:
    """min(1, track_record_days / 730) — 2 years = full credit."""
    track = candidate.get("track_record_days") or 0
    return min(1.0, track / 730)


def _compute_capacity_fit(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
) -> float:
    """Concentration headroom. 0 = saturated, 1 = plenty of room."""
    manager_aum = candidate.get("manager_aum")
    ticket_size = preferences.get("target_ticket_size_usd")
    max_concentration = preferences.get("max_aum_concentration") or 0.20

    # Unknown manager AUM → neutral
    if not manager_aum or manager_aum <= 0:
        return 0.5
    if not ticket_size or ticket_size <= 0:
        return 0.5

    concentration = ticket_size / manager_aum
    if concentration > max_concentration:
        return 0.0
    return _clamp(1 - (concentration / max_concentration), 0, 1)


def _compute_portfolio_fit_components(
    portfolio_returns_series: pd.Series,
    portfolio_weights: dict[str, float],
    portfolio_strategies_returns: dict[str, pd.Series],
    candidate_returns: pd.Series,
    add_weight: float,
) -> dict[str, Optional[float]]:
    """Compute sharpe_lift, corr_reduction, dd_improvement, corr_with_portfolio.

    All four can be None if the data is too sparse to compute meaningfully.
    """
    if portfolio_returns_series.empty or candidate_returns.empty:
        return {
            "sharpe_lift": None,
            "corr_reduction": None,
            "dd_improvement": None,
            "corr_with_portfolio": None,
        }

    # Align candidate to portfolio dates
    port_df = pd.DataFrame(portfolio_strategies_returns).dropna()
    if port_df.empty:
        return {
            "sharpe_lift": None,
            "corr_reduction": None,
            "dd_improvement": None,
            "corr_with_portfolio": None,
        }

    w_arr = np.array([portfolio_weights.get(sid, 0) for sid in port_df.columns])
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()
    current_port = (port_df * w_arr).sum(axis=1)
    current_sharpe = _compute_sharpe(current_port)
    current_avg_corr = _avg_corr(port_df)
    current_max_dd = _max_drawdown(current_port)

    # New portfolio = old × (1 - add_weight) + candidate × add_weight
    aligned = pd.concat([port_df, candidate_returns.rename("__cand__")], axis=1).dropna()
    if len(aligned) < 30:
        return {
            "sharpe_lift": None,
            "corr_reduction": None,
            "dd_improvement": None,
            "corr_with_portfolio": _compute_corr_with_portfolio(current_port, candidate_returns),
        }

    new_weights = {sid: w * (1 - add_weight) for sid, w in portfolio_weights.items()}
    new_weights["__cand__"] = add_weight
    w_new = np.array([new_weights.get(col, 0) for col in aligned.columns])
    if w_new.sum() > 0:
        w_new = w_new / w_new.sum()

    new_port = (aligned * w_new).sum(axis=1)
    new_sharpe = _compute_sharpe(new_port)
    new_avg_corr = _avg_corr(aligned)
    new_max_dd = _max_drawdown(new_port)

    sharpe_lift = (
        new_sharpe - current_sharpe
        if current_sharpe is not None and new_sharpe is not None
        else None
    )
    corr_reduction = (
        current_avg_corr - new_avg_corr
        if current_avg_corr is not None and new_avg_corr is not None
        else None
    )
    dd_improvement = (
        current_max_dd - new_max_dd
        if current_max_dd is not None and new_max_dd is not None
        else None
    )

    corr_with_portfolio = _compute_corr_with_portfolio(current_port, candidate_returns)

    return {
        "sharpe_lift": _safe_float(sharpe_lift),
        "corr_reduction": _safe_float(corr_reduction),
        "dd_improvement": _safe_float(dd_improvement),
        "corr_with_portfolio": corr_with_portfolio,
    }


# ---------------------------------------------------------------------------
# Reason generation
# ---------------------------------------------------------------------------


def _generate_reasons(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    score_breakdown: dict[str, Any],
    mode: str,
) -> list[str]:
    """Pick the top 3 most-relevant reasons for this candidate."""
    raw = score_breakdown["raw"]
    candidates: list[tuple[float, str]] = []  # (priority, text)

    corr = raw.get("corr_with_portfolio")
    if mode == "personalized" and corr is not None and corr < 0.2:
        candidates.append((0.95, f"Diversifies the book (correlation {corr:+.2f} with existing strategies)"))

    sharpe_lift = raw.get("sharpe_lift")
    if mode == "personalized" and sharpe_lift is not None and sharpe_lift > 0.1:
        candidates.append((0.90, f"Lifts portfolio Sharpe by {sharpe_lift:+.2f}"))

    track = candidate.get("track_record_days") or 0
    if track > 730:
        years = track / 365
        candidates.append((0.80, f"Long track record ({years:.1f} years)"))
    elif preferences.get("min_track_record_days") and track > preferences["min_track_record_days"] * 1.5:
        candidates.append((0.70, "Comfortably above the minimum track record we screen for"))

    raw_concentration = raw.get("ticket_concentration")
    if raw_concentration is not None and raw_concentration < 0.05:
        candidates.append((0.65, "Capacity headroom for the ticket size"))

    pref_types = preferences.get("preferred_strategy_types") or []
    if pref_types and candidate.get("strategy_type") in pref_types:
        candidates.append((0.60, f"Matches the {candidate['strategy_type']} mandate"))

    if (
        mode == "screening"
        and track > 365
        and (candidate.get("sharpe") or 0) > 1.5
    ):
        candidates.append((0.85, "High-conviction screening pick"))

    sharpe = candidate.get("sharpe")
    if sharpe is not None and sharpe > 2.0:
        candidates.append((0.55, f"Strong risk-adjusted return (Sharpe {sharpe:.1f})"))

    max_dd = candidate.get("max_drawdown_pct")
    if max_dd is not None and abs(max_dd) < 0.10:
        candidates.append((0.50, f"Shallow drawdown profile (max DD {abs(max_dd) * 100:.1f}%)"))

    # Sort by priority desc, take top 3
    candidates.sort(key=lambda c: c[0], reverse=True)
    return [c[1] for c in candidates[:3]]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def score_candidates(
    allocator_id: str,
    preferences: Optional[dict[str, Any]],
    portfolio_strategies: list[dict[str, Any]],
    portfolio_returns: dict[str, pd.Series],
    portfolio_weights: dict[str, float],
    candidate_strategies: list[dict[str, Any]],
    candidate_returns: dict[str, pd.Series],
    excluded_strategy_ids: Optional[set[str]] = None,
    thumbs_down_ids: Optional[set[str]] = None,
    portfolio_aum: Optional[float] = None,
) -> dict[str, Any]:
    """Score every candidate strategy for an allocator. See module docstring.

    Returns a dict with shape:
    {
      "mode": "personalized" | "screening",
      "filter_relaxed": bool,
      "engine_version": str,
      "weights_version": str,
      "effective_preferences": dict,
      "effective_thresholds": dict,
      "candidates": [{strategy_id, score, rank, score_breakdown, reasons}, ...],
      "excluded": [{strategy_id, exclusion_reason, exclusion_provenance, almost_passed}, ...],
    }
    """
    prefs = merge_with_defaults(preferences or {})
    owned_set: set[str] = {ps["strategy_id"] for ps in portfolio_strategies}
    if excluded_strategy_ids is None:
        excluded_strategy_ids = set()
    if thumbs_down_ids is None:
        thumbs_down_ids = set()

    # Mode selection
    mode = "personalized" if portfolio_strategies else "screening"

    # Pass 1: full eligibility (hard + soft)
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for cand in candidate_strategies:
        reason, provenance = _eligibility_check(
            cand, prefs, owned_set, thumbs_down_ids,
        )
        if reason is None:
            eligible.append(cand)
        else:
            excluded.append({
                "strategy_id": cand["strategy_id"],
                "exclusion_reason": reason,
                "exclusion_provenance": provenance,
                "candidate": cand,  # Keep raw for "almost-passed" sort later
            })

    filter_relaxed = False
    effective_thresholds = {
        "min_sharpe": prefs.get("min_sharpe"),
        "min_track_record_days": prefs.get("min_track_record_days"),
        "max_drawdown_tolerance": prefs.get("max_drawdown_tolerance"),
    }

    # Relaxation: if <5 eligible, drop soft exclusions and re-filter
    if len(eligible) < 5:
        filter_relaxed = True
        relaxed_prefs = dict(prefs)
        relaxed_prefs["min_sharpe"] = 0.0
        relaxed_prefs["min_track_record_days"] = 90
        relaxed_prefs["max_drawdown_tolerance"] = 1.0
        relaxed_prefs["preferred_strategy_types"] = []  # Drop type restriction too

        eligible = []
        excluded = []
        for cand in candidate_strategies:
            reason, provenance = _eligibility_check_hard_only(
                cand, relaxed_prefs, owned_set, thumbs_down_ids,
            )
            if reason is None:
                eligible.append(cand)
            else:
                excluded.append({
                    "strategy_id": cand["strategy_id"],
                    "exclusion_reason": reason,
                    "exclusion_provenance": provenance,
                    "candidate": cand,
                })
        effective_thresholds = {
            "min_sharpe": 0.0,
            "min_track_record_days": 90,
            "max_drawdown_tolerance": 1.0,
            "filter_relaxed": True,
        }

    # If still empty, return empty
    if not eligible:
        return {
            "mode": mode,
            "filter_relaxed": filter_relaxed,
            "engine_version": ENGINE_VERSION,
            "weights_version": WEIGHTS_VERSION,
            "effective_preferences": prefs,
            "effective_thresholds": effective_thresholds,
            "candidates": [],
            "excluded": _serialize_excluded(_top_excluded(excluded, prefs)),
            "excluded_total": len(excluded),
            "source_strategy_count": len(candidate_strategies),
        }

    # Compute add_weight from ticket size + portfolio AUM
    if mode == "personalized" and portfolio_aum and portfolio_aum > 0:
        ticket = prefs.get("target_ticket_size_usd") or 0
        add_weight = _clamp(ticket / portfolio_aum, 0.01, 0.5)
    else:
        add_weight = 0.10  # Default for cold-start or unknown AUM

    # Build the portfolio returns series once for personalized mode
    portfolio_returns_series: pd.Series
    if mode == "personalized" and portfolio_returns:
        port_df = pd.DataFrame(portfolio_returns).dropna()
        if not port_df.empty:
            w_arr = np.array(
                [portfolio_weights.get(sid, 0) for sid in port_df.columns]
            )
            if w_arr.sum() > 0:
                w_arr = w_arr / w_arr.sum()
            portfolio_returns_series = pd.Series(
                (port_df * w_arr).sum(axis=1),
                index=port_df.index,
                name="portfolio",
            )
        else:
            portfolio_returns_series = pd.Series(dtype=float)
    else:
        portfolio_returns_series = pd.Series(dtype=float)

    # Compute sub-scores for each eligible candidate
    raw_components: list[dict[str, Any]] = []
    for cand in eligible:
        sid = cand["strategy_id"]
        cand_returns = candidate_returns.get(sid)

        if mode == "personalized" and cand_returns is not None and not portfolio_returns_series.empty:
            pf_components = _compute_portfolio_fit_components(
                portfolio_returns_series,
                portfolio_weights,
                portfolio_returns,
                cand_returns,
                add_weight,
            )
        else:
            pf_components = {
                "sharpe_lift": None,
                "corr_reduction": None,
                "dd_improvement": None,
                "corr_with_portfolio": None,
            }

        manager_aum = cand.get("manager_aum") or 0
        ticket = prefs.get("target_ticket_size_usd") or 0
        ticket_concentration = (
            ticket / manager_aum if manager_aum > 0 else None
        )

        raw_components.append({
            "candidate": cand,
            "sharpe_lift": pf_components["sharpe_lift"],
            "corr_reduction": pf_components["corr_reduction"],
            "dd_improvement": pf_components["dd_improvement"],
            "corr_with_portfolio": pf_components["corr_with_portfolio"],
            "ticket_concentration": ticket_concentration,
        })

    # Normalize portfolio_fit components within the eligible set
    if mode == "personalized":
        sharpe_lifts = [r["sharpe_lift"] for r in raw_components]
        corr_reductions = [r["corr_reduction"] for r in raw_components]
        dd_improvements = [r["dd_improvement"] for r in raw_components]
        sharpe_lift_norm = _normalize_min_max(sharpe_lifts)
        corr_reduction_norm = _normalize_min_max(corr_reductions)
        dd_improvement_norm = _normalize_min_max(dd_improvements)
    else:
        sharpe_lift_norm = [0.0] * len(raw_components)
        corr_reduction_norm = [0.0] * len(raw_components)
        dd_improvement_norm = [0.0] * len(raw_components)

    # Final scoring
    scored: list[dict[str, Any]] = []
    for i, rc in enumerate(raw_components):
        cand = rc["candidate"]
        sid = cand["strategy_id"]

        if mode == "personalized":
            portfolio_fit = (
                W_SHARPE_LIFT * sharpe_lift_norm[i]
                + W_CORR_REDUCTION * corr_reduction_norm[i]
                + W_DD_IMPROVEMENT * dd_improvement_norm[i]
            )
        else:
            portfolio_fit = 0.0

        preference_fit = _compute_preference_fit(cand, prefs)
        track_record = _compute_track_record_score(cand)
        capacity_fit = _compute_capacity_fit(cand, prefs)

        if mode == "personalized":
            final_score = 100 * (
                W_PORTFOLIO_FIT * portfolio_fit
                + W_PREFERENCE_FIT * preference_fit
                + W_TRACK_RECORD * track_record
                + W_CAPACITY_FIT * capacity_fit
            )
        else:
            final_score = 100 * (
                W_SCREENING_PREFERENCE_FIT * preference_fit
                + W_SCREENING_TRACK_RECORD * track_record
                + W_SCREENING_CAPACITY_FIT * capacity_fit
            )

        score_breakdown: dict[str, Any] = {
            "preference_fit": preference_fit,
            "track_record": track_record,
            "capacity_fit": capacity_fit,
            "raw": {
                "corr_with_portfolio": rc["corr_with_portfolio"],
                "sharpe_lift": rc["sharpe_lift"],
                "dd_improvement": rc["dd_improvement"],
                "track_record_days": cand.get("track_record_days"),
                "manager_aum": cand.get("manager_aum"),
                "ticket_concentration": rc["ticket_concentration"],
                "sharpe": cand.get("sharpe"),
                "max_drawdown_pct": cand.get("max_drawdown_pct"),
            },
        }
        # Only include portfolio_fit when in personalized mode — guards against
        # silent reversion to "personalized for you" framing on cold-start.
        if mode == "personalized":
            score_breakdown["portfolio_fit"] = portfolio_fit

        reasons = _generate_reasons(cand, prefs, score_breakdown, mode)

        scored.append({
            "strategy_id": sid,
            "score": _safe_float(final_score) or 0.0,
            "score_breakdown": score_breakdown,
            "reasons": reasons,
        })

    # Sort descending by score, tie-break by strategy_id (deterministic)
    scored.sort(key=lambda x: (-x["score"], x["strategy_id"]))

    # Assign rank, take top N
    top = scored[:TOP_N_CANDIDATES]
    for i, item in enumerate(top):
        item["rank"] = i + 1

    return {
        "mode": mode,
        "filter_relaxed": filter_relaxed,
        "engine_version": ENGINE_VERSION,
        "weights_version": WEIGHTS_VERSION,
        "effective_preferences": prefs,
        "effective_thresholds": effective_thresholds,
        "candidates": top,
        "excluded": _serialize_excluded(_top_excluded(excluded, prefs)),
        "excluded_total": len(excluded),
        "source_strategy_count": len(candidate_strategies),
    }


def _top_excluded(
    excluded: list[dict[str, Any]],
    preferences: dict[str, Any],
) -> list[dict[str, Any]]:
    """Pick the top 50 excluded by 'closest to passing' (sorted by softness of failure)."""
    def _almost_passed_score(item: dict[str, Any]) -> float:
        """Higher = closer to passing. Hard exclusions sort to the bottom."""
        reason = item["exclusion_reason"]
        cand = item["candidate"]
        if reason in HARD_EXCLUSION_REASONS:
            return -1.0
        if reason == "below_min_sharpe":
            sharpe = cand.get("sharpe") or 0
            min_sharpe = preferences.get("min_sharpe") or 0
            return _clamp(sharpe / max(min_sharpe, 0.01), 0, 1)
        if reason == "below_min_track_record":
            track = cand.get("track_record_days") or 0
            min_track = preferences.get("min_track_record_days") or 1
            return _clamp(track / min_track, 0, 1)
        if reason == "exceeds_max_dd":
            max_dd = abs(cand.get("max_drawdown_pct") or 0)
            tol = preferences.get("max_drawdown_tolerance") or 1
            return _clamp(2 - max_dd / tol, 0, 1)
        return 0.5

    excluded_sorted = sorted(excluded, key=_almost_passed_score, reverse=True)
    return excluded_sorted[:TOP_N_EXCLUDED]


def _serialize_excluded(excluded: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop the raw `candidate` dict from excluded entries before returning."""
    return [
        {
            "strategy_id": item["strategy_id"],
            "exclusion_reason": item["exclusion_reason"],
            "exclusion_provenance": item.get("exclusion_provenance"),
        }
        for item in excluded
    ]


# ---------------------------------------------------------------------------
# Convenience for callers
# ---------------------------------------------------------------------------


def to_canonical_json(result: dict[str, Any]) -> str:
    """Stable JSON serialization for the determinism test."""
    return json.dumps(result, sort_keys=True, default=str)
