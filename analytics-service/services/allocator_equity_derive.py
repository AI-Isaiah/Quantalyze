"""Canonical allocator equity derivation — pure blend + coverage segmentation.

Phase 115 (E2), STITCH-01 (this module's blend half) + STITCH-06 seam contract
(the segmentation half). Pure, I/O-free functions: callers inject every series
and weight; nothing here touches supabase, the network, or the filesystem, so the
downstream plan-03 $-ledger core and the Phase 115.1 worker-side display
derivation both build on a hermetically testable foundation.

WHY THIS MODULE EXISTS
----------------------
Python must OWN the canonical allocator blend so the match engine, the factsheet,
and the live-baseline UI converge on one derivation. The Phase-36 TypeScript blend
in ``src/lib/queries.ts::liveBaselineMetricsFromPerKeyDailies`` (L2135-2256) is the
display-era SEMANTIC PRECEDENT — not the owner. This module ports its three
decisions canonically:

  * D1 — one "strategy" per ``api_key_id`` from its ``csv_daily_returns`` series;
         WEIGHT = that key's STATIC share of CURRENT equity (from holdings), NOT a
         time-varying / performance-tracking weight (queries.ts L2155-2210).
  * D2 — AUM stays from holdings; only the curve SHAPE + KPIs come from the blend.
         AUM is NOT this module's concern (the $-ledger is plan-03 / STITCH-03/04).
  * D3 — the blend is ALL-OR-NOTHING: if any eligible key has an EMPTY per-key
         series the WHOLE allocator degrades to the honest-empty baseline, never a
         mixed-annualization-basis half-blend (queries.ts L2105-2112, L2266-2275).

PARTIALLY-MISSING DAYS (constant-divisor 0-fill; the TS PRESENT-window path)
---------------------------------------------------------------------------
On a union day where a subset of keys lacks a row, we 0-FILL that key's return in the
NUMERATOR only and keep the divisor at the CONSTANT full weight mass:
``blended_r_t = Σ_i w_i · r_i,t(0-filled) / Σ_i w_i``.

D2 (attribution): this matches the TS engine's PRESENT-window path only
(``strategyReturns[s.id] = map.get(d) ?? 0`` + a constant divisor, scenario.ts
L411-415). The TS engine ALSO has an ABSENT-window path that RENORMALIZES the divisor
to exclude not-yet-started keys (scenario.ts L407-409 excludes absent members from
``activeWeightSum``). This module does NOT replicate that absent-window renorm — it
always uses the constant divisor — which is exactly the source of the HIGH-1
divergence below. So this is a deliberate NON-replication, not "the TS exactly."

D1 (scope of the guarantee): the constant-divisor 0-fill is safe for INTERIOR
partial-missing days. It is NOT structurally prevented here from a key's EXCLUSIVE
lead/tail day: ``blend_concurrent_returns`` receives the RAW union and is NOT wired to
``segment_coverage`` (only ``allocator_equity_curve`` is). An exclusive lead/tail day
IS 0-filled at full weight in THIS module and is SURFACED (never prevented here) via
the ``exclusive_fill_days`` flag / ``DegradeReason.EXCLUSIVE_FILL``. The structural
prevention — feeding the blend one ``Segment`` at a time so only genuine concurrent
blocks reach it — is the Phase-115.1 wiring (see the HIGH-1 comment in
``blend_concurrent_returns``); do NOT delete the ``exclusive_fill_days`` guard as
"redundant" until that wiring lands.

BINDING INVARIANTS
------------------
  * ADDITIVE ONLY. This module NEVER reads, writes, or upserts
    ``allocator_equity_snapshots`` and never imports the writer arm of
    ``equity_reconstruction`` (Pitfall 5 — two writers racing the same table). The
    legacy store keeps sole ownership of its table; STITCH-02 (its physical
    retirement) is DEFERRED because the reader census did not clear. See
    ``.planning/phases/115-e2-allocator-equity-reconstruction-scope-gated-verify-first/115-STITCH-02-DEFERRAL.md``.
    Residual readers pinning the store alive: R1 (match.py per-SYMBOL breakdown),
    R2 (compare per-symbol adapter), R3-partial (getMyAllocationDashboard
    breakdown / provenance fields), R5 (GDPR export manifest), R6 (SQL enqueue +
    pg_cron + compute_job_kinds constraints).
  * Landmine L1. Concurrent sibling keys compose via the CAPITAL-WEIGHTED BLEND,
    NEVER via ``stitch_composite.assert_windows_disjoint`` /
    ``stitch_clipped_series`` (those RAISE ``CompositeOverlapError`` on overlap BY
    DESIGN). Only the window VOCABULARY (``windows_overlap``, half-open
    ``[start, end)``) is reused, and only for SEQUENTIAL rotation boundaries.
  * No raw USD in logs/exceptions (T-115-03 / T-73-02). Weights are ratios (fine);
    equity magnitudes never enter a log or raise string. Flags carry bools/counts.

Purity: pandas + stdlib + typing ONLY.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from enum import Enum
from typing import TYPE_CHECKING, Any

import pandas as pd

from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError

if TYPE_CHECKING:  # annotation only: this module stays free of the exchange adapter at runtime
    from services.deribit_ingest import DeribitNativeAccountState
# STITCH-05: the KEPT cashflow/IRR surface the unified backbone cannot reproduce
# gets its first production caller via ``mwr_and_dietz_from_ledger`` (thread-only).
from services.portfolio_metrics import compute_modified_dietz, compute_mwr
from services.stitch_composite import MemberWindow, windows_overlap

class DegradeReason(str, Enum):
    """C3: the CLOSED set of degradation signals every producer emits (a ``str``
    enum so it JSON-serializes as its token and compares equal to the legacy string).
    CLASSIFIED benign vs blocking so a consumer can honor the fail-loud signal via
    ``is_trustworthy`` instead of re-implementing the stringly-typed ``flags`` policy
    (the MEDIUM-6 / LOW-7 class). Do NOT grow a display-policy engine here — 115.1
    refines nuance; this is the minimal correct/suspect split.

    BENIGN — informational; the curve/blend/replay number is still CORRECT:
    """

    # ── BENIGN (curve is correct) ──
    WINDOW_TRUNCATED = "window_truncated"
    STALE_MARK_CARRY = "stale_mark_carry"
    CLASSIFIED_ROTATION = "classified_rotation"
    # honest-empty tokens (no data — a HONEST signal, never a fabricated number)
    NO_KEYS = "no_eligible_keys"
    MISSING_SERIES = "d3_missing_series"
    ZERO_WEIGHT_MASS = "zero_weight_mass"
    NO_ANCHOR = "no_anchor"
    NO_ANCHORED_KEYS = "no_anchored_keys"
    # ── BLOCKING (number is SUSPECT — a consumer must refuse) ──
    UNCLASSIFIED_ROTATION = "unclassified_rotation"
    EXCLUSIVE_FILL = "exclusive_fill"
    OUT_OF_WINDOW_FLOW = "out_of_window_flow"
    # 167.1.2.2 D-13: a full-history venue's opening deposit run (consecutive flow
    # days ending the day before the first return day) after which the replay
    # implies capital that was NOT near zero before the first flow. The curve starts
    # from money the ledger never funded, so the early levels are suspect. This is
    # the honest name for the fact; ``out_of_window_flow`` says only where a flow
    # sits, not whether the account reconciles to a zero start.
    INCEPTION_UNRECONCILED = "inception_unreconciled"
    DROPPED_KEY = "dropped_key"
    # 167.1.2 C2 silent-failure SFH-10: a book-return day whose level, return or
    # sum was non-finite. It was reported under the benign
    # skipped_nonpositive_denominator flag; a non-finite input is not benign.
    NONFINITE_RETURN = "nonfinite_return"
    # 167.1.2 C2 round 2 (SFH-R2-03): a shared account whose counted member's
    # series starts later than an older member's, where the older history could
    # not be joined honestly (``stitch_shared_account`` refused). The curve then
    # starts at the counted member's first day, so the book's window is shorter
    # than its history. Round 1 marked this with a benign flag; it is not.
    SHARED_ACCOUNT_HISTORY_TRUNCATED = "shared_account_history_truncated"
    # 167.1.2 C2 round 2 (SFH-R2-04): a shared account none of whose keys works.
    # It is counted once, but its series stopped the day its keys began failing
    # and is carried flat at r = 0 while the rest of the book moves, diluting the
    # book's return with frozen capital. Round 1 raised a benign flag of the
    # same name that nothing reads, so the book read "ready".
    SHARED_ACCOUNT_NO_WORKING_KEY = "shared_account_no_working_key"
    # 167.1.2.2 round-1 review (SFH M2): a key's ``key_inputs`` row and its stored
    # return series describe different derive runs. The dropped-day P&L the row carries
    # sits on a day that now HAS a return, so it could not be used and was ignored. The
    # two writes are not atomic, so a compose between them reads a stale/fresh mix, and
    # the levels it rebuilds from it are not the writer's. Counted in
    # ``dropped_day_pnl_ignored_days``; blocking because the curve is suspect, not
    # because any one number is wrong.
    KEY_INPUTS_MISMATCH = "key_inputs_mismatch"


# The BLOCKING subset: any of these present -> ``is_trustworthy`` is False.
_BLOCKING_REASONS: frozenset[DegradeReason] = frozenset(
    {
        DegradeReason.UNCLASSIFIED_ROTATION,
        DegradeReason.EXCLUSIVE_FILL,
        DegradeReason.OUT_OF_WINDOW_FLOW,
        DegradeReason.INCEPTION_UNRECONCILED,
        DegradeReason.DROPPED_KEY,
        DegradeReason.NONFINITE_RETURN,
        DegradeReason.SHARED_ACCOUNT_HISTORY_TRUNCATED,
        DegradeReason.SHARED_ACCOUNT_NO_WORKING_KEY,
        DegradeReason.KEY_INPUTS_MISMATCH,
    }
)


def _is_trustworthy(reasons: frozenset[DegradeReason]) -> bool:
    """True iff NO blocking degradation reason is present (a benign window-truncation
    / stale-mark / honest-empty does NOT block; a suspect number does)."""
    return not (reasons & _BLOCKING_REASONS)


# Backwards-compatible aliases (the enum members ARE these strings).
REASON_NO_KEYS = DegradeReason.NO_KEYS
REASON_MISSING_SERIES = DegradeReason.MISSING_SERIES
REASON_ZERO_WEIGHT_MASS = DegradeReason.ZERO_WEIGHT_MASS
REASON_NO_ANCHOR = DegradeReason.NO_ANCHOR
REASON_NO_ANCHORED_KEYS = DegradeReason.NO_ANCHORED_KEYS


@dataclass(frozen=True)
class BlendResult:
    """The canonical concurrent-blend output.

    ``blended`` is the capital-weighted daily-return Series, or ``None`` on the D3
    honest-empty degrade (never a half-blend). ``flags`` carries JSON-serializable
    bools/counts only — no USD magnitudes. ``degrade_reasons`` is the CLOSED
    ``DegradeReason`` set (C3); ``is_trustworthy`` is False iff any is BLOCKING."""

    blended: pd.Series | None
    flags: dict[str, Any] = field(default_factory=dict)
    degrade_reasons: frozenset[DegradeReason] = field(default_factory=frozenset)

    @property
    def is_trustworthy(self) -> bool:
        return _is_trustworthy(self.degrade_reasons)


def _nonfinite_count(series: pd.Series) -> int:
    """Count non-finite (NaN / ±inf) values in a return series (MEDIUM-2). Pure
    stdlib ``math.isfinite`` per the module's pandas+stdlib purity note."""
    return sum(1 for v in series.to_numpy() if not math.isfinite(float(v)))


_ISO_DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _assert_iso_day_index(index: Any, context: str) -> None:
    """Fail loud (C-idx) if any index label is not a bare ``YYYY-MM-DD`` string. The
    whole module keys days via ``str(d)`` (the ``csv_daily_returns`` /
    ``reconstruct_symbol_returns`` day-key shape). A ``DatetimeIndex`` stringifies to
    ``'YYYY-MM-DD 00:00:00'`` and would SILENTLY MISALIGN flow days vs return days in
    the ``set(r) | set(fbd)`` union — enforce the ISO-day contract at the boundary."""
    for d in index:
        if not (isinstance(d, str) and _ISO_DAY_RE.match(d)):
            raise NavReconstructionError(
                f"{context}: index label {d!r} is not a 'YYYY-MM-DD' day string — "
                "refusing a non-ISO-day index that would misalign flow/return days"
            )


