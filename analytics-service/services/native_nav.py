"""Pure, I/O-free per-currency native-unit NAV reconstruction primitives.

Phase 79 (v1.9 Native-Unit NAV Reconstruction) foundation. This module owns the
per-currency mark classifier and the two structural refuse errors the native core
(Phase 79-02) will consume. The core itself — ``NativeLedger``,
``reconstruct_native_nav_and_twr``, the inception tolerances — lands in 79-02;
this wave ships ONLY the shared types so the core is written once, complete.

Purity: stdlib + pandas + numpy + in-repo discipline only (mirrors
``services/nav_twr.py`` :1-36). No network, no DB, **no logging of raw
NAV/balance/flow/quantity values** — the account-size-leak class T-73-02 /
T-76-03-LEAK (see the raise-message discipline in
``nav_twr.reconcile_flow_residual``, :443-444). Every exception raised here
carries CODES / COUNTS / RELATIVE ratios only, never a raw amount held.

The classifier reuses the ONE shared ``USD_FAMILY`` frozenset
(``services.external_flows``) so it can never drift from the Deribit linear set
(``deribit_txn._LINEAR_CURRENCIES`` aliases the same object).
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping, Sequence
from collections.abc import Set as AbstractSet
from dataclasses import dataclass, field
from enum import Enum

import numpy as np
import pandas as pd

from services.deribit_txn import _row_utc_day
from services.external_flows import USD_FAMILY, ExternalFlow
from services.nav_twr import (
    NavReconstructionError,
    NavTWRMeta,
    _build_nav_meta,
    _coerce_float,
    _union_flow_days,
    chain_linked_twr,
    cumulative_twr_segmented,
    reconstruct_nav,
)


class MarkBranch(str, Enum):
    """The three — and ONLY three — per-currency mark branches (§3.1). There is
    no account-level branch anywhere: every currency is classified independently.
    """

    USD_FAMILY = "usd_family"   # mark ≡ 1.0 (already USD)
    INDEXED = "indexed"         # mark = that day's {ccy}_usd index
    UNMARKABLE = "unmarkable"   # refuse if it carries any value


def classify_currency(
    ccy: str,
    *,
    indexable: AbstractSet[str],
    usd_family: AbstractSet[str] = USD_FAMILY,
) -> MarkBranch:
    """Classify a settlement currency into its mark branch (§3.1).

    Uppercases ``ccy`` first, then ``usd_family`` wins FIRST — mirroring "both
    converters check linear FIRST", the disjointness rationale at
    ``deribit_txn.py:104-110`` — then ``indexable``, else ``UNMARKABLE``.

    PURE and never raises: a junk / unknown currency simply classifies
    ``UNMARKABLE`` (refusal is value-gated in the core, not classification-gated).
    The ``usd_family ∩ indexable == ∅`` invariant is checked SEPARATELY by
    :func:`_assert_families_disjoint` at classification time (G1) — never per call
    here, so both contract sentences ("never raises" §3.1 / "overlap raises"
    §3.2) hold.
    """
    code = ccy.upper()
    if code in usd_family:
        return MarkBranch.USD_FAMILY
    if code in indexable:
        return MarkBranch.INDEXED
    return MarkBranch.UNMARKABLE


def _assert_families_disjoint(
    usd_family: AbstractSet[str], indexable: AbstractSet[str]
) -> None:
    """Raise ``NavReconstructionError`` if the USD-family and indexable sets
    overlap (§3.2, G1).

    The ``indexable`` set is DYNAMIC (probe-resolved per job, §3.3) so the static
    import-time assert in ``deribit_txn.py:108-110`` no longer covers it — this is
    that assert's dynamic-set counterpart, called once at the top of the 79-02
    core's classification step. An overlapping currency would classify
    ``USD_FAMILY`` (checked first) and silently skip its index multiply, the exact
    silent mis-scaling the static disjointness guard fights. The message names the
    overlapping currency CODES only (leak-safe — codes, never balances/amounts).
    """
    overlap = usd_family & indexable
    if overlap:
        codes = ", ".join(sorted(overlap))
        raise NavReconstructionError(
            f"native_nav USD_FAMILY and indexable currencies must be disjoint; "
            f"overlap: {codes}"
        )


class UnmarkableCurrencyError(NavReconstructionError):
    """A currency carrying nonzero value has no resolvable ``{ccy}_usd`` mark —
    either UNMARKABLE by classification (no index exists: BUIDL, USYC) or INDEXED
    but with a missing/invalid mark on a needed day (§3.4).

    Value-gated: a zero-everywhere UNMARKABLE currency is skipped SILENTLY (the
    ``deribit_txn.py:282-283`` ``if equity == 0.0: continue`` precedent); this
    error fires only once such a currency carries nonzero value on any day.

    Attributes are ALL leak-safe — NO raw balances/quantities/USD (§3.4,
    nav_twr.py:443-444 discipline). ``missing_day_count`` is a COUNT, never the
    values held on those days.
    """

    def __init__(
        self,
        *,
        currency: str,
        venue: str,
        reason: str,
        missing_day_count: int,
    ) -> None:
        self.currency = currency
        self.venue = venue
        self.reason = reason  # "no_usd_index" | "missing_daily_marks" | "flow_quantity_missing"
        self.missing_day_count = missing_day_count
        super().__init__(
            f"native_nav unmarkable currency={currency} venue={venue} "
            f"reason={reason} missing_day_count={missing_day_count}"
        )


class InceptionReconciliationError(NavReconstructionError):
    """Full-history native roll does not reconcile to a ~zero pre-history balance
    (§5.3): the venue-reported terminal equity and the summed ledger disagree
    (missing rows, a mis-classified type, a wrong scope).

    Carries CODES + venue + the RELATIVE breach ratio (Σ resid_usd / tolerance)
    ONLY — NEVER raw residual quantities or USD (leak discipline,
    nav_twr.py:443-444).
    """

    def __init__(
        self,
        *,
        currencies: list[str],
        venue: str,
        breach_ratio: float,
    ) -> None:
        self.currencies = currencies
        self.venue = venue
        self.breach_ratio = breach_ratio  # relative: Σ resid_usd / tolerance
        codes = ", ".join(currencies)
        super().__init__(
            f"native_nav inception reconciliation breached venue={venue} "
            f"currencies=[{codes}] breach_ratio={breach_ratio:.3g}"
        )


# ===========================================================================
# The native-unit NAV+TWR core (contract §1.2/§1.3, §4, §8) — Phase 79-02.
# ===========================================================================

_USD_BUCKET = "USD"  # the coalesced branch-1 bucket key (§4.1, mark ≡ 1.0)


@dataclass(frozen=True)
class NativeLedger:
    """Everything a venue adapter must supply to the pure core (contract §1.2).
    Pure data; no I/O objects.

    Currency keys are UPPERCASE everywhere (matching the ``.upper()`` convention
    at ``deribit_txn.py:180/209/493/559``).

    Fields:
      * ``native_pnl`` — per-currency daily NATIVE pnl (Σ of the ledger ``change``
        per UTC day, in the currency's OWN units, NO index conversion). Each
        Series is float-dtype on a tz-naive midnight ascending DatetimeIndex, one
        row per UTC day that had cash-bearing activity in that currency.
      * ``terminal_native_equity`` — per-currency NATIVE equity at the anchor
        instant (Deribit: ``equity`` per summary, kept NATIVE, never
        pre-multiplied).
      * ``marks`` — per-currency daily USD mark ``P_c(d)`` (float Series, tz-naive
        midnight index). REQUIRED for every branch-2 currency on every day the
        reconstruction values (§3.3 density). Branch-1 (USD-family) currencies
        MUST NOT appear here — their mark is the literal ``1.0`` (§4).
      * ``native_flows`` — dated external flows in NATIVE units (§2); the core
        reads ONLY ``(utc_day_iso, currency, quantity)`` and re-values at its own
        day marks (never a producer-side ``usd_signed``, §2.2).
      * ``terminal_upnl_native`` — terminal open-uPnL wedge, NATIVE per currency
        (empty mapping = zero wedge).
      * ``full_history`` — ``True`` ⇒ the ledger covers the account's FULL history
        and the §5 inception gate reconciles against an expected pre-history
        balance of 0 per currency; ``False`` ⇒ a retention-capped venue → the
        inception gate SKIPS entirely (§5.3).
    """

    native_pnl: Mapping[str, pd.Series]
    terminal_native_equity: Mapping[str, float]
    marks: Mapping[str, pd.Series]
    native_flows: Sequence[ExternalFlow]
    terminal_upnl_native: Mapping[str, float]
    full_history: bool


@dataclass
class _Bucket:
    """One reconstruction bucket — either the coalesced ``"USD"`` bucket
    (``branch == USD_FAMILY``, ``mark is None`` ⇒ literal 1.0) or a single
    INDEXED coin. Mutable so the roll (step 2) can attach the rolled balance."""

    code: str
    branch: MarkBranch
    pnl: pd.Series               # native pnl (pre-union; may be empty)
    terminal_native: float
    upnl_native: float
    flow_qty: pd.Series          # native flow qty per day, summed (may be empty)
    mark: pd.Series | None       # None ⇒ literal 1.0 (USD bucket)
    balance: pd.Series = field(
        default_factory=lambda: pd.Series(dtype=float, name="nav")
    )
    pnl_unioned: pd.Series = field(
        default_factory=lambda: pd.Series(dtype=float, name="daily_pnl")
    )


def _code_carries_value(code: str, ledger: NativeLedger) -> bool:
    """True iff ``code`` carries any NONZERO pnl / terminal equity / uPnL / flow
    — the value-gate that decides whether an UNMARKABLE currency is skipped
    silently (§3.1, the ``deribit_txn.py:282-283`` precedent) or refuses loudly
    (§3.4). Exact ``!= 0.0`` — a dust nonzero still refuses (never a silent zero
    for real value)."""
    s = ledger.native_pnl.get(code)
    if s is not None and len(s) and bool((s.to_numpy(dtype=float) != 0.0).any()):
        return True
    if float(ledger.terminal_native_equity.get(code, 0.0)) != 0.0:
        return True
    if float(ledger.terminal_upnl_native.get(code, 0.0)) != 0.0:
        return True
    for f in ledger.native_flows:
        if f.currency == code:
            if float(f.usd_signed) != 0.0:
                return True
            if f.quantity is not None and float(f.quantity) != 0.0:
                return True
    return False


def _native_qty_by_day(pairs: list[tuple[str, float]]) -> pd.Series:
    """Sum signed native flow quantity per UTC calendar day — the native-unit
    sibling of ``nav_twr._flows_to_daily_usd`` (same ``_row_utc_day`` boundary +
    ``_coerce_float`` fail-loud, so a native flow cannot drift onto the wrong day
    or sail past as a silent NaN). Empty input ⇒ empty float Series."""
    if not pairs:
        return pd.Series(dtype=float, name="flow_qty")
    sums: dict[str, float] = defaultdict(float)
    for i, (day_raw, qty) in enumerate(pairs):
        day = _row_utc_day(day_raw)
        sums[day] += _coerce_float(
            qty, field="flow_quantity", row={"index": i, "day": day}
        )
    ordered = sorted(sums)
    index = pd.DatetimeIndex([pd.Timestamp(d) for d in ordered])
    return pd.Series([sums[d] for d in ordered], index=index, name="flow_qty")


def _coalesce_usd_pnl(codes: list[str], ledger: NativeLedger) -> pd.Series:
    """Sum the branch-1 currencies' native pnl per day in PRODUCER ROW ORDER
    (op A of §4.1 — NO re-association beyond the order the inputs arrive in). A
    single USD-family currency folds to a copy of its own Series (byte-identical,
    the SC-4 base case); multiple fold left-to-right via ``add(fill_value=0.0)``."""
    acc: pd.Series | None = None
    for code in codes:
        s = ledger.native_pnl.get(code)
        if s is None or len(s) == 0:
            continue
        s = s.astype(float)
        acc = s.copy() if acc is None else acc.add(s, fill_value=0.0)
    return acc if acc is not None else pd.Series(dtype=float, name="native_pnl")


def _bucket_flow_qty(
    code_set: frozenset[str],
    ledger: NativeLedger,
    *,
    branch: MarkBranch,
    venue: str,
) -> pd.Series:
    """Native flow-qty Series for a bucket, applying the G4 quantity rules:
    branch-1 ``quantity=None`` uses ``usd_signed`` verbatim (the branch-1 identity
    ``quantity == usd_signed``, mark ≡ 1.0 — never back-solving); branch-2
    ``quantity=None`` refuses ``flow_quantity_missing``."""
    pairs: list[tuple[str, float]] = []
    for f in ledger.native_flows:
        if f.currency not in code_set:
            continue
        if branch is MarkBranch.USD_FAMILY:
            qty = f.usd_signed if f.quantity is None else f.quantity
        else:  # INDEXED
            if f.quantity is None:
                raise UnmarkableCurrencyError(
                    currency=f.currency, venue=venue,
                    reason="flow_quantity_missing", missing_day_count=0,
                )
            qty = f.quantity
        pairs.append((f.utc_day_iso, float(qty)))
    return _native_qty_by_day(pairs)


def _build_buckets(
    ledger: NativeLedger, indexable: AbstractSet[str], venue: str
) -> list[_Bucket]:
    """Step 1 (§1.3): classify every currency, value-gate UNMARKABLE ones, and
    coalesce branch-1 into the single ``"USD"`` bucket (§4.1)."""
    # Ordered union of every currency key across all four input surfaces.
    codes: list[str] = []
    seen: set[str] = set()
    for source in (
        ledger.native_pnl,
        ledger.terminal_native_equity,
        ledger.terminal_upnl_native,
    ):
        for c in source:
            if c not in seen:
                seen.add(c)
                codes.append(c)
    for f in ledger.native_flows:
        if f.currency not in seen:
            seen.add(f.currency)
            codes.append(f.currency)

    usd_codes: list[str] = []
    indexed_codes: list[str] = []
    for code in codes:
        branch = classify_currency(code, indexable=indexable)
        if branch is MarkBranch.USD_FAMILY:
            usd_codes.append(code)
        elif branch is MarkBranch.INDEXED:
            indexed_codes.append(code)
        else:  # UNMARKABLE — value-gated (§3.1/§3.4)
            if _code_carries_value(code, ledger):
                raise UnmarkableCurrencyError(
                    currency=code, venue=venue,
                    reason="no_usd_index", missing_day_count=0,
                )
            # zero-everywhere UNMARKABLE ⇒ skipped silently.

    buckets: list[_Bucket] = []
    if usd_codes:
        usd_set = frozenset(usd_codes)
        buckets.append(
            _Bucket(
                code=_USD_BUCKET,
                branch=MarkBranch.USD_FAMILY,
                pnl=_coalesce_usd_pnl(usd_codes, ledger),
                terminal_native=sum(
                    float(ledger.terminal_native_equity.get(c, 0.0))
                    for c in usd_codes
                ),
                upnl_native=sum(
                    float(ledger.terminal_upnl_native.get(c, 0.0))
                    for c in usd_codes
                ),
                flow_qty=_bucket_flow_qty(
                    usd_set, ledger, branch=MarkBranch.USD_FAMILY, venue=venue
                ),
                mark=None,  # literal 1.0 (§4.1 IEEE no-op)
            )
        )
    for code in indexed_codes:
        pnl = ledger.native_pnl.get(code)
        buckets.append(
            _Bucket(
                code=code,
                branch=MarkBranch.INDEXED,
                pnl=(
                    pnl.astype(float)
                    if pnl is not None
                    else pd.Series(dtype=float, name="native_pnl")
                ),
                terminal_native=float(ledger.terminal_native_equity.get(code, 0.0)),
                upnl_native=float(ledger.terminal_upnl_native.get(code, 0.0)),
                flow_qty=_bucket_flow_qty(
                    frozenset({code}), ledger,
                    branch=MarkBranch.INDEXED, venue=venue,
                ),
                mark=ledger.marks.get(code),
            )
        )
    return buckets


def _roll_bucket(bucket: _Bucket) -> bool:
    """Step 2 (§1.3): union the bucket's flow days into its pnl index (the
    ``_union_flow_days`` semantics), then roll the balance BACKWARD in NATIVE
    units via the SAME ``nav_twr.reconstruct_nav`` (verbatim reuse, never a fork
    — §1.1). Returns ``True`` when the bucket produced a non-empty balance."""
    pnl_unioned = _union_flow_days(bucket.pnl, bucket.flow_qty)
    bucket.pnl_unioned = pnl_unioned
    if pnl_unioned.empty:
        return False
    terminal_native = bucket.terminal_native - bucket.upnl_native
    bucket.balance = reconstruct_nav(pnl_unioned, terminal_native, bucket.flow_qty)
    return True


def _reindex_ffill(series: pd.Series, index: pd.DatetimeIndex) -> np.ndarray:
    """Carry-forward a bucket balance onto the union calendar (§1.3 step 4, G3):
    days before the bucket's first index day are 0.0 (it did not exist yet); days
    within/after its span carry the last known balance forward (a balance is
    constant between ledger events BY DEFINITION — this is NOT a price fill;
    marks are never filled)."""
    return np.asarray(
        series.reindex(index, method="ffill").fillna(0.0).to_numpy(dtype=float),
        dtype=float,
    )


def _value_over_calendar(
    rolled: list[_Bucket], index: pd.DatetimeIndex, venue: str
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Step 4 (§1.3): NAV(d) = Σ_c B_c(d)×mark_c(d) and F_usd(d) =
    Σ_c flowqty_c(d)×mark_c(d) over the union calendar, ENFORCING the §3.3 density
    contract (a mark is required on every day a bucket carries a nonzero balance
    or flow; a missing/invalid mark refuses — never filled). Branch-1 buckets use
    the literal 1.0 (the IEEE no-op). Also returns the USD-valued daily pnl (used
    only for the day-0 fail-loud coercion in ``chain_linked_twr`` — the day-0
    denominator itself comes from ``prev0_usd``)."""
    n = len(index)
    nav_total = np.zeros(n, dtype=float)
    flow_total = np.zeros(n, dtype=float)
    pnl_total = np.zeros(n, dtype=float)
    for bucket in rolled:
        b_eff = _reindex_ffill(bucket.balance, index)
        flow_eff = (
            bucket.flow_qty.reindex(index, fill_value=0.0).to_numpy(dtype=float)
            if not bucket.flow_qty.empty
            else np.zeros(n, dtype=float)
        )
        pnl_eff = bucket.pnl_unioned.reindex(index, fill_value=0.0).to_numpy(
            dtype=float
        )
        if bucket.mark is None:  # USD bucket — mark ≡ 1.0 (IEEE no-op)
            nav_total += b_eff
            flow_total += flow_eff
            pnl_total += pnl_eff
            continue
        mark_vals = bucket.mark.reindex(index).to_numpy(dtype=float)
        required = (b_eff != 0.0) | (flow_eff != 0.0)
        valid = np.isfinite(mark_vals) & (mark_vals > 0.0)
        missing = required & ~valid
        if bool(missing.any()):
            raise UnmarkableCurrencyError(
                currency=bucket.code, venue=venue,
                reason="missing_daily_marks",
                missing_day_count=int(missing.sum()),
            )
        # 0-balance/0-flow days never touch the (possibly-NaN, non-required) mark.
        nav_total += np.where(b_eff != 0.0, b_eff * mark_vals, 0.0)
        flow_total += np.where(flow_eff != 0.0, flow_eff * mark_vals, 0.0)
        pnl_total += np.where(valid & (pnl_eff != 0.0), pnl_eff * mark_vals, 0.0)
    return (
        pd.Series(nav_total, index=index, name="nav"),
        pd.Series(pnl_total, index=index, name="daily_pnl"),
        pd.Series(flow_total, index=index, name="flows"),
    )


