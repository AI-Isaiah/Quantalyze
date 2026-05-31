"""Unified equity-replay data-quality (DQ) channel — B22.

Before B22 the equity-valuation paths emitted data-quality signals four
incompatible ways:

1. a hand-assembled telemetry dict (``equity_reconstruction._fetch_and_price_window``),
2. a per-row boolean stamped onto every reconstructed row
   (``_r["pre_terminus_balance_unknown"]``),
3. a ``data_quality_flags`` aggregation in ``position_reconstruction.py`` whose
   bool-OR / int-sum / else-replace merge rule was HAND-DUPLICATED twice (the
   per-position aggregation and the FIFO drop-counter merge — commented as
   "mirrored ... so the two merges cannot diverge"), and
4. an ``EquityCurveBuilder`` path that only *logged* missing mark prices and
   deliberately returned no flag ("write-only state that nothing reads").

This module is the single source of truth that makes those failure modes hard
to reintroduce:

* :class:`EquityDQ` — the closed registry of equity-valuation DQ flag KEYS.
  Each value is the exact ``strategy_analytics.data_quality_flags`` JSONB key
  string already consumed downstream (dashboard equity-curve / drawdown
  suppression, admin health card), so the persisted shape is unchanged. Adding
  a flag is a one-line registry edit; a typo at a call site is a name the
  reviewer can diff against this enum.
* :class:`FallbackOutcome` — a value substitution carries the DQ flags that
  explain it plus the symbols it affected, so "substitute a value without
  recording why" stops being the easy path.
* :func:`merge_dq_flags` — the ONE reducer both replay engines route through,
  so the two flag merges can no longer drift apart.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Mapping


class EquityDQ(str, Enum):
    """Closed set of equity-replay data-quality flag keys.

    Each member's value is the literal key persisted on
    ``strategy_analytics.data_quality_flags`` and read by the allocator
    dashboard (equity-curve / drawdown / TWR suppression) and the admin health
    card. The strings are therefore a contract — changing one is a
    breaking change to those consumers, which is exactly why they live in one
    enumerated place rather than scattered as repeated string literals.
    """

    # Replay-time symbol observability (telemetry dict).
    SKIPPED_SYMBOLS = "skipped_symbols"
    UNKNOWN_PERP_SYMBOLS = "unknown_perp_symbols"
    INVERSE_PERP_SYMBOLS = "inverse_perp_symbols"
    CTVAL_DRIFT_WARNINGS = "ctval_drift_warnings"
    # OKX 90-day terminus: pre-terminus absolute levels unreliable (NEW-C01-11).
    PRE_TERMINUS_BALANCE_UNKNOWN = "pre_terminus_balance_unknown"
    OKX_TERMINUS_HIT = "okx_terminus_hit"
    # Anchor-skip flags (M-1 / H-02 / E1 / E2).
    ANCHOR_PARTIAL_TICKER_SYMBOLS = "anchor_partial_ticker_symbols"
    ANCHOR_OFFSET_IMPLAUSIBLE = "anchor_offset_implausible"
    ANCHOR_REPLAY_UNRELIABLE = "anchor_replay_unreliable"
    ANCHOR_OFFSET_SKIPPED_USD = "anchor_offset_skipped_usd"
    # Sibling-strategy coherence lookup failed.
    SIBLING_CHECK_FAILED = "sibling_check_failed"
    # B22 behaviour delta: EquityCurveBuilder previously only LOGGED missing
    # mark prices (unrealized_pnl silently zeroed, equity understated). It now
    # surfaces them through this flag so the substitution is auditable.
    MARK_PRICE_MISSING_SYMBOLS = "mark_price_missing_symbols"


@dataclass(frozen=True)
class FallbackOutcome:
    """The result of substituting a value when its primary source is missing.

    ``value`` is the substituted number that flows into the equity curve;
    ``dq_flags`` records WHY (keyed by :class:`EquityDQ` values — a substitution
    with an empty ``dq_flags`` is, by convention, a clean valuation);
    ``affected_symbols`` is the symbols the substitution touched. Frozen so an
    outcome is immutable once produced — combine several via :func:`merge`
    rather than mutating in place.
    """

    value: float
    dq_flags: dict[str, Any] = field(default_factory=dict)
    affected_symbols: tuple[str, ...] = ()


def merge_dq_flags(
    base: dict[str, Any], incoming: Mapping[str, Any]
) -> dict[str, Any]:
    """Merge ``incoming`` DQ flags into ``base`` (mutated in place) and return it.

    The canonical rule, previously hand-duplicated in
    ``position_reconstruction.py`` (the per-position aggregation AND the FIFO
    drop-counter merge):

    * **booleans** OR-merge — any ``True`` wins;
    * **ints / floats** sum — counters accumulate;
    * **everything else** (lists, strings) replaces.

    ``bool`` is checked before ``int`` because ``bool`` is a subclass of
    ``int`` in Python — a ``True`` must OR-merge, not sum to ``2``. Centralising
    the rule here is the by-construction guarantee the two former copies were
    only *commented* into agreement.
    """
    for k, v in incoming.items():
        if isinstance(v, bool):
            base[k] = base.get(k, False) or v
        elif isinstance(v, (int, float)):
            base[k] = base.get(k, 0) + v
        else:
            base[k] = v
    return base


def merge(*outcomes: FallbackOutcome) -> FallbackOutcome:
    """Combine several :class:`FallbackOutcome` into one.

    ``value`` sums (each outcome contributes its substituted magnitude — the
    equity-curve consumer adds component values), ``dq_flags`` fold through
    :func:`merge_dq_flags`, and ``affected_symbols`` union while preserving
    first-seen order (deterministic for snapshot diffing). Order of arguments
    does not change the merged ``dq_flags`` for the bool/sum rules; for the
    else-replace rule the last outcome wins, mirroring dict-merge semantics.
    """
    total = 0.0
    flags: dict[str, Any] = {}
    seen: dict[str, None] = {}
    for o in outcomes:
        total += o.value
        merge_dq_flags(flags, o.dq_flags)
        for sym in o.affected_symbols:
            seen.setdefault(sym, None)
    return FallbackOutcome(
        value=total, dq_flags=flags, affected_symbols=tuple(seen)
    )