def eligible_key_predicate(key_row: Mapping[str, Any]) -> bool:
    """The role-agnostic eligibility predicate, byte-identical to the phase35
    backfill dispatch filter (``scripts/phase35_backfill_enqueue.py``):

        is_active = true AND sync_status IS DISTINCT FROM 'revoked'
        AND disconnected_at IS NULL

    Mirrored here so the Phase 115.1 display derivation reuses ONE eligibility
    definition. A credential-revoked / soft-disconnected allocator key keeps
    ``is_active = true`` (rows persist for audit continuity) but is NOT eligible —
    the backfill never derives a series for it, so counting it would pin the D3
    gate to the honest-empty baseline forever (queries.ts L2277-2299)."""
    is_active = bool(key_row.get("is_active"))
    sync_status = key_row.get("sync_status")
    disconnected_at = key_row.get("disconnected_at")
    # IS DISTINCT FROM 'revoked' — NULL/anything-but-'revoked' passes.
    return is_active and sync_status != "revoked" and disconnected_at is None


# D-18 (founder, 2026-09-27). The last-sync statuses that make a key NOT
# working. Twin of NOT_WORKING_SYNC_STATUSES in src/lib/account-share-note.ts and
# of the tuple in set_departed_key_history_inclusion (migration 20260927180000);
# a parity test pins all three.
NOT_WORKING_SYNC_STATUSES: frozenset[str] = frozenset({"revoked", "sign_in_failed", "error"})

# The two account_share_kind values that mean "this key reads the same exchange
# account as the key named in account_shared_with_api_key_id" (D-01, D-04).
SHARED_ACCOUNT_KINDS: frozenset[str] = frozenset({"duplicate", "composite_member"})


def working_holder_predicate(key_row: Mapping[str, Any] | None) -> bool:
    """D-18: the READER RULE in COMMENT ON COLUMN api_keys.account_share_kind
    (migration 20260927180000). A key is WORKING when it is active, not
    disconnected, and its last sync is NULL or not revoked / sign_in_failed /
    error. A marked key counts through its holder only while that holder is
    working; otherwise the account is counted by a working sibling instead of
    by nobody. The NULL leg keeps a never-synced key working, as
    ``eligible_key_predicate`` does. A missing row is not working.

    Twin of ``isWorkingHolder`` in src/lib/account-share-note.ts. Every working
    key is eligible; an ``error`` or ``sign_in_failed`` key is eligible but not
    working, which is why a writer that swaps this rule in must also drop such a
    holder from its sum (see ``account_groups``)."""
    if key_row is None:
        return False
    sync_status = key_row.get("sync_status")
    return (
        key_row.get("is_active") is True
        and key_row.get("disconnected_at") is None
        and (sync_status is None or sync_status not in NOT_WORKING_SYNC_STATUSES)
    )


def account_groups(
    key_rows: Sequence[Mapping[str, Any]],
) -> list[list[Mapping[str, Any]]]:
    """The allocator's keys grouped by the exchange account they read.

    A group is a holder plus every key whose ``account_shared_with_api_key_id``
    points at it with a SHARED_ACCOUNT_KINDS marker, followed transitively (a key
    stamped against a holder that was itself once marked). A key that is
    unmarked, carries another kind, points at itself, or points at a key that is
    not among ``key_rows`` is a group of one: an unresolvable marker never merges
    or removes an account.

    Both allocator writers count each group ONCE (Phase 167.1.2 D-01, D-04,
    D-18), so which key of a group is counted is a property of the group, never
    of the order in which the stamper met the keys (C1 review WR-03: the marker's
    direction follows stamp order, not seniority). Deterministic: members sorted
    by id, groups by their first member's id."""
    ids = [str(r.get("id")) for r in key_rows if r.get("id") is not None]
    by_id = {str(r.get("id")): r for r in key_rows if r.get("id") is not None}
    parent = {key_id: key_id for key_id in ids}

    def _find(key_id: str) -> str:
        while parent[key_id] != key_id:
            parent[key_id] = parent[parent[key_id]]
            key_id = parent[key_id]
        return key_id

    for key_id in ids:
        row = by_id[key_id]
        if row.get("account_share_kind") not in SHARED_ACCOUNT_KINDS:
            continue
        holder_id = row.get("account_shared_with_api_key_id")
        if holder_id is None or str(holder_id) == key_id or str(holder_id) not in by_id:
            continue
        left, right = _find(key_id), _find(str(holder_id))
        if left != right:
            parent[max(left, right)] = min(left, right)

    grouped: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for key_id in sorted(ids):
        grouped[_find(key_id)].append(by_id[key_id])
    return [grouped[root] for root in sorted(grouped, key=lambda r: str(grouped[r][0].get("id")))]


def stitch_shared_account(
    links: Sequence[tuple[pd.Series, Sequence[Any]]],
) -> tuple[pd.Series, list[Any]] | None:
    """One exchange account read by several keys, as ONE return series.

    Phase 167.1.2 C2 round 2 (SFH-R2-03). ``links`` is the account's members,
    each as ``(returns, flows)``, ordered by first return day with the COUNTED
    member last. D-09 case (2) ordering: each earlier member owns the days from
    its own first return day up to, not including, the next member's first
    return day; the last member owns every day from its own first day on. A
    member's flows are taken for the days it owns (the first member keeps its
    flows dated before its first day, as any key's pre-window flow). One
    account is one series, so nothing is counted twice, and the flows of a day
    come from one key only: a newer key's crawl that reaches back over an older
    key's days lists the same transfers, and taking both would double them.

    Returns ``None`` when the join is not honest, and the caller then keeps the
    counted member alone under a BLOCKING reason:
      * a member has no returns;
      * an earlier member's series ends before the day before its successor's
        first day, so the days between hold nobody's returns (per-key dailies
        are dense calendar-daily, so a series that reaches that day covers the
        whole window it owns).
    Pure; the ISO-day index contract is asserted on every link."""
    if len(links) < 2:
        return None
    firsts: list[str] = []
    for index, (series, _flows) in enumerate(links):
        _assert_iso_day_index(series.index, f"stitch_shared_account[{index}]")
        if len(series) == 0:
            return None
        firsts.append(min(str(d) for d in series.index))
    days: list[str] = []
    values: list[float] = []
    flows_out: list[Any] = []
    for index, (series, flows) in enumerate(links):
        own_first = firsts[index]
        is_last = index == len(links) - 1
        next_first = None if is_last else firsts[index + 1]
        if next_first is not None:
            day_before = (date.fromisoformat(next_first) - timedelta(days=1)).isoformat()
            if max(str(d) for d in series.index) < day_before:
                return None
        for day, value in sorted(
            ((str(d), float(v)) for d, v in series.items()), key=lambda item: item[0]
        ):
            if day < own_first or (next_first is not None and day >= next_first):
                continue
            days.append(day)
            values.append(value)
        for flow in flows or ():
            flow_day = str(flow[0])
            if next_first is not None and flow_day >= next_first:
                continue
            if index > 0 and flow_day < own_first:
                continue
            flows_out.append(flow)
    return pd.Series(values, index=days, dtype="float64"), flows_out


def blend_concurrent_returns(
    series_by_key: Mapping[str, pd.Series],
    weights_by_key: Mapping[str, float],
) -> BlendResult:
    """Capital-weighted blend of CONCURRENT per-key daily-return series (D1/D2/D3).

    Contract (mirrors ``liveBaselineMetricsFromPerKeyDailies``):
      * D3 gate FIRST — no keys, or any key with an EMPTY series → honest-empty
        (``blended=None`` + ``honest_empty`` flag + machine ``reason``).
      * Sole eligible non-empty key → passes through as its own series, weight 1.0.
      * Otherwise blend over the UNION of days, 0-filling a key's missing interior
        day in the numerator only, dividing by the CONSTANT total weight mass.
      * Weights are STATIC current-equity shares; negative equity clamps to 0
        (queries.ts L2209). All-zero (or all-clamped-negative) mass is HONEST-EMPTY
        (``blended=None`` + ``REASON_ZERO_WEIGHT_MASS``) — no capital basis to blend
        on, never a fabricated equal-weight curve (LOW-8).
      * A non-coextensive key's EXCLUSIVE lead/tail day is 0-filled at full weight
        (see the module docstring D1) and surfaced via the ``exclusive_fill_days``
        flag / ``DegradeReason.EXCLUSIVE_FILL`` (a BLOCKING signal — ``is_trustworthy``
        is False) — never silently absorbed.

    Raises:
      NavReconstructionError — a PRESENT-but-non-finite return VALUE (NaN/inf, a csv
      gap) in ANY key series (MEDIUM-2). This runs BEFORE the sole-key passthrough, so
      a sole-key NaN series is refused too, never copied through.

    NEVER calls ``assert_windows_disjoint`` (Landmine L1) — overlapping siblings
    blend, they do not stitch."""
    keys = list(series_by_key.keys())
    if not keys:
        return BlendResult(
            None,
            {"honest_empty": True, "reason": REASON_NO_KEYS},
            frozenset({DegradeReason.NO_KEYS}),
        )

    # D3 all-or-nothing: any eligible key with an empty series collapses the whole
    # blend to the honest-empty baseline (never a single-key / half-basis curve).
    if any(len(series_by_key[k]) == 0 for k in keys):
        return BlendResult(
            None,
            {"honest_empty": True, "reason": REASON_MISSING_SERIES},
            frozenset({DegradeReason.MISSING_SERIES}),
        )

    # MEDIUM-2: a PRESENT-but-non-finite return value (csv gap → NaN) would
    # propagate into an all-NaN blended (or sole-key) curve with no signal. Refuse
    # non-finite return VALUES at ingestion — before the sole-key passthrough too.
    nonfinite_keys = sum(1 for k in keys if _nonfinite_count(series_by_key[k]))
    if nonfinite_keys:
        raise NavReconstructionError(
            f"blend: non-finite return value(s) in {nonfinite_keys} key series — "
            "refusing to propagate NaN/inf into the blended curve"
        )

    # F3 (Fable): refuse a non-finite WEIGHT (a NaN/inf ``value_usd`` from holdings).
    # ``max(0.0, nan) == 0.0`` would SILENTLY drop the key (blended == pure other,
    # is_trustworthy=True); ``inf/inf == nan`` would poison ``norm`` and emit an all-NaN
    # curve with is_trustworthy=True — the module would emit the poison it refuses on
    # return input. Runs BEFORE the sole-key passthrough so a sole key is covered too.
    bad_weights = sum(
        1 for k in keys if not math.isfinite(float(weights_by_key.get(k, 0.0)))
    )
    if bad_weights:
        raise NavReconstructionError(
            f"blend: non-finite weight(s) for {bad_weights} key(s) — refusing a "
            "NaN/inf value_usd (would silently drop a key or poison the blended curve)"
        )

    # Sole eligible key: pass its series through untouched at weight 1.0.
    if len(keys) == 1:
        sole = keys[0]
        # F6 (Fable): a sole key with zero/non-positive weight is HONEST-EMPTY, matching
        # the multi-key LOW-8 zero-mass path — otherwise ONE zero-capital key yields a
        # full trustworthy curve while TWO yield honest-empty (an inconsistency).
        if max(0.0, float(weights_by_key.get(sole, 0.0))) <= 0.0:
            return BlendResult(
                None,
                {"honest_empty": True, "reason": REASON_ZERO_WEIGHT_MASS},
                frozenset({DegradeReason.ZERO_WEIGHT_MASS}),
            )
        return BlendResult(
            series_by_key[sole].copy(),
            {"sole_key": True, "weight": 1.0},
        )

    # D1: static current-equity-share weights; clamp negative equity to 0 so a
    # deeply-losing key cannot inject a negative weight (queries.ts L2209).
    raw = {k: max(0.0, float(weights_by_key.get(k, 0.0))) for k in keys}
    total = sum(raw.values())
    if total <= 0.0:
        # LOW-8: all-zero (or all-clamped-negative) weight mass has NO capital basis
        # — the old equal-weight fallback FABRICATED a fully-populated curve with no
        # economic weight behind it. Honest-empty instead (like the D3 path), never
        # a soft flag on an invented curve.
        return BlendResult(
            None,
            {"honest_empty": True, "reason": REASON_ZERO_WEIGHT_MASS},
            frozenset({DegradeReason.ZERO_WEIGHT_MASS}),
        )
    norm = {k: raw[k] / total for k in keys}

    # Union axis (0-fill missing interior days in the numerator; constant divisor).
    # HIGH-1 (interim, Fable): ``.get(day, 0.0)`` 0-fills a key's row on a union day
    # OUTSIDE that key's own coverage (an exclusive lead/tail of a non-coextensive
    # key), blended at FULL weight — a fabricated flat 0% day that silently
    # dilutes/halves the blend. The docstring only defends this for INTERIOR
    # partial-missing days. The STRUCTURAL fix (feed the blend one Segment at a time,
    # via ``segment_coverage``, so interior-gap vs exclusive-tail is distinguishable)
    # is Phase-115.1 wiring work — NOT built here. INTERIM: emit an
    # ``exclusive_fill_days`` count so the fabrication is no longer invisible; 115.1
    # refuses when nonzero.
    union_days = sorted({d for k in keys for d in series_by_key[k].index})
    values: list[float] = []
    for day in union_days:
        r = 0.0
        for k in keys:
            r += norm[k] * float(series_by_key[k].get(day, 0.0))
        values.append(r)
    # F4 (Fable, 115.1 CARRY-IN — DO NOT "fix" here): this counts ANY union day where
    # a key lacks a row, so it OVER-COUNTS pure INTERIOR partial-missing days (which
    # the constant-divisor 0-fill is documented safe for) as well as the exclusive
    # lead/tail days it means to flag. Distinguishing interior-gap from exclusive-tail
    # REQUIRES the segment-wise blend wiring deferred to 115.1 (HIGH-1) — it cannot be
    # done here without segment_coverage. CONSEQUENCE: EXCLUSIVE_FILL is BLOCKING, so a
    # realistic non-coextensive multi-key allocator would read is_trustworthy=False on a
    # merely-interior gap — the never-green-gate (LOW-7) class rebuilt on the blend
    # surface. This is DORMANT today (the blend's is_trustworthy is not display-wired).
    # 115.1 MUST make this exclusive-ONLY (compute exclusive lead/tail via
    # segment_coverage) BEFORE gating any display/refusal on it, else it over-refuses
    # CORRECT curves.
    exclusive_fill_days = sum(
        1 for day in union_days if any(day not in series_by_key[k].index for k in keys)
    )
    blended = pd.Series(values, index=union_days, name="allocator_blend")
    reasons = (
        frozenset({DegradeReason.EXCLUSIVE_FILL}) if exclusive_fill_days else frozenset()
    )
    return BlendResult(
        blended,
        {
            "sole_key": False,
            "zero_weight_keys": sorted(k for k in keys if raw[k] == 0.0),
            "exclusive_fill_days": exclusive_fill_days,
            "n_keys": len(keys),
        },
        reasons,
    )