def _prev0_usd(rolled: list[_Bucket]) -> float:
    """Day-0 previous capital, native analog (§1.3/§1.4):
    ``prev0_usd = Σ_c (B_c(d0_c) − pnl_c(d0_c) − flowqty_c(d0_c)) × mark_c(d0_c)``
    — each bucket's OWN first day (the earliest mark we possess; inventing an
    earlier price would be fabrication). A bucket whose pre-history balance is
    exactly 0 contributes 0 (no inception mark needed there)."""
    total = 0.0
    for bucket in rolled:
        d0 = bucket.balance.index[0]
        b0 = float(bucket.balance.iloc[0])
        pnl0 = float(bucket.pnl_unioned.iloc[0])
        flow0 = (
            float(bucket.flow_qty.reindex([d0], fill_value=0.0).iloc[0])
            if not bucket.flow_qty.empty
            else 0.0
        )
        pre_hist = b0 - pnl0 - flow0
        if pre_hist == 0.0:
            continue
        mark0 = (
            1.0
            if bucket.mark is None
            else float(bucket.mark.reindex([d0]).iloc[0])
        )
        total += pre_hist * mark0
    return total


def reconstruct_native_nav_and_twr(
    ledger: NativeLedger,
    *,
    indexable_currencies: frozenset[str],
    venue: str = "",
) -> tuple[pd.Series, NavTWRMeta]:
    """Per-currency native backward roll → daily USD NAV via day marks →
    chain-linked TWR with the same DQ-01 guards (contract §1.3, six pure steps).

    ``venue`` is exception-metadata ONLY (G2, §9.1) — no venue string reaches the
    valuation math. Mixed accounts are the base case (§8): a USD-native account
    is zero branch-2 buckets (⇒ §4 byte-identity), a pure-coin account zero
    branch-1 — the same code, all three.

    Raises ``NavReconstructionError`` subclasses (``UnmarkableCurrencyError`` §3.4,
    ``InceptionReconciliationError`` §5) — permanent/structural, matching the
    worker-retry discipline. Purity: stdlib + pandas + numpy; no I/O; no logging
    of raw values (§1.1)."""
    # Step 1 — classify (families disjoint, G1) + coalesce branch-1 into "USD".
    _assert_families_disjoint(USD_FAMILY, indexable_currencies)
    buckets = _build_buckets(ledger, indexable_currencies, venue)

    # Step 2 — per-bucket native backward roll (verbatim reconstruct_nav reuse).
    rolled = [b for b in buckets if _roll_bucket(b)]
    if not rolled:
        return pd.Series(dtype=float, name="returns"), _build_nav_meta({})

    # Step 3 — inception-reconciliation refuse gate (§5), BEFORE valuation.
    _assert_inception_reconciled(
        ledger, rolled, indexable_currencies, venue=venue
    )

    # Step 4 — value NAV(d) = Σ_c B_c(d)×mark_c(d) over the union calendar.
    union_index = rolled[0].balance.index
    for bucket in rolled[1:]:
        union_index = union_index.union(bucket.balance.index)
    nav_usd, composed_pnl_usd, composed_flows_usd = _value_over_calendar(
        rolled, union_index, venue
    )

    # Step 5 — chain-link with the native day-0 capital injected as prev0_usd.
    returns, flags = chain_linked_twr(
        nav_usd,
        composed_pnl_usd,
        composed_flows_usd,
        prev0=_prev0_usd(rolled),
    )

    # Step 6 — meta + the §6 interior-chain-break key (79-03 merge, one detector).
    flags = {**flags, **cumulative_twr_segmented(returns)[1]}
    return returns, _build_nav_meta(flags)


def _assert_inception_reconciled(
    ledger: NativeLedger,
    rolled: list[_Bucket],
    indexable: AbstractSet[str],
    *,
    venue: str,
) -> None:
    """Step 3 (§5) — the inception-reconciliation refuse gate. Filled in Task 3
    (79-02 T3): for a ``full_history=True`` ledger it values each bucket's rolled
    pre-history residual at its inception-day mark, sums them, and refuses via
    ``InceptionReconciliationError`` when the sum exceeds
    ``max(INCEPTION_ABS_TOL_USD, INCEPTION_REL_TOL × anchor NAV)``;
    ``full_history=False`` SKIPS entirely. This placeholder keeps the step-3 call
    site present in the six-step pipeline so the core is written once, complete —
    Task 3 supplies the body, the tolerance constants, and the gate tests."""
    return
