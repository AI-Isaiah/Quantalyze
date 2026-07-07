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

from collections.abc import Set as AbstractSet
from enum import Enum

from services.external_flows import USD_FAMILY
from services.nav_twr import NavReconstructionError


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