# ── STITCH-06: coverage segmentation (concurrent blocks vs sequential seams) ──


@dataclass(frozen=True)
class Segment:
    """A maximal run of calendar-consecutive days covered by the SAME set of keys.

    ``concurrent`` is True when more than one key covers the run (the blend
    applies); a single-key run is a genuine sequential leg. ``keys`` is the sorted
    covering-key tuple; ``days`` is the ordered ISO day list actually covered."""

    start_day: str
    end_day: str
    keys: tuple[str, ...]
    concurrent: bool
    days: tuple[str, ...]

    @property
    def n_days(self) -> int:
        return len(self.days)


@dataclass(frozen=True)
class Seam:
    """The STITCH-06 handoff contract consumed by wave 3: a genuine sequential
    rotation where one covering-key set fully hands off to a DISJOINT next set with
    ZERO shared coverage day. ``gap_days`` is the count of absent calendar days
    strictly between the two boundaries (0 for an adjacent half-open handoff; > 0
    for a real gap, whose days are NEVER zero-filled — no-invented-data).

    C2: the covering-key TUPLES ``prev_keys`` / ``next_keys`` are the REQUIRED source
    of truth (no ``()`` default — an empty covering set would be a silent zero-
    rotation hole that reintroduces the double-count). The lossy ``+``-joined scalar
    labels ``prev_key`` / ``next_key`` are DERIVED via ``_key_label`` (``@property``),
    never stored — so the string can never desync from the tuple (the WR-04 class)."""

    prev_last_day: str
    next_first_day: str
    gap_days: int
    prev_keys: tuple[str, ...]
    next_keys: tuple[str, ...]

    @property
    def prev_key(self) -> str:
        """The lossy ``+``-joined label for the previous covering set (derived)."""
        return _key_label(self.prev_keys)

    @property
    def next_key(self) -> str:
        """The lossy ``+``-joined label for the next covering set (derived)."""
        return _key_label(self.next_keys)


@dataclass(frozen=True)
class CoverageSegmentation:
    segments: list[Segment]
    seams: list[Seam]


def _key_window(seq: int, series: pd.Series) -> MemberWindow:
    """A per-key half-open ``MemberWindow`` derived from the series' actual first /
    last covered day (``window_end`` exclusive = last day + 1), so the shared
    ``windows_overlap`` predicate can be reused verbatim on live per-key coverage."""
    days = sorted(str(d) for d in series.index)
    start = days[0]
    end = (pd.Timestamp(days[-1]) + pd.Timedelta(days=1)).date().isoformat()
    return MemberWindow(seq, start, end)


def _key_label(keys: tuple[str, ...]) -> str:
    """The seam's ``prev_key`` / ``next_key`` scalar: the sole key for a single-key
    rotation, else the '+'-joined covering set for a (rare) block-to-block handoff."""
    return keys[0] if len(keys) == 1 else "+".join(keys)


def segment_coverage(
    series_by_key: Mapping[str, pd.Series],
) -> CoverageSegmentation:
    """Segment per-key coverage into concurrent blocks vs single-key legs, and emit
    the ordered Seam list for genuine sequential rotations.

    A day belongs to whichever keys have a row for it. Consecutive calendar days
    with an IDENTICAL covering-key set form one segment; a change in the covering
    set OR a calendar gap starts a new segment. A seam is emitted between two
    temporally-adjacent segments IFF their covering-key sets are DISJOINT (a real
    rotation — no shared coverage day); overlap transitions (single→concurrent→
    single) share a key and therefore carry NO seam. Reuses
    ``stitch_composite.windows_overlap`` for the rotation non-overlap check rather
    than hand-rolling interval math. No equity math here — this is the pure
    WHERE-do-synthetic-flows-apply contract for wave 3."""
    # C-idx: enforce the ISO-day-string index contract at the boundary (a
    # DatetimeIndex would misalign the ``str(d)`` day keys below).
    for k, s in series_by_key.items():
        _assert_iso_day_index(s.index, f"segment_coverage[{k}]")
    covered: dict[str, set[str]] = {
        k: {str(d) for d in s.index} for k, s in series_by_key.items()
    }
    union_days = sorted({d for days in covered.values() for d in days})

    windows: dict[str, MemberWindow] = {
        k: _key_window(i, series_by_key[k])
        for i, k in enumerate(series_by_key)
        if len(series_by_key[k]) > 0
    }

    segments: list[Segment] = []
    cur_keys: frozenset[str] | None = None
    cur_days: list[str] = []
    prev_day: str | None = None
    for day in union_days:
        keys_today = frozenset(k for k in covered if day in covered[k])
        is_gap = (
            prev_day is not None
            and (pd.Timestamp(day) - pd.Timestamp(prev_day)).days > 1
        )
        if cur_keys is None:
            cur_keys, cur_days = keys_today, [day]
        elif keys_today != cur_keys or is_gap:
            segments.append(_finish_segment(cur_keys, cur_days))
            cur_keys, cur_days = keys_today, [day]
        else:
            cur_days.append(day)
        prev_day = day
    if cur_keys is not None:
        segments.append(_finish_segment(cur_keys, cur_days))

    seams: list[Seam] = []
    for a, b in zip(segments, segments[1:]):
        a_keys, b_keys = set(a.keys), set(b.keys)
        if not a_keys.isdisjoint(b_keys):
            continue  # shared coverage → blended transition, not a rotation seam
        # Belt-and-suspenders: a genuine rotation's key windows must NOT overlap
        # (reuse the ONE shared half-open predicate, never inline interval math).
        if any(
            windows_overlap(windows[p], windows[n]) for p in a.keys for n in b.keys
        ):
            continue
        gap_days = (pd.Timestamp(b.start_day) - pd.Timestamp(a.end_day)).days - 1
        seams.append(
            Seam(
                prev_last_day=a.end_day,
                next_first_day=b.start_day,
                gap_days=gap_days,
                prev_keys=a.keys,
                next_keys=b.keys,
            )
        )

    return CoverageSegmentation(segments=segments, seams=seams)


def _finish_segment(keys: frozenset[str], days: list[str]) -> Segment:
    sorted_keys = tuple(sorted(keys))
    return Segment(
        start_day=days[0],
        end_day=days[-1],
        keys=sorted_keys,
        concurrent=len(sorted_keys) > 1,
        days=tuple(days),
    )


# ── STITCH-03/04: the $-equity backward-replay layer ─────────────────────────
#
# The perf-curve (cumprod of returns, cashflow-NEUTRAL) and the $-equity curve
# ($, which STEPS on external cashflows) are DIFFERENT outputs. The dailies path
# persists NO NAV column (csv_daily_returns is returns-only), so the $-curve is
# reconstructed BACKWARD from the terminal venue anchor through the return path —
# the SAME dated-flow convention as ``nav_twr.reconstruct_nav`` but replayed on
# RETURNS (not the un-persisted daily P&L):
#
#     backward:  equity_{t-1} = (equity_t - F_t) / (1 + r_t)
#     forward :  equity_t     = equity_{t-1} * (1 + r_t) + F_t
#
# ``F_t`` is the signed external flow on day ``t`` (deposit +, withdrawal −),
# dated on its UTC day; a flow on a no-return day unions in as a valid zero-return
# equity day (the ``nav_twr`` HIGH-1 precedent), never an orphan. No anchor ->
# NO $-series (honest degradation, flagged) — never a fabricated base.

# Self-check + guard tolerances. The backward roll is the exact inverse of the
# forward replay, so agreement is machine-eps; the band is a relative floor.
_SELF_CHECK_ABS = 1e-6
_SELF_CHECK_REL = 1e-9

# 167.1.2.2 D-13 / D-14 (founder 2026-10-08): the zero-start band. On a venue whose
# history reaches the account's start, an opening run of pre-window flows is the
# normal funding shape iff the capital the replay implies existed BEFORE the first
# flow is within this fraction of the level on the window's first return day. The
# founder chose 0.01% (tighter than the 1% recommended); do not loosen it to make a
# key pass, the verdict on a key that lands outside is the point of the check.
_INCEPTION_ZERO_START_BAND = 1e-4

# Venues whose history reaches the account's start, by the code's own statements:
#   * deribit: ``NativeLedger(full_history=True)`` (deribit_ingest) — the txn-log
#     reaches inception, and native_nav's §5 inception gate enforces it.
#   * mt5: ``combine_mt5_deal_ledger`` — ``history_deals_get`` is a FULL-HISTORY
#     fetch (epoch 0 -> now, mt5_read.read_mt5_deal_ledger), stamped
#     ``ledger_complete``. It has NO §5 inception gate of its own, so the zero-start
#     check below is the only inception evidence an MT5 key gets.
# Every other venue keeps the positional OUT_OF_WINDOW_FLOW rule unchanged: sfox is a
# sampled NAV, and the ccxt venues carry retention caps (OKX ~90d, Bybit ~365d).
FULL_HISTORY_VENUES: frozenset[str] = frozenset({"deribit", "mt5"})


@dataclass(frozen=True)
class KeyEquity:
    """One key's reconstructed $-equity series, or an honest degradation.

    ``equity`` is the per-day $-level Series (ISO-day index), or ``None`` when the
    key has no terminal anchor. ``reason`` is a machine token on the ``None`` path
    (no USD magnitude — T-115-05). ``flags`` carries JSON-serializable bools/counts
    (e.g. ``out_of_window_flows``) — no USD magnitudes. ``degrade_reasons`` is the
    CLOSED ``DegradeReason`` set (C3); ``is_trustworthy`` is False iff any is
    BLOCKING (e.g. an out-of-window flow)."""

    equity: pd.Series | None
    reason: str | None = None
    flags: dict[str, Any] = field(default_factory=dict)
    degrade_reasons: frozenset[DegradeReason] = field(default_factory=frozenset)

    @property
    def is_trustworthy(self) -> bool:
        return _is_trustworthy(self.degrade_reasons)


@dataclass(frozen=True)
class AllocatorEquity:
    """The allocator-level $-equity curve summed across anchored keys.

    ``equity`` is the summed $-level Series over the common anchored window, or
    ``None`` when no key is anchored. ``flags`` carries JSON-serializable
    bools/counts only — no USD magnitudes (T-115-05). ``degrade_reasons`` is the
    CLOSED ``DegradeReason`` set (C3); ``is_trustworthy`` is False iff any is BLOCKING
    (a dropped key or an unclassified rotation — the number is suspect). A BENIGN
    window-truncation / stale-mark carry does NOT block, so the live gate stays
    meaningful for a normal multi-key allocator (the LOW-7 fix)."""

    equity: pd.Series | None
    flags: dict[str, Any] = field(default_factory=dict)
    degrade_reasons: frozenset[DegradeReason] = field(default_factory=frozenset)

    @property
    def is_trustworthy(self) -> bool:
        return _is_trustworthy(self.degrade_reasons)


def perf_curve(returns: pd.Series | None) -> pd.Series | None:
    """The cashflow-NEUTRAL cumulative-return path, normalized to 1.0 on day 0.

    ``perf_t = Π_{s=1..t}(1 + r_s)`` (day-0 return is absorbed into the level, so
    ``perf_0 == 1.0``). This is deliberately the SAME normalization the $-curve's
    ``equity_t / equity_0`` telescopes to under ZERO flows (STITCH-03 equivalence
    pin) — the two curves are then byte-identical, and any deposit/withdrawal is
    the ONLY thing that can separate them. Returns ``None`` on an empty series.

    DAY-0 CONVENTION (WR-02 — the Phase-114 BACKBONE-01 precedent, decisive here):
    normalizing to ``perf_0 == 1.0`` divides OUT the day-0 factor ``(1 + r_0)``, so
    this curve's total growth is ``Π_{s≥1}(1 + r_s)`` — the SAME day-0-exclusion the
    deleted forward-TWR scalar (now ``metrics.total_return_from_equity``, an
    endpoint ratio over ``(1+r).cumprod()``) preserves byte-for-byte. The canonical
    backbone ``metrics.compute_all_metrics(...).cumulative_return`` is
    ``Π_{ALL days}(1 + r) − 1`` (INCLUDING day 0, metrics.py:1254), so
    ``(1 + backbone_cumret) == (1 + r_0) × perf_curve_terminal`` EXACTLY. This
    divergence is INTENTIONAL and pinned (parity oracle
    ``test_oracle_2b_curve_excludes_day0_pins_backbone_relationship``): a headline
    cumulative RETURN must ALWAYS be sourced from the backbone scalar, NEVER read
    off this perf-curve or the normalized $-curve (both drop day-0 identically). No
    115.1 consumer may derive a headline return from the curve."""
    if returns is None or len(returns) == 0:
        return None
    # MEDIUM-2: a PRESENT-but-non-finite return (csv gap → NaN) would
    # ``cumprod`` into a silent NaN curve with no flag. Refuse it here.
    bad_days = _nonfinite_count(returns)
    if bad_days:
        raise NavReconstructionError(
            f"perf_curve: {bad_days} non-finite return value(s) — refusing to "
            "propagate NaN/inf into a displayed curve"
        )
    factors = (1.0 + returns).cumprod()
    first = float(factors.iloc[0])
    if first == 0.0:
        # MEDIUM-3: ``(1 + r_0) == 0`` is a day-0 TOTAL LOSS, NOT a no-data series —
        # the old code returned ``None`` for BOTH, conflating them. An INTERIOR
        # −100% day still normalizes (its cumprod steps to 0, divided by a nonzero
        # ``first``); only a day-0 wipeout breaks the divisor. Fail loud, distinct
        # from the empty-series ``None``.
        raise NavReconstructionError(
            "perf_curve: day-0 total loss (1 + r_0 == 0) — cannot normalize to "
            "perf_0 == 1.0; distinct from the empty-series no-data case"
        )
    return factors / first


def _flows_by_day(flows: Sequence[Any] | None) -> dict[str, float]:
    """Sum signed external-flow USD per UTC day (deposit +, withdrawal −). Indexed
    access (``flow[0]``/``flow[1]``) so a 4-field ``ExternalFlow`` and a bare
    ``(day, usd)`` tuple both read; two flows on one day collapse to one sum —
    mirrors ``nav_twr._flows_to_daily_usd`` without importing its pandas plumbing."""
    sums: dict[str, float] = defaultdict(float)
    for flow in flows or []:
        amount = float(flow[1])
        # G2 (Fable, same finiteness class as C1/F3/F5): a non-finite flow amount
        # poisons the backward roll — a −inf flow builds an infinite equity that passes
        # the positivity + forward self-check (``abs(inf−inf)=nan > tol`` is False,
        # is_trustworthy=True), and a nan first-day flow (IN-02) is silently absorbed.
        # Refuse it with a data-quality message (no USD leak).
        if not math.isfinite(amount):
            raise NavReconstructionError(
                "allocator equity replay: non-finite external flow amount — refusing "
                "a data-quality NaN/inf flow"
            )
        sums[str(flow[0])] += amount
    return dict(sums)


def replay_key_equity(
    returns: pd.Series,
    flows: Sequence[Any] | None,
    anchor: float | None,
    *,
    history_reaches_inception: bool = False,
    dropped_day_pnl: Mapping[str, float] | None = None,
    realized_terminal: tuple[str, float] | None = None,
) -> KeyEquity:
    """Reconstruct one key's $-equity series BACKWARD from ``anchor`` (STITCH-04).

    ``anchor`` is the terminal (last-day) $-equity from the venue. Rolling
    backward with ``equity_{t-1} = (equity_t - F_t)/(1 + r_t)`` and unioning every
    flow day into the return index FIRST (HIGH-1 mirror — a flow on a no-return
    day is a valid ``r_t == 0`` equity day, never dropped), the series is exact by
    construction. ``anchor=None`` -> NO series + ``REASON_NO_ANCHOR`` (never a
    fabricated base).

    IN-02 caveat: the HIGH-1 union guarantee holds for INTERIOR flow days. A flow
    dated on the EARLIEST union day ``days[0]`` is folded into the reconstructed
    base ``equity[0]`` — the backward loop subtracts ``F_t`` only for ``t ≥ 1`` —
    so a first-day flow does NOT separately move the base. It is self-consistent
    (the forward self-check absorbs it identically) and correct for level
    reconstruction, but has no distinguishable effect on ``equity[0]``.

    167.1.2.2 D-13 / D-14 — OPENING FLOWS. A return series starts the day AFTER the
    account's first ledger event (the funding day's return is undefined, the prior
    capital being zero), so on a venue whose history reaches the account's start
    (``history_reaches_inception``, see ``FULL_HISTORY_VENUES``) the first flows
    legitimately sit before the first return day. Position alone cannot tell that
    from a suspect flow, so such a run is judged by the invariant it implies: the
    capital before its first flow, ``equity - pnl - F`` on that day (the day has no
    return; ``pnl`` is its stored P&L, see D-15 below), must be within
    ``_INCEPTION_ZERO_START_BAND`` of the level on the first return day. Within the
    band the run is the normal opening shape and
    does not block; outside it the key blocks as ``INCEPTION_UNRECONCILED``. The run
    is the consecutive calendar days of flows that END the day before the first
    return day. Every other flow outside the return window — an earlier,
    non-adjacent one, or one after the last return day — stays
    ``OUT_OF_WINDOW_FLOW``, and so does every out-of-window flow on a venue without
    full history (the default).

    167.1.2.2 D-15 — DROPPED DAYS. The TWR writer leaves a day out of the stored
    returns when its prior capital cannot be a denominator (the funding day under
    ``negative_nav_guard``, a day whose flow dominates the prior NAV). Such a day has
    no return but it still has P&L, and that P&L is already inside the venue's NAV.
    ``dropped_day_pnl`` ({ISO day: P&L in USD}, stored by the derive) carries it. The
    replay then uses it on those days instead of reading them as flat (``r = 0``),
    which moved the day's P&L into every earlier level and, on the funding day, into
    the zero-start check below as "missing start capital". A day that also has a
    return row keeps the return and its stored P&L is ignored (counted in the
    ``dropped_day_pnl_ignored_days`` flag, and the key degrades as ``KEY_INPUTS_MISMATCH``,
    blocking): the two cannot both describe it, so the row and the returns come from
    different derive runs. Absent or empty (every row written before D-15) behaves
    exactly as before.

    167.1.2.2 round-1 review CR-01 — THE WRITER'S OWN BASIS. The venue writers do not
    roll their NAV from the live equity ``anchor``: MT5 rolls from ``anchor - upnl`` (the
    balance), Deribit from ``terminal_native - upnl_native`` per currency at the mark of
    the last ledger day. Everything stored (the returns, the dropped-day P&L) lives on
    that REALIZED basis. Rolling it back from the live anchor shifts every level by
    ``U / G(t -> T)`` (``U`` = the open uPnL plus, on Deribit, any coin mark move since
    the last ledger day), and makes the zero-start check measure ``U`` instead of the
    inception: a clean account reads trustworthy one day and untrustworthy the next,
    depending on whether a position is open when the derive runs.
    ``realized_terminal`` = ``(ISO day, USD)`` is that terminal level, stored by the
    derive. When it is given and its day is the last day of the series, the roll starts
    from it, so every historical level (and the inception residual) is the writer's own,
    independent of the anchor and of any open position. The anchor then enters ONLY on
    the last day: the curve's last point is the live equity, and ``U`` is a step on that
    one day, never spread back across history (the writer's own endpoint convention). A
    row without it (written before this) rolls from the anchor exactly as before. A
    terminal day that is not the series' last day means the row and the returns come
    from different derive runs: the roll falls back to the anchor and the key degrades
    as ``KEY_INPUTS_MISMATCH``.

    Structural refusals raise ``NavReconstructionError`` (permanent, mirroring
    ``nav_twr``): a return factor ``1 + r_t <= 0`` (an un-replayable ≤ −100% day)
    or a non-positive reconstructed intermediate equity (a withdrawal dwarfing
    prior capital). Refusal text carries counts/day-indices ONLY — never a raw USD
    magnitude (T-115-05 / T-73-02).

    A forward/backward construction-sanity self-check (the ``nav_twr``
    reconcile pattern) replays FORWARD and asserts byte-agreement, reddening only
    on a roll-loop-vs-identity code divergence."""
    if anchor is None:
        return KeyEquity(
            None, REASON_NO_ANCHOR, degrade_reasons=frozenset({DegradeReason.NO_ANCHOR})
        )

    # F5 (Fable, same finiteness class as C1/F3): refuse a non-finite anchor. Without
    # this, ``anchor=inf`` builds an INFINITE equity series that passes the forward
    # self-check (``abs(inf−inf)=nan > tol`` is False) with is_trustworthy=True, and
    # ``anchor=nan`` trips the MISATTRIBUTED flow-dominance guard. Data-quality message,
    # no USD leak.
    if not math.isfinite(float(anchor)):
        raise NavReconstructionError(
            "allocator equity replay: non-finite anchor — refusing a data-quality "
            "NaN/inf terminal equity (distinct from the flow-dominance guard)"
        )

    if realized_terminal is not None and not math.isfinite(float(realized_terminal[1])):
        raise NavReconstructionError(
            "allocator equity replay: non-finite realized terminal — refusing a "
            "data-quality NaN/inf terminal equity"
        )

    # C-idx: enforce the ISO-day-string index contract before any day keying.
    _assert_iso_day_index(returns.index, "allocator equity replay")

    # C1: refuse a non-finite return VALUE at ingestion (a csv-gap NaN) with a
    # DATA-QUALITY diagnostic. Without this, a NaN return sails past the ≤−100%
    # factor guard (``nan <= 0`` is False), poisons the roll, and trips the
    # MISATTRIBUTED "a flow dominates prior capital" refusal downstream. Mirrors the
    # perf_curve / blend MEDIUM-2 refusal (no USD leak).
    bad_returns = _nonfinite_count(returns)
    if bad_returns:
        raise NavReconstructionError(
            f"allocator equity replay: {bad_returns} non-finite return value(s) — "
            "refusing a data-quality NaN/inf (distinct from the flow-dominance guard)"
        )

    fbd = _flows_by_day(flows)
    r = {str(d): float(v) for d, v in returns.items()}
    pnl_by_day, ignored_pnl_days = _dropped_pnl_by_day(dropped_day_pnl, r)
    # HIGH-1: union flow days into the return index BEFORE the roll. D-15: so are the
    # dropped days, which carry P&L and no return.
    days = sorted(set(r) | set(fbd) | set(pnl_by_day))
    n = len(days)
    if n == 0:
        return KeyEquity(
            None, REASON_NO_ANCHOR, degrade_reasons=frozenset({DegradeReason.NO_ANCHOR})
        )

    # MEDIUM-5: a flow dated OUTSIDE the return window [first, last] silently extends
    # the reconstructed curve with a fabricated point (a typo-year / out-of-window
    # transfer). We do NOT drop it (the HIGH-1 pre-window no-trade-day union is a
    # legitimate shape) but COUNT it so the extension is never invisible — a 115.1
    # consumer can refuse when nonzero. Return-day window bounds the check.
    ret_days = sorted(r)
    out_of_window_flows = 0
    opening_run: list[str] = []
    if ret_days:
        lo, hi = ret_days[0], ret_days[-1]
        if history_reaches_inception:
            opening_run = _opening_flow_run(fbd, lo)
        out_of_window_flows = sum(1 for fd in fbd if fd < lo or fd > hi) - len(opening_run)

    equity = [0.0] * n
    # CR-01: start from the writer's realized terminal when it is on the series' last
    # day; otherwise from the live anchor (an older row, or a row/returns mismatch).
    terminal_level = float(anchor)
    from_realized = False
    if realized_terminal is not None and realized_terminal[0] == days[-1]:
        terminal_level = float(realized_terminal[1])
        from_realized = True
    equity[n - 1] = terminal_level
    for t in range(n - 1, 0, -1):
        day_t = days[t]
        factor = 1.0 + r.get(day_t, 0.0)
        if factor <= 0.0:
            # An un-replayable ≤ −100% day: the backward identity has no positive
            # denominator. Fail loud with a day-index only (no USD).
            raise NavReconstructionError(
                f"allocator equity replay: non-positive return factor at "
                f"day-index {t} of {n} — cannot roll backward through a ≤−100% day"
            )
        equity[t - 1] = (
            equity[t] - fbd.get(day_t, 0.0) - pnl_by_day.get(day_t, 0.0)
        ) / factor

    bad = sum(1 for e in equity if not (e > 0.0))
    if bad:
        raise NavReconstructionError(
            f"allocator equity replay: non-positive reconstructed equity on "
            f"{bad} of {n} day(s) — a flow dominates prior capital (refusing to "
            "fabricate a floor)"
        )

    series = pd.Series(equity, index=days, name=getattr(returns, "name", None))
    _assert_forward_agreement(series, r, fbd, days, pnl_by_day)
    flags: dict[str, Any] = {}
    reasons: set[DegradeReason] = set()
    if realized_terminal is not None and not from_realized:
        flags["realized_terminal_day_mismatch"] = True
        reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)
    if from_realized and equity[n - 1] != float(anchor):
        # The live equity enters on the anchor day only. The check above ran on the
        # writer's own levels (the step into the last day is the writer's identity); this
        # is the one point the open position and any later mark move are added to.
        if not (float(anchor) > 0.0):
            raise NavReconstructionError(
                "allocator equity replay: non-positive reconstructed equity on 1 of "
                f"{n} day(s) — a flow dominates prior capital (refusing to fabricate "
                "a floor)"
            )
        series = series.copy()
        series.iloc[n - 1] = float(anchor)
    if pnl_by_day:
        flags["dropped_day_pnl_days"] = len(pnl_by_day)
    if ignored_pnl_days:
        flags["dropped_day_pnl_ignored_days"] = ignored_pnl_days
        # M2: a stored P&L that sits on a day with a return is a data-consistency
        # fault (the row and the returns are from different runs), not a note.
        reasons.add(DegradeReason.KEY_INPUTS_MISMATCH)
    if out_of_window_flows:
        flags["out_of_window_flows"] = out_of_window_flows
        reasons.add(DegradeReason.OUT_OF_WINDOW_FLOW)
    if opening_run:
        # The capital the replay implies before the run's first flow. That day has
        # no return row (it precedes the first return day): its level is the capital
        # before it, plus its P&L, plus its flow. D-15: the P&L is the stored one
        # (the funding day's trading result is real and is inside the level), so the
        # residue is the capital the ledger never funded, not a day's P&L. Without a
        # stored P&L (a row from before D-15) it is 0 and this is ``equity - F``.
        first_open = opening_run[0]
        implied_start = (
            equity[days.index(first_open)]
            - fbd[first_open]
            - pnl_by_day.get(first_open, 0.0)
        )
        level_first_return = equity[days.index(ret_days[0])]
        if abs(implied_start) > _INCEPTION_ZERO_START_BAND * level_first_return:
            flags["inception_unreconciled_flows"] = len(opening_run)
            reasons.add(DegradeReason.INCEPTION_UNRECONCILED)
        else:
            flags["opening_flows_reconciled"] = len(opening_run)
    return KeyEquity(series, None, flags, degrade_reasons=frozenset(reasons))


def dropped_day_pnl_payload(
    returns: pd.Series, day_pnl: pd.Series
) -> list[dict[str, Any]]:
    """The ``key_inputs`` payload rows for D-15: one ``{utc_day_iso, pnl_usd}`` per
    day the TWR left out of the stored returns (a NaN in ``returns``) that has a P&L.

    ``returns`` is the series the derive is about to persist, NaN where it writes no
    row; ``day_pnl`` is the venue's actual P&L per NAV day. A NaN day absent from
    ``day_pnl`` has nothing to store and is left out (the compose then reads it as
    flat, as before). A non-finite P&L is refused: JSONB cannot hold it, and a poison
    value would fail the upsert and loop the derive."""
    rows: list[dict[str, Any]] = []
    for ts in returns.index[returns.isna().to_numpy()]:
        if ts not in day_pnl.index:
            continue
        amount = float(day_pnl.loc[ts])
        if not math.isfinite(amount):
            raise NavReconstructionError(
                "key_inputs dropped-day P&L: non-finite amount — refusing to persist it"
            )
        rows.append({"utc_day_iso": pd.Timestamp(ts).date().isoformat(), "pnl_usd": amount})
    return rows


def read_dropped_day_pnl(payload: Mapping[str, Any]) -> dict[str, float]:
    """{ISO day: P&L in USD} from a ``key_inputs`` payload; ``{}`` when the row
    predates D-15 or has none to carry. The reader of the additive ``dropped_day_pnl``
    field: an absent or null field is the old row, not an error. A present but
    malformed one raises ``ValueError``/``TypeError``/``KeyError`` like the neighbouring
    ``flows`` parse, so the job disposes it as a corrupt input instead of reading a
    guess. Malformed includes a boolean or non-numeric amount and a repeated day."""
    raw = payload.get("dropped_day_pnl")
    if raw is None:
        return {}
    out: dict[str, float] = {}
    for row in raw:
        day = date.fromisoformat(str(row["utc_day_iso"])).isoformat()
        raw_amount = row["pnl_usd"]
        # ``float(True) == 1.0``: a JSON boolean would be read as a dollar. The MT5
        # flow channel already refuses it (``_fold_mt5_deals``); so does this one.
        if isinstance(raw_amount, bool) or not isinstance(raw_amount, (int, float)):
            raise TypeError("key_inputs dropped_day_pnl: non-numeric amount")
        amount = float(raw_amount)
        if not math.isfinite(amount):
            raise ValueError("key_inputs dropped_day_pnl: non-finite amount")
        # The writer emits one row per day. A repeated day is corruption, and
        # summing it would move every earlier level by the duplicate: refuse it
        # rather than read a guess.
        if day in out:
            raise ValueError("key_inputs dropped_day_pnl: duplicate day")
        out[day] = amount
    return out


def realized_terminal_payload(day: Any, usd: float) -> dict[str, Any]:
    """The ``key_inputs`` fields for CR-01: the level the venue writer rolled its NAV from
    (``realized_terminal_usd``) and the NAV day it sits on (``realized_terminal_day``).

    ``usd`` is the writer's REALIZED terminal: MT5 ``anchor - upnl`` (the balance),
    Deribit ``terminal_native - upnl_native`` per currency at the last ledger day's mark.
    It differs from ``anchor_usd`` (the live equity) by the open uPnL and, on Deribit, by
    any coin mark move since that day. A non-finite value is refused: JSONB cannot hold
    it, and a poison value would fail the upsert and loop the derive."""
    amount = float(usd)
    if not math.isfinite(amount):
        raise NavReconstructionError(
            "key_inputs realized terminal: non-finite amount — refusing to persist it"
        )
    return {
        "realized_terminal_usd": amount,
        "realized_terminal_day": pd.Timestamp(day).date().isoformat(),
    }


def read_realized_terminal(payload: Mapping[str, Any]) -> tuple[str, float] | None:
    """``(ISO day, USD)`` from a ``key_inputs`` payload; ``None`` when the row predates
    CR-01 (both fields absent or null), which the replay then composes from the live
    anchor exactly as before. The two fields travel together: one without the other, a
    boolean or non-numeric amount, a non-finite amount or a bad day raises
    ``ValueError``/``TypeError`` like the neighbouring parses, so the job disposes it as a
    corrupt input instead of reading a guess."""
    raw_day = payload.get("realized_terminal_day")
    raw_usd = payload.get("realized_terminal_usd")
    if raw_day is None and raw_usd is None:
        return None
    if raw_day is None or raw_usd is None:
        raise ValueError("key_inputs realized terminal: day and amount must come together")
    if isinstance(raw_usd, bool) or not isinstance(raw_usd, (int, float)):
        raise TypeError("key_inputs realized terminal: non-numeric amount")
    amount = float(raw_usd)
    if not math.isfinite(amount):
        raise ValueError("key_inputs realized terminal: non-finite amount")
    return date.fromisoformat(str(raw_day)).isoformat(), amount


# ── Phase 167.1.2.2.1 (DERIBITWEDGE, PR-1): the stored account-summary read ──────────────────
#
# The Deribit key-mode derive reads ``get_account_summaries`` once. These helpers STORE that
# one read in the key's ``key_inputs`` payload as ``account_summary`` (D-03: a live read is a
# stored input, never a silent one) together with a per-currency verdict on the documented
# identity ``equity = balance + futures_session_upl + futures_session_rpl + options_value``
# (Deribit's own field semantics, standard margin). No value a derive computes reads them.

_IDENTITY_PLACES_CAP: int = 12
# Four addends each rounded to ``d`` places contribute at most 2.5 units of the last place to
# a residual; ``4 * 10**-d`` is the tolerance that reading allows. It is set by the fields'
# OWN decimal precision rather than a flat constant, so a coin reported to 8 places and a USD
# stable reported to 2 are each judged against their own rounding.
_IDENTITY_TOL_UNITS: int = 4
_SUMMARY_STR_FIELDS: frozenset[str] = frozenset({"margin_model"})
_SUMMARY_BOOL_FIELDS: frozenset[str] = frozenset({"cross_collateral_enabled"})


def _decimal_places(value: float) -> int:
    """Decimal places of ``value``'s shortest round-trip form (``repr``), which reproduces
    the decimal the exchange sent."""
    exponent = Decimal(repr(value)).as_tuple().exponent
    return -exponent if isinstance(exponent, int) and exponent < 0 else 0


def _account_identity(snap: Mapping[str, Any]) -> dict[str, Any]:
    """The identity verdict of ONE currency's snapshot.

    ``identity_ok`` / ``identity_resid_ratio`` are ``None`` when the identity cannot be
    computed (no readable ``balance`` or ``equity``): not computable is never ``True``. A
    missing ``futures_session_rpl`` or ``options_value`` counts as 0.0 and a missing
    ``futures_session_upl`` falls back to ``session_upl`` (the order
    ``_combined_session_upl`` uses). The residual is exact decimal arithmetic."""
    options_value = snap.get("options_value")
    ident: dict[str, Any] = {
        "identity_ok": None,
        "identity_resid_ratio": None,
        "options_session_upl_nonzero": snap.get("options_session_upl", 0.0) != 0.0,
        "has_open_options": options_value is not None and options_value != 0.0,
    }
    equity = snap.get("equity")
    balance = snap.get("balance")
    if equity is None or balance is None:
        return ident
    upl = snap.get("futures_session_upl")
    if upl is None:
        upl = snap.get("session_upl")
    parts = [equity, balance]
    parts.extend(v for v in (upl, snap.get("futures_session_rpl"), options_value) if v is not None)
    places = min(max(_decimal_places(float(v)) for v in parts), _IDENTITY_PLACES_CAP)
    tolerance = Decimal(_IDENTITY_TOL_UNITS) * Decimal(10) ** -places
    total = sum(
        (Decimal(repr(float(v))) for v in parts[1:]),
        Decimal(0),
    )
    residual = Decimal(repr(float(equity))) - total
    ratio = float(abs(residual) / tolerance)
    ident["identity_resid_ratio"] = ratio
    ident["identity_ok"] = ratio <= 1.0
    return ident


def account_summary_payload(state: DeribitNativeAccountState) -> dict[str, Any]:
    """The ``key_inputs`` field ``account_summary``: the derive's ONE summaries read as stored
    numbers, the instant it was read, the ``{ccy}_usd`` index it resolved, and the identity
    verdict per currency.

    The snapshot is already whitelisted by the adapter; this writer additionally refuses a
    non-finite number (JSONB cannot hold NaN/inf, and a poison value would fail the upsert
    and loop the derive), as ``realized_terminal_payload`` does."""
    summaries: list[dict[str, Any]] = []
    identity: dict[str, dict[str, Any]] = {}
    for ccy in sorted(state.summary_snapshot):
        snap = state.summary_snapshot[ccy]
        for key, value in snap.items():
            if isinstance(value, float) and not math.isfinite(value):
                raise NavReconstructionError(
                    "key_inputs account_summary: non-finite amount — refusing to persist it"
                )
        summaries.append({"currency": ccy, **snap})
        identity[ccy] = _account_identity(snap)
    index_usd: dict[str, float] = {}
    for ccy in sorted(state.index_usd_snapshot):
        price = float(state.index_usd_snapshot[ccy])
        if not math.isfinite(price):
            raise NavReconstructionError(
                "key_inputs account_summary: non-finite index — refusing to persist it"
            )
        index_usd[ccy] = price
    return {
        "account_summary": {
            "read_at": state.read_at_iso,
            "summaries": summaries,
            "index_usd": index_usd,
            "identity": identity,
        }
    }


def _strict_finite_number(raw: Any, what: str) -> float:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise TypeError(f"key_inputs account_summary: non-numeric {what}")
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError(f"key_inputs account_summary: non-finite {what}")
    return value


def read_account_summary(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    """The stored ``account_summary`` from a ``key_inputs`` payload; ``None`` when the row
    predates it (absent or null) or the derive recorded ``account_summary_error`` instead.

    A present but malformed record raises ``TypeError``/``ValueError`` like the neighbouring
    parses, so the job disposes it as a corrupt input instead of reading a guess. Malformed
    includes a boolean or non-finite number, a string anywhere but ``margin_model``, a
    non-boolean ``cross_collateral_enabled``, a repeated currency and a verdict that is not a
    boolean (or null)."""
    raw = payload.get("account_summary")
    if raw is None:
        return None
    if not isinstance(raw, Mapping):
        raise TypeError("key_inputs account_summary: not an object")
    read_at = raw.get("read_at")
    if read_at is not None and not isinstance(read_at, str):
        raise TypeError("key_inputs account_summary: read_at is not a string")
    raw_summaries = raw.get("summaries")
    if not isinstance(raw_summaries, Sequence) or isinstance(raw_summaries, (str, bytes)):
        raise TypeError("key_inputs account_summary: summaries is not a list")
    summaries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in raw_summaries:
        if not isinstance(row, Mapping):
            raise TypeError("key_inputs account_summary: a summary is not an object")
        ccy = row["currency"]
        if not isinstance(ccy, str) or not ccy:
            raise TypeError("key_inputs account_summary: bad currency")
        if ccy in seen:
            raise ValueError("key_inputs account_summary: duplicate currency")
        seen.add(ccy)
        out: dict[str, Any] = {"currency": ccy}
        for key, value in row.items():
            if key == "currency":
                continue
            if key in _SUMMARY_STR_FIELDS:
                if not isinstance(value, str):
                    raise TypeError(f"key_inputs account_summary: {key} is not a string")
                out[key] = value
            elif key in _SUMMARY_BOOL_FIELDS:
                if not isinstance(value, bool):
                    raise TypeError(f"key_inputs account_summary: {key} is not a boolean")
                out[key] = value
            else:
                out[key] = _strict_finite_number(value, key)
        summaries.append(out)
    raw_index = raw.get("index_usd")
    if not isinstance(raw_index, Mapping):
        raise TypeError("key_inputs account_summary: index_usd is not an object")
    index_usd = {str(k): _strict_finite_number(v, "index") for k, v in raw_index.items()}
    raw_identity = raw.get("identity")
    if not isinstance(raw_identity, Mapping):
        raise TypeError("key_inputs account_summary: identity is not an object")
    identity: dict[str, dict[str, Any]] = {}
    for ccy, verdict in raw_identity.items():
        if not isinstance(verdict, Mapping):
            raise TypeError("key_inputs account_summary: a verdict is not an object")
        ok = verdict["identity_ok"]
        if ok is not None and not isinstance(ok, bool):
            raise TypeError("key_inputs account_summary: identity_ok is not a boolean")
        ratio = verdict["identity_resid_ratio"]
        for flag in ("options_session_upl_nonzero", "has_open_options"):
            if not isinstance(verdict[flag], bool):
                raise TypeError(f"key_inputs account_summary: {flag} is not a boolean")
        identity[str(ccy)] = {
            "identity_ok": ok,
            "identity_resid_ratio": (
                None if ratio is None else _strict_finite_number(ratio, "ratio")
            ),
            "options_session_upl_nonzero": verdict["options_session_upl_nonzero"],
            "has_open_options": verdict["has_open_options"],
        }
    return {
        "read_at": read_at,
        "summaries": summaries,
        "index_usd": index_usd,
        "identity": identity,
    }


_LEDGER_DIGEST_KEYS: frozenset[str] = frozenset({"row_count", "max_timestamp_ms", "sha256"})
_SHA256_HEX = re.compile(r"[0-9a-f]{64}")


def _validated_ledger_digest(raw: Any) -> dict[str, Any]:
    """Strictly validate a digest object: exactly ``row_count`` (non-negative int),
    ``max_timestamp_ms`` (int or null) and ``sha256`` (64 lowercase hex). Booleans are not
    integers here. Raises ``TypeError``/``ValueError``."""
    if not isinstance(raw, Mapping):
        raise TypeError("key_inputs ledger_digest: not an object")
    if set(raw) != _LEDGER_DIGEST_KEYS:
        raise ValueError("key_inputs ledger_digest: unexpected key set")
    count = raw["row_count"]
    if isinstance(count, bool) or not isinstance(count, int):
        raise TypeError("key_inputs ledger_digest: row_count is not an integer")
    if count < 0:
        raise ValueError("key_inputs ledger_digest: negative row_count")
    max_ts = raw["max_timestamp_ms"]
    if max_ts is not None and (isinstance(max_ts, bool) or not isinstance(max_ts, int)):
        raise TypeError("key_inputs ledger_digest: max_timestamp_ms is not an integer")
    digest = raw["sha256"]
    if not isinstance(digest, str):
        raise TypeError("key_inputs ledger_digest: sha256 is not a string")
    if _SHA256_HEX.fullmatch(digest) is None:
        raise ValueError("key_inputs ledger_digest: sha256 is not 64 lowercase hex")
    return {"row_count": count, "max_timestamp_ms": max_ts, "sha256": digest}


def ledger_digest_payload(digest: Mapping[str, Any]) -> dict[str, Any]:
    """The ``key_inputs`` field ``ledger_digest`` (DERIBITWEDGE PR-1, D-03): the row count,
    max timestamp and sha256 of the transaction-log rows the derive crawled. It holds no raw
    row value. A malformed digest is refused before the upsert, like the neighbouring writers."""
    return {"ledger_digest": _validated_ledger_digest(digest)}


def read_ledger_digest(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    """The stored ``ledger_digest``; ``None`` for a row that predates it (absent or null) or
    that recorded ``ledger_digest_error`` instead. A present but malformed one raises
    ``TypeError``/``ValueError`` so the job disposes it as a corrupt input."""
    raw = payload.get("ledger_digest")
    if raw is None:
        return None
    return _validated_ledger_digest(raw)


# --- 167.1.2.2.1 (DERIBITWEDGE PR-1): the native inception diagnostics ------------------------
_INCEPTION_DIAG_KEYS: frozenset[str] = frozenset(
    {
        "cap_usd", "currencies", "prev0_usd_current", "prev0_usd_balance_anchor",
        "first_nav_usd_current", "breach_ratio_current", "breach_ratio_current_with_cap",
        "breach_ratio_balance_anchor", "breach_ratio_balance_anchor_with_cap",
        "orphan_unvaluable",
    }
)
_INCEPTION_DIAG_NULLABLE_TOP: frozenset[str] = frozenset(
    {
        "prev0_usd_current", "prev0_usd_balance_anchor", "first_nav_usd_current",
        "breach_ratio_current", "breach_ratio_current_with_cap",
        "breach_ratio_balance_anchor", "breach_ratio_balance_anchor_with_cap",
    }
)
_INCEPTION_ROW_KEYS: frozenset[str] = frozenset(
    {
        "currency", "resid_native_current", "resid_native_balance_anchor", "mark0_usd",
        "throughput_native", "dust_rel_current", "dust_rel_balance_anchor",
    }
)
_INCEPTION_ROW_NULLABLE: frozenset[str] = frozenset(
    {"resid_native_balance_anchor", "dust_rel_current", "dust_rel_balance_anchor"}
)


def _refuse_non_finite(value: Any) -> None:
    """Walk a diagnostics record and refuse any non-finite number (JSONB cannot hold NaN/inf,
    and a poison value would fail the upsert and loop the derive)."""
    if isinstance(value, float) and not math.isfinite(value):
        raise NavReconstructionError(
            "key_inputs native_inception_diagnostics: non-finite amount — refusing to persist it"
        )
    if isinstance(value, Mapping):
        for item in value.values():
            _refuse_non_finite(item)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _refuse_non_finite(item)


def _validated_inception_diagnostics(raw: Any) -> dict[str, Any]:
    """Strictly validate a diagnostics record: exactly the documented keys, every number a
    finite non-boolean, nulls only where a reading can be absent. Raises
    ``TypeError``/``ValueError`` and returns a plain-dict copy."""
    if not isinstance(raw, Mapping):
        raise TypeError("key_inputs native_inception_diagnostics: not an object")
    if set(raw) != _INCEPTION_DIAG_KEYS:
        raise ValueError("key_inputs native_inception_diagnostics: unexpected key set")
    out: dict[str, Any] = {}
    out["cap_usd"] = _strict_finite_number(raw["cap_usd"], "cap_usd")
    for key in sorted(_INCEPTION_DIAG_NULLABLE_TOP):
        value = raw[key]
        out[key] = None if value is None else _strict_finite_number(value, key)
    flag = raw["orphan_unvaluable"]
    if not isinstance(flag, bool):
        raise TypeError("key_inputs native_inception_diagnostics: orphan_unvaluable is not a boolean")
    out["orphan_unvaluable"] = flag
    rows = raw["currencies"]
    if not isinstance(rows, Sequence) or isinstance(rows, (str, bytes)):
        raise TypeError("key_inputs native_inception_diagnostics: currencies is not a list")
    out_rows: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, Mapping):
            raise TypeError("key_inputs native_inception_diagnostics: a currency is not an object")
        if set(row) != _INCEPTION_ROW_KEYS:
            raise ValueError("key_inputs native_inception_diagnostics: unexpected currency keys")
        ccy = row["currency"]
        if not isinstance(ccy, str) or not ccy:
            raise TypeError("key_inputs native_inception_diagnostics: bad currency")
        out_row: dict[str, Any] = {"currency": ccy}
        for key in sorted(_INCEPTION_ROW_KEYS - {"currency"}):
            value = row[key]
            if value is None:
                if key not in _INCEPTION_ROW_NULLABLE:
                    raise TypeError(f"key_inputs native_inception_diagnostics: {key} is null")
                out_row[key] = None
            else:
                out_row[key] = _strict_finite_number(value, key)
        out_rows.append(out_row)
    out["currencies"] = out_rows
    return out


def native_inception_diagnostics_payload(diag: Mapping[str, Any]) -> dict[str, Any]:
    """The ``key_inputs`` field ``native_inception_diagnostics`` (DERIBITWEDGE PR-1): the
    rolled pre-history residual per currency under today's wedge and a balance-anchored one,
    the inception-day mark, the native throughput, both day-0 capitals and four breach ratios.

    Refuses a non-finite value with ``NavReconstructionError`` before the upsert (an infinite
    breach is carried as null plus ``orphan_unvaluable``), and a malformed record with
    ``TypeError``/``ValueError``, like the neighbouring writers."""
    _refuse_non_finite(diag)
    return {"native_inception_diagnostics": _validated_inception_diagnostics(diag)}


def read_native_inception_diagnostics(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    """The stored ``native_inception_diagnostics``; ``None`` for a row that predates it
    (absent or null) or that recorded ``native_inception_diagnostics_error`` instead. A
    present but malformed one raises ``TypeError``/``ValueError`` so the job disposes it as a
    corrupt input."""
    raw = payload.get("native_inception_diagnostics")
    if raw is None:
        return None
    return _validated_inception_diagnostics(raw)


def stitch_dropped_day_pnl(
    returns_links: Sequence[pd.Series],
    pnl_links: Sequence[Mapping[str, float]],
) -> dict[str, float]:
    """The dropped-day P&L of a stitched shared account, by the SAME ownership rule
    ``stitch_shared_account`` applies to flows: each member owns the days from its own
    first return day up to, not including, the next member's; the last member owns
    every day from its own first day on; the FIRST member also keeps its days before
    its first return day (the funding day is one). ``links`` are ordered as for
    ``stitch_shared_account`` (first return day, the counted member last). A day is
    taken from one member only, so a newer key that crawls back over an older key's
    days does not count its P&L twice."""
    firsts = [min(str(d) for d in series.index) for series in returns_links]
    out: dict[str, float] = {}
    for index, pnl in enumerate(pnl_links):
        own_first = firsts[index]
        next_first = firsts[index + 1] if index + 1 < len(firsts) else None
        for day, amount in pnl.items():
            if next_first is not None and day >= next_first:
                continue
            if index > 0 and day < own_first:
                continue
            out[day] = out.get(day, 0.0) + float(amount)
    return out


def _dropped_pnl_by_day(
    dropped_day_pnl: Mapping[str, float] | None, returns_by_day: Mapping[str, float]
) -> tuple[dict[str, float], int]:
    """The usable dropped-day P&L, and how many entries were not usable.

    An entry on a day that has a return row is not used: the return already says
    what the day did, and a P&L added to it would count the day twice. Counted, not
    silent. A non-finite amount is refused like a non-finite flow (D-15)."""
    usable: dict[str, float] = {}
    ignored = 0
    for day, amount in (dropped_day_pnl or {}).items():
        value = float(amount)
        if not math.isfinite(value):
            raise NavReconstructionError(
                "allocator equity replay: non-finite dropped-day P&L — refusing a "
                "data-quality NaN/inf amount"
            )
        if str(day) in returns_by_day:
            ignored += 1
            continue
        usable[str(day)] = value
    return usable, ignored


def _opening_flow_run(fbd: Mapping[str, float], first_return_day: str) -> list[str]:
    """The consecutive calendar days of flows ending the day BEFORE
    ``first_return_day``, oldest first (empty when that day carries no flow).
    Adjacency is by calendar day, so a one-day gap ends the run (D-13)."""
    run: list[str] = []
    day = date.fromisoformat(first_return_day) - timedelta(days=1)
    while day.isoformat() in fbd:
        run.append(day.isoformat())
        day -= timedelta(days=1)
    run.reverse()
    return run


def _assert_forward_agreement(
    series: pd.Series,
    r: Mapping[str, float],
    fbd: Mapping[str, float],
    days: Sequence[str],
    pnl: Mapping[str, float] | None = None,
) -> None:
    """DQ-02 construction self-check (``nav_twr.reconcile_flow_residual`` spirit):
    every adjacent pair of rolled levels must satisfy the FORWARD identity
    ``equity_t = equity_{t-1} * (1 + r_t) + F_t + P_t`` inside the band (``P_t`` the
    stored P&L of a dropped day, D-15; 0 elsewhere). Reddens ONLY on
    a roll-vs-identity code divergence, at the step where it happens — never on an
    economically wrong anchor (which shifts every level together).
    Counts/day-indices only.

    D-12 (167.1.2.2): the check is PER STEP, from the STORED previous level. It
    used to recompute ``equity_t`` by replaying forward from ``equity_0``, which
    multiplies ``equity_0``'s rounding by ``equity_0 * prod(1 + r) / equity_t``.
    After strong growth with the gains withdrawn and then a near-total withdrawal
    that factor passed 1e7 on PROD data, and a correct roll was refused (an exact
    rational replay from the same ``equity_0`` missed by the same order). The band
    is unchanged."""
    vals = series.to_numpy(dtype=float)
    for t in range(1, len(days)):
        fwd = (
            float(vals[t - 1]) * (1.0 + r.get(days[t], 0.0))
            + fbd.get(days[t], 0.0)
            + (pnl or {}).get(days[t], 0.0)
        )
        tol = _SELF_CHECK_ABS + _SELF_CHECK_REL * abs(float(vals[t]))
        if abs(fwd - float(vals[t])) > tol:
            raise NavReconstructionError(
                "allocator equity replay: forward/backward self-check diverged at "
                f"day-index {t} of {len(days)} — a roll-loop-vs-identity code "
                "divergence"
            )


def allocator_equity_curve(
    per_key_equity: Mapping[str, KeyEquity],
    seams: Sequence[Seam] | None = None,
) -> AllocatorEquity:
    """Sum the anchored per-key $-equity curves over the UNION of their windows.

    A key with ``equity is None`` (no anchor) is DROPPED (never invented). The
    allocator curve spans the UNION of every surviving (anchored) key's day index;
    on each union day the portfolio $-equity is the SUM of each key's level that day.

    OWNERSHIP AT A ROTATION (Finding 1 — the discriminator is the seam list):
      * A key that is ROTATED OUT at a seam (it appears in some seam's
        ``prev_keys``) hands its capital to the NEXT block — ``build_allocator_ledger``
        already books that jump as an internal redeployment. So a rotated-out key
        STOPS contributing after its own last day: 0 thereafter, NEVER a stale
        carry-forward. Carrying it forward would DOUBLE-COUNT the redeployed capital
        (it would show as the prev key's level AND inside the next block).
      * A NON-rotated still-held key whose OWN window has ended keeps its last-known
        level CARRIED FORWARD (last-observation-carried-forward) — the WR-01 case: the
        allocator's live equity, which the ground-truth gate reconciles the terminal
        against, is the sum of every still-held key's last-known ``value_usd`` anchor,
        so the terminal MUST be ``Σ_{still-held k} anchor_k`` (rotated-out keys
        contribute 0 at the terminal), never a rolled-back intersection.

    The seam classification is taken from ``seams`` when supplied (pass the SAME list
    ``build_allocator_ledger`` consumed, for guaranteed curve/ledger agreement) or
    DERIVED internally from the anchored coverage windows otherwise — either way the
    ownership semantics match the ledger by construction. A key contributes 0 on
    union days BEFORE its own window opens (not yet held); interior absent days inside
    a key's own window carry the prior level.

    WR-01: the OLD implementation summed only over the INTERSECTION of the anchored
    indices, silently dropping non-overlapping tails with ``degraded=False``. Now,
    whenever any surviving key's window is a strict SUBSET of the union, the result is
    flagged ``degraded=True``. The degraded-path ``flags`` carry: ``window_truncated``
    (bool), ``n_tail_days_carried`` (benign non-rotated stale-mark days),
    ``rotated_out_keys`` (benign classified rotations), ``unclassified_truncation_keys``
    (MEDIUM-6 — a coverage-detected rotation the passed seams did NOT classify; a
    BLOCKING signal), and ``dropped_keys``. The closed ``degrade_reasons`` set +
    ``is_trustworthy`` (C3) classify these benign-vs-blocking so a consumer can honor
    them without re-reading the dict. Every key unanchored -> ``None`` + honest-empty."""
    anchored = {
        k: ke.equity for k, ke in per_key_equity.items() if ke.equity is not None
    }
    dropped = sorted(k for k, ke in per_key_equity.items() if ke.equity is None)

    if not anchored:
        return AllocatorEquity(
            None,
            {
                "honest_empty": True,
                "reason": REASON_NO_ANCHORED_KEYS,
                "dropped_keys": dropped,
            },
            frozenset({DegradeReason.NO_ANCHORED_KEYS}),
        )

    # Rotation ownership: derive the seam classification from the anchored coverage
    # windows when the caller does not supply it, so the curve agrees with
    # ``build_allocator_ledger`` on which keys are redeployed vs still held.
    explicit_seams = seams is not None
    if seams is None:
        seams = segment_coverage(dict(anchored)).seams
    rotated_out: set[str] = set()
    for seam in seams:
        rotated_out.update(seam.prev_keys or ())

    # MEDIUM-6: a caller-passed seam list computed over a DIFFERENT key set silently
    # double-counts — a genuinely-rotated key absent from ``rotated_out`` is carried
    # forward (ffill) and summed on the next block, flagged BYTE-IDENTICALLY to a
    # benign stale mark. Guard the passed-seams path:
    #   (a) every seam-referenced key must be in ``anchored`` (a stray key means the
    #       seams were computed over a different set) -> fail loud;
    #   (b) cross-check against the internally-derived rotation: a key the coverage
    #       says rotates out but the passed seams did NOT classify is an UNCLASSIFIED
    #       truncation -> a DISTINCT non-benign flag token (not the benign carry).
    unclassified: set[str] = set()
    if explicit_seams:
        seam_keys: set[str] = set()
        for seam in seams:
            seam_keys.update(seam.prev_keys or ())
            seam_keys.update(seam.next_keys or ())
        stray = seam_keys - set(anchored)
        if stray:
            raise NavReconstructionError(
                f"allocator_equity_curve: passed seam(s) reference {len(stray)} "
                "key(s) absent from the anchored set — seams computed over a "
                "different key set (refusing a silent double-count)"
            )
        internal_rotated: set[str] = set()
        for seam in segment_coverage(dict(anchored)).seams:
            internal_rotated.update(seam.prev_keys or ())
        unclassified = internal_rotated - rotated_out

    union_days = sorted({str(d) for s in anchored.values() for d in s.index})
    union_index = pd.Index(union_days)

    key_first: dict[str, str] = {}
    key_last: dict[str, str] = {}
    total = pd.Series(0.0, index=union_days, name="allocator_equity")
    for k, series in anchored.items():
        day_map = {str(d): float(v) for d, v in series.items()}
        days_sorted = sorted(day_map)
        key_first[k] = days_sorted[0]
        key_last[k] = days_sorted[-1]
        # Reindex onto the union, carrying the last-known level forward across any
        # interior gap. 0 before the key opens (not yet part of the portfolio).
        contrib = pd.Series(day_map).reindex(union_days).ffill()
        if k in rotated_out:
            # Rotated OUT: real level within its window, 0 after its last day (the
            # capital is redeployed into the next block — no stale carry-forward).
            contrib = contrib.where(union_index <= key_last[k], 0.0)
        contrib = contrib.where(union_index >= key_first[k], 0.0).fillna(0.0)
        total = total.add(contrib, fill_value=0.0)

    # Benign stale marks are non-rotated AND non-unclassified keys carried past their
    # own last day (an unclassified key's carry is the MEDIUM-6 double-count — kept
    # OUT of the benign count so the two flag tokens stay distinct).
    n_tail_days_carried = sum(
        1
        for day in union_days
        for k in anchored
        if k not in rotated_out and k not in unclassified and day > key_last[k]
    )
    window_truncated = any(
        key_first[k] != union_days[0] or key_last[k] != union_days[-1]
        for k in anchored
    )
    rotated_out_present = sorted(rotated_out & set(anchored))

    # C3: the CLOSED reason set — BENIGN (window-truncation, stale-mark carry,
    # classified rotation) vs BLOCKING (a dropped key, an unclassified rotation).
    # ``is_trustworthy`` = no blocking reason, so a normal multi-key allocator with a
    # benign window-truncation stays trustworthy (the LOW-7 gate fix).
    reasons: set[DegradeReason] = set()
    if dropped:
        reasons.add(DegradeReason.DROPPED_KEY)
    if window_truncated:
        reasons.add(DegradeReason.WINDOW_TRUNCATED)
    if n_tail_days_carried:
        reasons.add(DegradeReason.STALE_MARK_CARRY)
    if rotated_out_present:
        reasons.add(DegradeReason.CLASSIFIED_ROTATION)
    if unclassified:
        reasons.add(DegradeReason.UNCLASSIFIED_ROTATION)

    return AllocatorEquity(
        total,
        {
            "degraded": bool(dropped) or window_truncated or bool(unclassified),
            "dropped_keys": dropped,
            "window_truncated": window_truncated,
            "n_tail_days_carried": n_tail_days_carried,
            "rotated_out_keys": rotated_out_present,
            # MEDIUM-6: a DISTINCT non-benign token — keys the coverage says rotate
            # out but the passed seams did not classify (a potential double-count),
            # never conflated with the benign n_tail_days_carried stale-mark carry.
            "unclassified_truncation_keys": sorted(unclassified),
            "n_keys": len(anchored),
        },
        frozenset(reasons),
    )


# ── STITCH-05/06: the ONE unified cashflow ledger (real + synthetic seam) ─────
#
# Windowed stitching and cashflow accounting are ONE code path (the founder-locked
# STITCH contract). Real external flows AND the synthetic rotation-seam entries
# live in a SINGLE ordered, provenance-tagged ledger of ``ExternalFlow`` shape.
# That SAME ledger feeds both the $-replay (a seam is a $-step, not a return) and
# the Modified-Dietz / MWR scalar adapters — the KEPT ``portfolio_metrics``
# cashflow surface (which the unified backbone cannot reproduce) gets its FIRST
# production caller here. Per RESEARCH Open Question 3, the scalars are computed +
# tested but NOT display-wired this phase (thread-only STITCH-05 scope); the
# Phase 115.1 worker-side derivation is the consumer that surfaces them.
#
# L1 pin: seam synthetic flows apply ONLY at genuine rotation boundaries (the
# ``segment_coverage`` Seam list — disjoint covering sets). A concurrent-blend day
# NEVER receives a seam flow; it composes via the capital-weighted blend.

LEDGER_REAL = "real"
LEDGER_SEAM = "seam"


@dataclass(frozen=True)
class LedgerScalars:
    """The two KEPT ``portfolio_metrics`` scalars threaded from the unified ledger
    (C4). ``computable`` is False ONLY on the fail-loud unknown-magnitude ledger (a
    ``known=False`` seam) — this is DISTINCT from an ordinarily-uncomputable
    individual scalar (``mwr`` / ``dietz`` may still be ``None`` when the IRR / Dietz
    solve degenerates even though ``computable`` is True). Replaces the transposable
    ``(mwr, dietz)`` tuple that aliased the fail-loud path with the uncomputable one."""

    mwr: float | None
    dietz: float | None
    computable: bool


@dataclass(frozen=True)
class LedgerEntry:
    """One dated entry in the unified allocator cashflow ledger.

    ``flow`` is the ``ExternalFlow`` (deposit +, withdrawal −; a synthetic seam
    step carries the boundary equity jump). ``provenance`` is ``LEDGER_REAL`` for
    a genuine external flow or ``LEDGER_SEAM`` for a rotation-boundary synthetic
    entry. ``known`` is ``False`` ONLY for a seam whose magnitude is unknowable
    because a boundary segment is unanchored — the scalar adapters then fail loud
    (never a fabricated number) and the flow's ``usd_signed`` is ``nan``."""

    flow: ExternalFlow
    provenance: str
    known: bool = True


def build_allocator_ledger(
    real_flows_by_key: Mapping[str, Sequence[Any]],
    seams: Sequence[Seam],
    per_key_equity: Mapping[str, KeyEquity],
    returns_by_key: Mapping[str, pd.Series] | None = None,
) -> list[LedgerEntry]:
    """Build the ONE ordered, provenance-tagged allocator cashflow ledger.

    Real external flows (per key) enter tagged ``LEDGER_REAL``. Each rotation
    ``Seam`` becomes ONE synthetic ``LEDGER_SEAM`` entry dated on the next segment's
    first day, carrying the boundary equity JUMP — a deposit if capital grew across
    the handoff, a withdrawal if it shrank (STITCH-06).

    SEAM MAGNITUDE (Finding 3 — the module's own forward identity):
    ``next_eq`` is the next block's END-of-first-day level, so it ALREADY contains
    that day's return ``r_next`` on the redeployed capital. The convention-consistent
    synthetic flow is therefore ``F = next_eq − prev_eq·(1 + r_next)`` — the module
    identity ``equity_t = equity_{t-1}·(1 + r_t) + F_t`` solved for ``F`` at the seam.
    The naive ``next_eq − prev_eq`` folded ``prev_eq·r_next`` of first-day P&L on the
    redeployed capital INTO the flow, dropping it from performance (Dietz numerator).
    ``r_next`` is the next block's first-day return, capital-weighted across a
    multi-key incoming block (``_seam_next_first_return``); it needs
    ``returns_by_key`` (the per-key daily-return series). When a boundary segment is
    unanchored OR the next-side return is unavailable (no ``returns_by_key``) the
    magnitude is UNKNOWN: the entry is flagged ``known=False`` (``nan``) so the scalar
    adapters fail loud rather than fabricate a jump.

    Entries are sorted ascending by UTC day. This is the SINGLE construction site for
    the ledger — both the $-replay and the Dietz/MWR adapters read the returned list."""
    entries: list[LedgerEntry] = []

    for key in sorted(real_flows_by_key):
        for flow in real_flows_by_key[key]:
            entries.append(_ledger_entry(str(flow[0]), float(flow[1]), LEDGER_REAL))

    for seam in seams:
        # WR-04: resolve boundary equity by SUMMING the constituent keys' levels
        # (``seam.prev_keys`` / ``seam.next_keys``), NEVER the '+'-joined scalar
        # label. A single-key rotation is the 1-member sum; a concurrent-block
        # rotation now resolves.
        prev_eq = _boundary_equity_block(
            per_key_equity, seam.prev_keys, seam.prev_last_day
        )
        next_eq = _boundary_equity_block(
            per_key_equity, seam.next_keys, seam.next_first_day
        )
        r_next = _seam_next_first_return(
            returns_by_key, per_key_equity, seam, real_flows_by_key
        )
        if prev_eq is None or next_eq is None or r_next is None:
            # Magnitude unknown (an unanchored boundary or a missing next-side
            # return) — flag, never fabricate. usd_signed is nan; scalars refuse.
            entries.append(
                _ledger_entry(
                    seam.next_first_day, float("nan"), LEDGER_SEAM, known=False
                )
            )
        else:
            # Finding 3: forward-identity flow — strip the redeployed capital's
            # first-day return out of the synthetic flow (it is performance, not
            # cash movement).
            # F1 (Fable): ``next_eq`` ALREADY contains any REAL external flow dated the
            # seam day into a next-block member (each next key's replayed first-day
            # equity folds its own same-day flow in), and those flows are booked ONCE
            # as LEDGER_REAL above. Subtract them from the residual so the seam carries
            # ONLY the non-return, non-real-flow redeployment magnitude — never
            # double-booking a seam-day real deposit/withdrawal.
            seam_day_real = sum(
                float(flow[1])
                for k in seam.next_keys
                for flow in real_flows_by_key.get(k, [])
                if str(flow[0]) == seam.next_first_day
            )
            seam_usd = next_eq - prev_eq * (1.0 + r_next) - seam_day_real
            entries.append(
                _ledger_entry(seam.next_first_day, seam_usd, LEDGER_SEAM, known=True)
            )

    entries.sort(key=lambda e: e.flow.utc_day_iso)
    return entries


def _seam_next_first_return(
    returns_by_key: Mapping[str, pd.Series] | None,
    per_key_equity: Mapping[str, KeyEquity],
    seam: Seam,
    real_flows_by_key: Mapping[str, Sequence[Any]] | None = None,
) -> float | None:
    """The incoming (NEXT) block's first-day return on the seam day, weighted by each
    member's START capital (Finding 3). For a single-key rotation this is just that
    key's return on ``next_first_day``. Returns ``None`` if ``returns_by_key`` is absent
    or any next-side return / equity is missing (the seam magnitude is then unknown —
    never fabricated).

    F2 (Fable): the redeployed capital earns the START-capital-weighted return
    ``Σ sᵢ·rᵢ / Σ sᵢ``. G1 (Fable, F1+F2 composition): the member's END-of-day equity
    ``eqᵢ`` ALREADY contains any seam-day REAL flow ``fᵢ`` into it (the replay identity
    ``equity_t = equity_{t-1}(1+r)+F``), so the true start capital is
    ``sᵢ = (eqᵢ − fᵢ)/(1+rᵢ)`` — NOT ``eqᵢ/(1+rᵢ)``, which over-recovers by
    ``fᵢ/(1+rᵢ)`` and tilts the weight toward the flow-receiving member. Weighting by
    the end-of-day ``eqᵢ`` (or an un-stripped start capital) biases toward the winner
    and books a spurious synthetic flow on a pure (zero-cash) rotation. The
    ``1+rᵢ > 0`` denominator is guaranteed for an anchored key (replay refuses a
    ≤−100% day)."""
    if not returns_by_key:
        return None
    total_start = 0.0
    weighted = 0.0
    for n in seam.next_keys:
        eq = _boundary_equity(per_key_equity, n, seam.next_first_day)
        rser = returns_by_key.get(n)
        if eq is None or rser is None:
            return None
        rmap = {str(day): float(val) for day, val in rser.items()}
        r = rmap.get(str(seam.next_first_day))
        if r is None or (1.0 + r) <= 0.0:
            return None
        # G1: strip the member's seam-day real flow out of the END equity BEFORE
        # recovering start capital (``eqᵢ`` already folded it in).
        f_i = sum(
            float(flow[1])
            for flow in (real_flows_by_key or {}).get(n, [])
            if str(flow[0]) == seam.next_first_day
        )
        start_capital = (eq - f_i) / (1.0 + r)
        total_start += start_capital
        weighted += start_capital * r
    if total_start == 0.0:
        return None
    return weighted / total_start


def _ledger_entry(
    day: str, usd_signed: float, provenance: str, *, known: bool = True
) -> LedgerEntry:
    """The SOLE ledger-entry construction site (one-ledger invariant — the
    STITCH-05 grep pin asserts a single construction of the entry in the
    module; every real/seam entry funnels through here)."""
    # G2 (Fable): the LedgerEntry contract is ``nan usd_signed ⇔ known=False``. Enforce
    # it here (the sole construction site) so a non-finite magnitude on the known=True
    # path — e.g. a nan seam-day real flow summed into the seam residual — fails loud
    # into C4's fail-loud channel instead of laundering as ``computable=True,
    # dietz=None``. The known=False path legitimately carries ``nan`` (unknown seam).
    if known and not math.isfinite(float(usd_signed)):
        raise NavReconstructionError(
            "allocator ledger entry: non-finite usd_signed on a known=True entry — "
            "refusing a data-quality NaN/inf magnitude (contract: nan ⇔ known=False)"
        )
    return LedgerEntry(ExternalFlow(day, usd_signed), provenance, known)


def _boundary_equity_block(
    per_key_equity: Mapping[str, KeyEquity], keys: tuple[str, ...], day: str
) -> float | None:
    """The summed boundary $-equity of a (possibly multi-key) segment on ``day``:
    ``Σ_k _boundary_equity(k, day)`` over the segment's constituent ``keys`` (WR-04).

    A single-key rotation is the 1-member sum. A concurrent-block rotation sums the
    block members' levels — the keys live at that boundary. Returns ``None`` if ANY
    member is unanchored / absent that day (the WHOLE boundary magnitude is unknown;
    never a partial sum) or if ``keys`` is empty (no resolvable block)."""
    if not keys:
        return None
    total = 0.0
    for k in keys:
        lvl = _boundary_equity(per_key_equity, k, day)
        if lvl is None:
            return None
        total += lvl
    return total


def _boundary_equity(
    per_key_equity: Mapping[str, KeyEquity], key: str, day: str
) -> float | None:
    """The anchored $-equity of ``key`` on ``day``, or ``None`` when that key is
    unanchored (no $-series) or the day is absent — the caller flags the seam
    magnitude-unknown rather than inventing a boundary level."""
    ke = per_key_equity.get(key)
    if ke is None or ke.equity is None:
        return None
    series = ke.equity
    day = str(day)
    if day in {str(d) for d in series.index}:
        return float(series[day])
    return None


def mwr_and_dietz_from_ledger(
    ledger: Sequence[LedgerEntry],
    *,
    begin_value: float,
    end_value: float,
    period_start: str,
    period_days: int,
) -> LedgerScalars:
    """Thread the unified ledger through the KEPT ``portfolio_metrics`` scalars
    (STITCH-05) — the first production caller of ``compute_mwr`` /
    ``compute_modified_dietz``.

    Fails loud on an unknown-magnitude ledger: ANY ``known=False`` seam entry ->
    ``LedgerScalars(None, None, computable=False)`` (never a fabricated scalar; C4
    keeps this DISTINCT from an ordinarily-uncomputable scalar). Otherwise the
    adapter converts
    each ``ExternalFlow`` entry into the two dict shapes the KEPT helpers expect:

      * MWR (annualised IRR, investor perspective): a portfolio deposit is an
        investment OUT of the investor's pocket, so the sign FLIPS
        (``amount = −usd_signed``); the ``begin_value`` is prepended as the
        initial investment at ``period_start`` and ``end_value`` is the terminal
        inflow. WR-03: ONLY ``LEDGER_REAL`` (real-external) flows enter the
        IRR — a ``LEDGER_SEAM`` entry is the SAME capital redeployed from one key to
        the next (internal), NOT money entering/leaving the investor's pocket, and
        its magnitude is largely independent-anchor reconciliation noise; injecting
        it as an investor cash flow corrupts the IRR. Rotation seams are EXCLUDED.
      * Modified Dietz (portfolio perspective): ``amount = usd_signed`` directly
        (deposit +, withdrawal −, matching ``ExternalFlow``); ``day`` is the
        0-based offset from ``period_start``. Seam entries ARE kept here (both
        provenances): Modified-Dietz subtracts ΣF from the return NUMERATOR, so
        including the boundary jump REMOVES it from performance (the same reason
        TWR stays clean across a rotation) — the portfolio-perspective return is not
        credited/debited for an internal redeployment. This asymmetry with MWR is
        intentional: Dietz is portfolio-return-clean, MWR is investor-action-clean.

    Thread-only: the returned scalars are NOT display-wired this phase."""
    if any(not e.known for e in ledger):
        return LedgerScalars(None, None, computable=False)

    start = date.fromisoformat(str(period_start))
    end_date = (start + timedelta(days=int(period_days))).isoformat()

    # MEDIUM-4: an entry dated OUTSIDE [period_start, period_start + period_days] is a
    # CONSTRUCTION bug (a mis-dated seam/flow). ``compute_modified_dietz`` would
    # SILENTLY clamp the day offset (M-0695) — a pre-period entry launders to a
    # full-weight t=0 flow, a post-period entry to a zero-weight one — quietly
    # re-weighting the return. Fail loud instead (extending the known=False
    # fail-loud discipline). Bounds carry day-offset counts only (no USD).
    for e in ledger:
        offset = (date.fromisoformat(e.flow.utc_day_iso) - start).days
        if offset < 0 or offset > int(period_days):
            raise NavReconstructionError(
                f"allocator ledger entry dated {offset} day(s) from period_start is "
                f"outside [0, {int(period_days)}] — a mis-dated seam/flow (refusing "
                "the silent Modified-Dietz day clamp)"
            )

    # WR-03: MWR (investor IRR) sees ONLY real-external flows; synthetic rotation
    # seams are internal capital redeployment, never an investor action.
    mwr_flows: list[dict[str, Any]] = [
        {"date": period_start, "amount": -float(begin_value)}
    ]
    mwr_flows += [
        {"date": e.flow.utc_day_iso, "amount": -float(e.flow.usd_signed)}
        for e in ledger
        if e.provenance != LEDGER_SEAM
    ]
    # Finding 2: append the terminal value EXPLICITLY rather than relying on
    # compute_mwr's ``final_value>0 AND net_cf<0`` heuristic — for a
    # withdrawal-heavy ledger (net cash flow >= 0) that heuristic SILENTLY omits the
    # terminal and the IRR ignores ending wealth (identical MWR for every
    # end_value). Passing ``final_value=0.0`` makes the helper's own conditional
    # append a no-op, so the terminal is present exactly once.
    mwr_flows.append({"date": end_date, "amount": float(end_value)})
    mwr = compute_mwr(mwr_flows, final_value=0.0, end_date=end_date)

    dietz_flows: list[dict[str, Any]] = [
        {
            "amount": float(e.flow.usd_signed),
            "day": (date.fromisoformat(e.flow.utc_day_iso) - start).days,
        }
        for e in ledger
    ]
    dietz = compute_modified_dietz(
        float(begin_value), float(end_value), dietz_flows, int(period_days)
    )
    return LedgerScalars(mwr, dietz, computable=True)
